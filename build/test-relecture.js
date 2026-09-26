'use strict';
/* ============================================================
   LA RELECTURE DE LA BIBLIOTHEQUE NE GELE PLUS LE WIDGET.

   Le DJ ajoute un titre dans son logiciel en plein set : la base est
   reecrite, Liaison la relit. Avant 1.5.2, tout se faisait sur le fil
   du widget — un export de 50 000 titres, puis un stat() par fichier.
   Ce banc fabrique une vraie bibliotheque de 20 000 fichiers, la fait
   relire par le fil de lecture (import-worker.js), et mesure pendant
   ce temps le plus long blocage du fil principal. Il compare avec la
   relecture sur place, pour que le chiffre veuille dire quelque chose.

   Il verifie aussi que les deux chemins rendent EXACTEMENT la meme
   bibliotheque, et que chaque module charge par le fil est bien
   deplie hors de l'archive dans l'app livree.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const autolib = require('../src/autolibrary');
const libmod = require('../src/library');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(62) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
console.log('relecture de la bibliotheque, hors du fil du widget\n');

/* ---------- 1. l'app livree : tout ce que les fils chargent est deplie ---------- */
{
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const deplies = new Set((pkg.build.asarUnpack || []).filter(x => x.startsWith('src/')));
  const manquants = [];
  for (const fil of ['import-worker.js', 'analyze-worker.js', 'structure-worker.js']) {
    const vus = new Set();
    const marcher = f => {
      if (vus.has(f)) return; vus.add(f);
      const s = fs.readFileSync(f, 'utf8');
      for (const m of s.matchAll(/require\('(\.[^']+)'\)/g)) {
        let p = path.resolve(path.dirname(f), m[1]);
        if (!p.endsWith('.js')) p += '.js';
        if (fs.existsSync(p)) marcher(p);
      }
    };
    marcher(path.join(__dirname, '..', 'src', fil));
    for (const f of vus) {
      const rel = path.relative(path.join(__dirname, '..'), f).split(path.sep).join('/');
      if (!deplies.has(rel)) manquants.push(fil + ' → ' + rel);
    }
  }
  verifier('chaque module des fils est hors de l\'archive (asarUnpack)', manquants.length === 0, manquants.join(', '));
}

/* ---------- 2. une vraie bibliotheque ---------- */
const N = 20000;
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-relecture-'));
const musique = path.join(racine, 'Musique & Co');
fs.mkdirSync(musique, { recursive: true });
const lignes = [];
for (let i = 0; i < N; i++) {
  const f = path.join(musique, 'titre-' + i + '.mp3');
  if (i % 50 !== 0) fs.writeFileSync(f, '');        /* un sur cinquante a ete efface */
  const loc = 'file://localhost' + encodeURI(f.replace(/\\/g, '/')).replace(/&/g, '&amp;');
  lignes.push('<TRACK TrackID="' + i + '" Name="Titre ' + i + '" Artist="Artiste ' + (i % 900) +
    '" Location="' + loc + '" AverageBpm="' + (100 + i % 40) + '.00" Tonality="' + ['Am', 'C', 'Em', 'G'][i % 4] +
    '" TotalTime="' + (180 + i % 120) + '" Genre="House"/>');
}
const xml = path.join(racine, 'rekordbox.xml');
fs.writeFileSync(xml, '<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION>\n' + lignes.join('\n') + '\n</COLLECTION></DJ_PLAYLISTS>');
const sources = [{ kind: 'rekordbox', path: xml, label: 'rekordbox' }];

/* Le plus long blocage du fil principal pendant une operation. */
function mesurer(op) {
  return new Promise(resolve => {
    let pire = 0, t = Date.now(), fini = false;
    const tic = setInterval(() => { const n = Date.now(); pire = Math.max(pire, n - t - 5); t = n; }, 5);
    Promise.resolve().then(op).then(r => {
      fini = true;
      setTimeout(() => { clearInterval(tic); const n = Date.now(); pire = Math.max(pire, n - t - 5); resolve({ r, pire }); }, 10);
    });
    void fini;
  });
}

function surPlace() {
  return (async () => {
    const lists = [];
    for (const s of sources) lists.push(await autolib.readSource(s, null, {}));
    const d = libmod.dedoublonner(autolib.merge(lists));
    const e = libmod.elaguerDisparus(d.tracks);
    return { library: libmod.finalize(e.gardes), disparus: e.disparus.length };
  })();
}
function parLeFil() {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, '..', 'src', 'import-worker.js'));
    w.on('message', m => { if (m.progress) return; w.terminate(); m.ok ? resolve(m) : reject(new Error(m.error)); });
    w.on('error', reject);
    w.postMessage({ id: 1, sources, cache: null });
  });
}

(async () => {
  const a = await mesurer(surPlace);
  const b = await mesurer(parLeFil);
  console.log('    (sur place : fil principal bloque ' + a.pire + ' ms · par le fil de lecture : ' + b.pire + ' ms)');

  verifier('les deux chemins rendent la meme bibliotheque',
           a.r.library.length === b.r.library.length &&
           a.r.library.every((t, i) => t.id === b.r.library[i].id && t.path === b.r.library[i].path),
           a.r.library.length + ' / ' + b.r.library.length);
  verifier('les fichiers effaces sont retires (1 sur 50)', b.r.disparus === N / 50, b.r.disparus);
  verifier('« & » dans le dossier : rien de perdu', b.r.library.length === N - N / 50);
  verifier('chaque morceau arrive avec son empreinte (plus de stat ici)',
           b.r.library.every(t => typeof t._stamp === 'string'));
  verifier('fil principal jamais bloque plus de 150 ms', b.pire < 150, b.pire + ' ms');
  verifier('et nettement moins que sur place', b.pire * 2 < a.pire || a.pire < 150, a.pire + ' → ' + b.pire + ' ms');

  /* L'analyse reprend les empreintes sans toucher au disque. */
  const { AnalysisService } = require('../src/analysis');
  const cacheF = path.join(racine, 'cache.json');
  const svc = new AnalysisService(cacheF, {});
  svc._demarrerWorkers = () => {};           /* on ne lance pas ffmpeg ici */
  svc.sansFils = true;
  const statAvant = fs.statSync;
  let stats = 0;
  fs.statSync = function () { stats++; return statAvant.apply(this, arguments); };
  svc.charger(b.r.library);
  fs.statSync = statAvant;
  verifier('l\'analyse charge 20 000 titres sans un seul stat', stats === 0, stats + ' stat');
  verifier('et l\'empreinte provisoire ne reste pas sur les morceaux', b.r.library.every(t => t._stamp === undefined));
  try { svc.stop && svc.stop(); } catch (e) {}

  fs.rmSync(racine, { recursive: true, force: true });
  console.log('\n' + (ko ? ko + ' RATE(S)' : 'relecture : le widget ne gele plus quand la bibliotheque change.'));
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
