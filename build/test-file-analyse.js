'use strict';
/* ============================================================
   LA FILE D'ANALYSE NE S'ARRETE JAMAIS EN SILENCE.

   Audit du 5 octobre 2026. Deux defauts, un meme symptome : la
   barre d'analyse se fige, et les morceaux sans tag de tempo ne
   recoivent jamais le leur — donc ne sont presque jamais proposes,
   toute la soiree, sans un mot.

   1. TROIS FICHIERS INTROUVABLES DE SUITE, ET PLUS RIEN.
      _pousser() s'arretait au troisieme fichier injoignable d'une
      passe, sans rien replanifier. Les fichiers morts (morceau
      efface, SSD debranche) restaient en tete de file : leur delai
      de 60 s expire, ils repassent devant, la passe s'arrete — et
      plus aucun evenement ne relance la file. Mesure : 244 morceaux
      analyses, puis zero pendant le reste du set.

   2. UN FICHIER DE DEUX HEURES SANS DUREE CONNUE.
      main.js n'evite le decodage integral qu'au-dela de 20 minutes
      de duree CONNUE. Duree inconnue (sonde ratee) : tout le fichier
      etait decode — 1,4 Go de memoire pour un seul fil, sur trois.
      decodeAll() s'arrete desormais a 20 minutes, quoi qu'il arrive.

   Ce banc a besoin d'un ffmpeg qui demarre, comme test-analyse.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ffmpegPath } = require('../src/analyze');
const { AnalysisService } = require('../src/analysis');
const structure = require('../src/structure');

let echecs = 0, cas = 0;
function verifier(quoi, condition, detail) {
  cas++;
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(64), detail ? '  — ' + detail : '');
}

function ffmpegDemarre() {
  try { const r = spawnSync(ffmpegPath(), ['-version']); return !r.error && r.status === 0; }
  catch (e) { return false; }
}

const SR = 22050;
function ecrireWav(fichier, secondes, freq) {
  const n = Math.floor(SR * secondes);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    /* une note et un battement a 120 BPM : de quoi mesurer quelque chose */
    const t = i / SR, battue = (t * 2) % 1;
    const v = 0.4 * Math.sin(2 * Math.PI * freq * t) + (battue < 0.05 ? 0.5 * Math.sin(2 * Math.PI * 60 * t) : 0);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 30000), 44 + i * 2);
  }
  fs.writeFileSync(fichier, buf);
}

const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(cond, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) { if (cond()) return true; await attendre(50); }
  return cond();
}

(async () => {
  console.log('\n- la file d\'analyse ne s\'arrete jamais en silence -\n');
  if (!ffmpegDemarre()) {
    console.log('  non teste ici : ffmpeg ne demarre pas sur cette machine (' + ffmpegPath() + ')');
    return;
  }
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-file-'));
  try {
    /* ------------------------------------------------------------
       1. Six morceaux effaces en tete de bibliotheque, douze vivants
          derriere. Le delai de 60 s des absents expire en cours de
          route (on le fait expirer, on ne va pas attendre une
          minute) : la file doit aller au bout des vivants.
       ------------------------------------------------------------ */
    {
      const lib = [];
      let id = 1;
      for (let i = 0; i < 6; i++) lib.push({ id: id++, path: path.join(dossier, 'efface', 'mort' + i + '.mp3'), title: 'mort' + i });
      for (let i = 0; i < 12; i++) {
        const f = path.join(dossier, 'vivant' + i + '.wav');
        ecrireWav(f, 3, 220 + i * 30);
        lib.push({ id: id++, path: f, title: 'vivant' + i });
      }
      const svc = new AnalysisService(path.join(dossier, 'cache1.json'));
      svc.setCadence(1);                       /* un set est en cours : un seul fil */
      svc.charger(lib);
      svc.demarrer();
      await jusqua(() => svc.reussis >= 2, 20000);
      /* la minute est passee pour les absents */
      for (const k of svc.absents.keys()) svc.absents.set(k, Date.now() - 1);
      const fini = await jusqua(() => lib.slice(6).every(t => t.analyzed), 30000);
      verifier('morceaux effaces en tete : la file va au bout des vivants', fini,
               lib.slice(6).filter(t => t.analyzed).length + ' / 12 analyses');
      verifier('... et les effaces restent marques injoignables', lib.slice(0, 6).every(t => t.offline));
      svc.stop();
    }

    /* ------------------------------------------------------------
       2. Le SSD se debranche APRES le chargement : trente morceaux
          frais deviennent introuvables d'un coup, devant quatre
          vivants. Meme exigence.
       ------------------------------------------------------------ */
    {
      const lib = [];
      let id = 100;
      const ssd = path.join(dossier, 'ssd');
      fs.mkdirSync(ssd);
      for (let i = 0; i < 30; i++) {
        const f = path.join(ssd, 'ssd' + i + '.wav');
        ecrireWav(f, 0.5, 300);
        lib.push({ id: id++, path: f, title: 'ssd' + i });
      }
      for (let i = 0; i < 4; i++) {
        const f = path.join(dossier, 'interne' + i + '.wav');
        ecrireWav(f, 3, 500 + i * 40);
        lib.push({ id: id++, path: f, title: 'interne' + i });
      }
      const svc = new AnalysisService(path.join(dossier, 'cache2.json'));
      svc.setCadence(1);
      svc.charger(lib);                        /* tout repond au chargement */
      fs.rmSync(ssd, { recursive: true, force: true });   /* puis le disque part */
      svc.demarrer();
      const fini = await jusqua(() => lib.slice(30).every(t => t.analyzed), 30000);
      verifier('SSD debranche apres chargement : les morceaux internes passent', fini,
               lib.slice(30).filter(t => t.analyzed).length + ' / 4 analyses');
      verifier('... sans que la file ne marque un seul absent comme analyse',
               lib.slice(0, 30).every(t => !t.analyzed && t.offline));
      svc.stop();
    }

    /* ------------------------------------------------------------
       3. Plus rien que des absents : la file attend, sans tourner a
          vide et sans retenir le processus (minuteur relache).
       ------------------------------------------------------------ */
    {
      const lib = [{ id: 900, path: path.join(dossier, 'nulle-part', 'x.mp3'), title: 'x' }];
      const svc = new AnalysisService(path.join(dossier, 'cache3.json'));
      svc.charger(lib);
      svc.demarrer();
      let passes = 0;
      const orig = svc._pousser.bind(svc);
      svc._pousser = function () { passes++; return orig(); };
      await attendre(600);
      verifier('que des absents : pas de boucle a vide', passes <= 3, passes + ' passes en 0,6 s');
      svc.stop();
    }

    /* ------------------------------------------------------------
       4. Le fichier de 25 minutes : decodeAll s'arrete a 20.
       ------------------------------------------------------------ */
    {
      const f = path.join(dossier, 'mix-25min.wav');
      const r = spawnSync(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=8000:duration=1500',
                                         '-ac', '1', '-c:a', 'pcm_s16le', '-y', f]);
      if (r.status !== 0) verifier('fabriquer un fichier de 25 minutes', false, String(r.stderr || '').slice(0, 200));
      else {
        const pcm = await structure.decodeAll(f);
        const sec = pcm.length / 11025;
        verifier('decodeAll : un fichier de 25 min est borne a 20 min', sec <= 1200.5, sec.toFixed(1) + ' s decodees');
      }
    }
  } finally {
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
  }

  console.log('\n' + (cas - echecs) + ' / ' + cas + ' controles.');
  if (echecs) { console.error(echecs + ' controle(s) de la file d\'analyse en echec.'); process.exit(1); }
  console.log('file d\'analyse : elle va au bout, disque absent ou pas.');
})().catch(e => { console.error(e); process.exit(1); });
