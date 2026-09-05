'use strict';
/* ============================================================
   Liaison — structure d'un morceau.

   On ne cherche pas a decrire la musique : on cherche les deux
   seuls instants qui interessent un DJ en cabine — le moment ou
   la batterie arrive, et le moment ou elle part. Tout le reste
   (breaks, grille de phrases, courbe d'energie) tombe du meme
   calcul.

   Tout est local : ffmpeg decode, filtres a un pole, aucune FFT.
   Une analyse complete coute environ 1 s pour 6 minutes d'audio.
   ============================================================ */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { ffmpegPath } = require('./analyze');

const SR = 11025;      // suffisant : on mesure des enveloppes, pas des hauteurs
const HOP = 256;       // 43 trames par seconde
const WIN = 512;

/* ---------- decodage integral ---------- */
function decodeAll(file) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
    const p = spawn(ffmpegPath(), args);
    const chunks = [];
    let bytes = 0;
    p.stdout.on('data', d => { chunks.push(d); bytes += d.length; });
    p.stderr.on('data', () => {});
    p.on('error', reject);
    p.on('close', () => {
      if (!bytes) return reject(new Error('ffmpeg : aucun echantillon (' + path.basename(file) + ')'));
      const buf = Buffer.concat(chunks, bytes - (bytes % 4));
      resolve(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
    });
  });
}

/* ---------- filtre passe-bas a un pole, applique deux fois ---------- */
function lowpass(pcm, hz) {
  const a = Math.exp(-2 * Math.PI * hz / SR);
  const out = new Float32Array(pcm.length);
  let y = 0;
  for (let i = 0; i < pcm.length; i++) { y = (1 - a) * pcm[i] + a * y; out[i] = y; }
  y = 0;
  for (let i = 0; i < out.length; i++) { y = (1 - a) * out[i] + a * y; out[i] = y; }
  return out;
}

/* ---------- enveloppes par trame ---------- */
function envelopes(pcm) {
  const low = lowpass(pcm, 180);          // grosse caisse et basse
  const body = lowpass(pcm, 2200);        // tout sauf les aigus
  const frames = Math.max(1, Math.floor((pcm.length - WIN) / HOP));
  const rms = new Float64Array(frames);
  const kick = new Float64Array(frames);
  const air = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let a = 0, b = 0, c = 0;
    for (let i = 0; i < WIN; i++) {
      const s = pcm[off + i] || 0;
      const l = low[off + i] || 0;
      const h = s - (body[off + i] || 0);
      a += s * s; b += l * l; c += h * h;
    }
    rms[f] = Math.sqrt(a / WIN);
    kick[f] = Math.sqrt(b / WIN);
    air[f] = Math.sqrt(c / WIN);
  }
  return { rms, kick, air, frames, rate: SR / HOP };
}

const median = arr => {
  const s = Array.from(arr).filter(v => v > 0).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const smooth = (arr, w) => {
  const out = new Float64Array(arr.length);
  let acc = 0;
  for (let i = 0; i < arr.length; i++) {
    acc += arr[i];
    if (i >= w) acc -= arr[i - w];
    out[i] = acc / Math.min(w, i + 1);
  }
  return out;
};

/* ---------- grille : phase du temps, puis du premier temps de mesure ---------- */
function grid(env, bpm) {
  const beat = (60 / bpm) * env.rate;                 // trames par temps
  const onset = new Float64Array(env.frames);
  for (let i = 1; i < env.frames; i++) onset[i] = Math.max(0, env.rms[i] - env.rms[i - 1]);

  const at = (arr, x) => {
    if (x < 0 || x >= arr.length - 1) return 0;
    const i = Math.floor(x), f = x - i;
    return arr[i] * (1 - f) + arr[i + 1] * f;
  };

  /* phase du temps : celle qui capte le plus d'attaques */
  let bestPhase = 0, bestScore = -1;
  const beats = Math.floor((env.frames - 1) / beat);
  for (let p = 0; p < 24; p++) {
    const ph = (p * beat) / 24;
    let s = 0;
    for (let k = 0; k < beats; k++) s += at(onset, ph + k * beat);
    if (s > bestScore) { bestScore = s; bestPhase = ph; }
  }

  /* premier temps de mesure : celui ou la grosse caisse frappe le plus fort */
  let bestBar = 0, bestBarScore = -1;
  for (let b = 0; b < 4; b++) {
    let s = 0, n = 0;
    for (let k = b; k < beats; k += 4) { s += at(env.kick, bestPhase + k * beat); n++; }
    if (n && s / n > bestBarScore) { bestBarScore = s / n; bestBar = b; }
  }

  return { beat: beat, phase: bestPhase + bestBar * beat, beats: beats };
}

/* ---------- structure ---------- */
async function structure(file, bpm) {
  const pcm = await decodeAll(file);
  const duration = pcm.length / SR;
  const env = envelopes(pcm);
  const toSec = f => f / env.rate;

  if (!bpm || bpm < 60) bpm = 124;                     // secours : grille indicative
  const g = grid(env, bpm);
  const barF = g.beat * 4;                             // trames par mesure
  const phraseF = barF * 8;                            // phrase de 8 mesures

  /* presence de la batterie, mesuree mesure par mesure */
  const kickSm = smooth(env.kick, Math.round(g.beat));
  const ref = median(kickSm) || 1;
  const bars = [];
  for (let x = g.phase; x + barF < env.frames; x += barF) {
    let s = 0, n = 0;
    for (let i = Math.floor(x); i < Math.floor(x + barF) && i < env.frames; i++) { s += kickSm[i]; n++; }
    bars.push({ f: x, t: toSec(x), k: n ? (s / n) / ref : 0 });
  }
  if (bars.length < 8) {
    return { ok: false, duration: duration, bpm: bpm, reason: 'morceau trop court pour une grille' };
  }

  const ON = 0.62, OFF = 0.34;
  const isOn = i => bars[i] && bars[i].k >= ON;

  /* intro : premiere mesure suivie de 4 mesures pleines */
  let introBar = 0;
  for (let i = 0; i < bars.length - 4; i++) {
    if (isOn(i) && isOn(i + 1) && isOn(i + 2) && isOn(i + 3)) { introBar = i; break; }
  }
  /* outro : derniere mesure precedee de 4 mesures pleines */
  let outroBar = bars.length - 1;
  for (let i = bars.length - 1; i >= 4; i--) {
    if (isOn(i) && isOn(i - 1) && isOn(i - 2) && isOn(i - 3)) { outroBar = i + 1; break; }
  }
  if (outroBar <= introBar) outroBar = bars.length - 1;

  /* breaks : au moins 2 mesures creuses entre l'intro et l'outro */
  const breaks = [];
  let run = null;
  for (let i = introBar; i <= outroBar; i++) {
    if (bars[i] && bars[i].k < OFF) { if (!run) run = { from: i, to: i }; else run.to = i; }
    else if (run) { if (run.to - run.from >= 1) breaks.push(run); run = null; }
  }
  if (run && run.to - run.from >= 1) breaks.push(run);

  /* courbe d'energie, 48 points */
  const curve = [];
  const rmsSm = smooth(env.rms, Math.round(env.rate * 2));
  const peak = Math.max.apply(null, Array.from(rmsSm)) || 1;
  for (let i = 0; i < 48; i++) {
    const f = Math.floor((i / 48) * env.frames);
    curve.push(Math.round((rmsSm[f] / peak) * 100) / 100);
  }

  const introEnd = bars[introBar].t;
  const outroStart = bars[Math.min(outroBar, bars.length - 1)].t;
  const beatSec = 60 / bpm;

  return {
    ok: true,
    duration: Math.round(duration * 10) / 10,
    bpm: bpm,
    beatSec: Math.round(beatSec * 1000) / 1000,
    barSec: Math.round(beatSec * 4 * 1000) / 1000,
    phraseSec: Math.round(beatSec * 32 * 1000) / 1000,
    firstBeat: Math.round(toSec(g.phase) * 100) / 100,

    /* les quatre reperes qui servent en cabine */
    inPoint: Math.round(toSec(g.phase) * 100) / 100,       // ou lancer la platine
    readyAt: Math.round(introEnd * 100) / 100,             // ou sa batterie arrive
    outPoint: Math.round(outroStart * 100) / 100,          // ou sa batterie part
    lastCall: Math.round(Math.max(0, duration - beatSec * 32) * 100) / 100,

    introSec: Math.round(introEnd * 10) / 10,
    outroSec: Math.round(Math.max(0, duration - outroStart) * 10) / 10,
    introBars: Math.round(introEnd / (beatSec * 4)),
    outroBars: Math.round(Math.max(0, duration - outroStart) / (beatSec * 4)),
    breaks: breaks.map(b => ({
      start: Math.round(bars[b.from].t * 10) / 10,
      end: Math.round((bars[Math.min(b.to + 1, bars.length - 1)].t) * 10) / 10,
      bars: b.to - b.from + 1
    })).slice(0, 4),
    curve: curve
  };
}

/* ---------- cache disque ---------- */
class StructureCache {
  constructor(file) {
    this.file = file;
    this.map = new Map();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const k of Object.keys(raw)) this.map.set(k, raw[k]);
    } catch (e) {}
    this.dirty = false;
  }
  key(track) {
    let mt = 0;
    try { mt = Math.round(fs.statSync(track.path).mtimeMs); } catch (e) {}
    return track.path + '|' + mt;
  }
  get(track) { return this.map.get(this.key(track)) || null; }
  set(track, value) { this.map.set(this.key(track), value); this.dirty = true; }
  save() {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const obj = {};
      /* on ne garde que les 4000 dernieres entrees */
      const keys = Array.from(this.map.keys()).slice(-4000);
      for (const k of keys) obj[k] = this.map.get(k);
      fs.writeFileSync(this.file, JSON.stringify(obj));
      this.dirty = false;
    } catch (e) {}
  }
}

/* ============================================================
   Pool de fils d'execution.
   L'analyse bloque environ deux secondes de calcul : hors du fil
   principal, sinon le widget se fige en pleine soiree.
   ============================================================ */
class StructurePool {
  constructor(size) {
    this.size = Math.max(1, size || 2);
    this.workers = [];
    this.queue = [];
    this.pending = new Map();
    this.seq = 0;
  }
  _spawn() {
    let Worker;
    try { ({ Worker } = require('worker_threads')); } catch (e) { return null; }
    /* Dans une app empaquetee, le fichier vit hors de l'archive asar :
       worker_threads ne sait pas lire dedans. */
    const file = path.join(__dirname, 'structure-worker.js').replace('app.asar', 'app.asar.unpacked');
    let w;
    try { w = new Worker(file); } catch (e) { return null; }
    w.busy = false;
    w.on('message', m => {
      const cb = this.pending.get(m.id);
      this.pending.delete(m.id);
      w.busy = false;
      w.jobId = null;
      try { w.unref(); } catch (e) {}
      if (cb) (m.ok ? cb.resolve(m.result) : cb.reject(new Error(m.error)));
      this._drain();
    });
    /* Un fil qui meurt emportait avec lui la promesse du travail en
       cours : ni resolue ni rejetee, elle pendait pour toujours. Cote
       main.js, ni .then ni .catch ne se declenchaient, donc l'entree
       n'etait jamais retiree de structBusy — et le morceau restait
       marque « en cours d'analyse » a vie. Consequence visible : les
       plans de mix (« lance a 3:12, bascule les basses a 4:04 »)
       cessaient d'apparaitre pour le reste de la soiree, en silence.

       On rejette donc ce qui appartenait a ce fil, on le retire de la
       liste — sinon _free() continuait de le proposer, un fil mort —
       et on laisse _drain() en recreer un. */
    w.on('error', err => {
      w.busy = false;
      if (w.jobId != null) {
        const cb = this.pending.get(w.jobId);
        this.pending.delete(w.jobId);
        w.jobId = null;
        if (cb) cb.reject(err instanceof Error ? err : new Error('fil de structure interrompu'));
      }
      this.workers = this.workers.filter(x => x !== w);
      try { w.terminate(); } catch (e) {}
      this._drain();
    });
    w.on('exit', () => {
      if (w.jobId != null) {
        const cb = this.pending.get(w.jobId);
        this.pending.delete(w.jobId);
        w.jobId = null;
        if (cb) cb.reject(new Error('fil de structure arrete'));
      }
      this.workers = this.workers.filter(x => x !== w);
      this._drain();
    });
    try { w.unref(); } catch (e) {}
    this.workers.push(w);
    return w;
  }
  _free() {
    let w = this.workers.find(x => !x.busy);
    if (!w && this.workers.length < this.size) w = this._spawn();
    return w;
  }
  _drain() {
    while (this.queue.length) {
      const w = this._free();
      /* Aucun fil disponible et aucun ne peut naitre : plutot que de
         laisser la promesse pendre pour toujours, on calcule ici meme.
         C'est plus lent, mais l'app reste juste. */
      if (!w) {
        if (this.workers.length === 0) {
          const job = this.queue.shift();
          structure(job.path, job.bpm).then(job.resolve, job.reject);
          continue;
        }
        return;
      }
      const job = this.queue.shift();
      w.busy = true;
      w.jobId = job.id;                      /* pour rejeter si le fil meurt */
      try { w.ref(); } catch (e) {}          /* le fil retient le process tant qu'il calcule */
      this.pending.set(job.id, job);
      w.postMessage({ id: job.id, path: job.path, bpm: job.bpm });
    }
  }
  run(file, bpm) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.queue.push({ id: id, path: file, bpm: bpm, resolve: resolve, reject: reject });
      this._drain();
    });
  }
  close() { for (const w of this.workers) { try { w.terminate(); } catch (e) {} } this.workers = []; }
}

module.exports = { structure, StructureCache, StructurePool, decodeAll, envelopes, grid };
