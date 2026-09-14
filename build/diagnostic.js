'use strict';
/* ============================================================
   LE DIAGNOSTIC COMPLET.

   « Peu importe le son : aucune key, aucun BPM, energie 5. »

   Energie 5 sur TOUS les morceaux n'est pas un probleme par
   morceau, c'est l'analyse qui echoue en bloc. Et quand elle
   echoue, Liaison pose des valeurs par defaut, marque le morceau
   « analyse », JETTE le message d'erreur et ne dit rien.

   Cet outil refait la chaine complete, dans l'ordre, et s'arrete
   a la premiere marche cassee :

     1. ffmpeg est-il la, et demarre-t-il ?
     2. les fils d'analyse demarrent-ils ?
     3. la bibliotheque se lit-elle ?
     4. un vrai morceau de TA bibliotheque s'analyse-t-il ?
     5. rekordbox tient-il des fichiers ouverts ?

   USAGE
     node build/diagnostic.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

let echecs = 0;
const ok = (quoi, detail) => console.log('  ok    %s%s', quoi.padEnd(46), detail ? '  ' + detail : '');
const rate = (quoi, detail) => { echecs++; console.log('  RATE  %s%s', quoi.padEnd(46), detail ? '  ' + detail : ''); };
const titre = (t) => console.log('\n' + t + '\n' + '-'.repeat(t.length));

function dossier() {
  if (process.env.LIAISON_DIR) return process.env.LIAISON_DIR;
  const h = os.homedir();
  if (process.platform === 'darwin') return path.join(h, 'Library', 'Application Support', 'Liaison');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || h, 'Liaison');
  return path.join(h, '.config', 'Liaison');
}
const DIR = dossier();
const lireJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

(async () => {

/* ---------- 1. ffmpeg ---------- */
titre('1. ffmpeg — c\'est lui qui decode l\'audio');
let chemin = 'ffmpeg';
try {
  let p = require('ffmpeg-static');
  if (p && p.path) p = p.path;
  if (p) { chemin = p.replace('app.asar', 'app.asar.unpacked'); ok('ffmpeg-static resolu', chemin); }
  else rate('ffmpeg-static ne rend aucun chemin');
} catch (e) {
  rate('ffmpeg-static introuvable', e.message);
  console.log('        -> npm install  puis  npm install-scripts approve ffmpeg-static');
}
if (chemin !== 'ffmpeg') {
  try {
    const st = fs.statSync(chemin);
    ok('le fichier existe', Math.round(st.size / 1048576) + ' Mo');
    try { fs.accessSync(chemin, fs.constants.X_OK); ok('il est executable'); }
    catch (e) {
      rate('il n\'est PAS executable');
      console.log('        -> chmod +x "' + chemin + '"');
    }
  } catch (e) {
    rate('le fichier n\'existe pas', chemin);
    console.log('        -> rm -rf node_modules/ffmpeg-static && npm install --foreground-scripts');
  }
}
const version = await new Promise(r => {
  let sortie = '';
  let p;
  try { p = spawn(chemin, ['-version']); } catch (e) { return r({ ok: false, err: e.message }); }
  p.stdout.on('data', d => { sortie += d; });
  p.stderr.on('data', d => { sortie += d; });
  p.on('error', e => r({ ok: false, err: e.message }));
  p.on('close', c => r({ ok: c === 0, code: c, sortie: sortie }));
  setTimeout(() => { try { p.kill(); } catch (e) {} r({ ok: false, err: 'delai depasse' }); }, 8000);
});
if (version.ok) ok('il demarre', (version.sortie.split('\n')[0] || '').slice(0, 52));
else {
  rate('IL NE DEMARRE PAS', version.err || ('code ' + version.code));
  console.log('        C\'est la cause. Sans ffmpeg, AUCUN morceau ne peut etre');
  console.log('        analyse : ni tempo, ni tonalite, ni energie. Liaison pose');
  console.log('        alors energie 5 partout — exactement ce que tu vois.');
}

/* ---------- 2. les fils ---------- */
titre('2. les fils d\'analyse');
try {
  const { Worker } = require('worker_threads');
  const f = path.join(__dirname, '..', 'src', 'analyze-worker.js');
  const w = new Worker(f);
  await new Promise(r => setTimeout(r, 300));
  ok('un fil demarre', path.basename(f));
  await w.terminate();
} catch (e) {
  rate('aucun fil ne demarre', e.message);
}

/* ---------- 3. la bibliotheque ---------- */
titre('3. ta bibliotheque');
const cfg = lireJSON(path.join(DIR, 'config.json'));
if (!cfg) { rate('aucun reglage trouve', DIR); }
else {
  ok('reglages lus', DIR);
  console.log('        mode : %s', cfg.libraryMode || '(aucun)');
  console.log('        source : %s', cfg.libraryPath || '(aucune)');
}
let L = [];
try {
  const lib = require('../src/library.js');
  let bruts = [];
  if (cfg && cfg.libraryMode === 'rekordbox' && cfg.libraryPath)
    bruts = lib.parseRekordboxXML(cfg.libraryPath);
  else if (cfg && cfg.libraryPath) {
    const c = lib.chargerScanCache(path.join(DIR, 'scan-cache.json')).e;
    bruts = Object.keys(c).map(k => Object.assign({ path: k.split('|')[0] }, c[k]));
  }
  L = lib.finalize(bruts);
  if (L.length) {
    ok('morceaux lus', L.length.toLocaleString('fr-FR'));
    const avecBpm = L.filter(t => t.bpm > 0).length;
    const avecKey = L.filter(t => t.key).length;
    console.log('        avec un tempo dans les tags : %s (%s %%)',
      avecBpm.toLocaleString('fr-FR'), Math.round(100 * avecBpm / L.length));
    console.log('        avec une tonalite           : %s (%s %%)',
      avecKey.toLocaleString('fr-FR'), Math.round(100 * avecKey / L.length));
    if (avecBpm < L.length * 0.1)
      console.log('        -> ta bibliotheque n\'a presque aucun tempo : c\'est donc');
      console.log('           l\'analyse de Liaison qui doit tout mesurer.');
  } else rate('aucun morceau lu');
} catch (e) { rate('lecture impossible', e.message); }

/* ---------- 4. une vraie analyse ---------- */
titre('4. l\'analyse d\'un vrai morceau de ta bibliotheque');
const joignables = L.filter(t => { try { fs.statSync(t.path); return true; } catch (e) { return false; } });
if (!L.length) console.log('  (saute : aucune bibliotheque)');
else if (!joignables.length) {
  rate('AUCUN fichier joignable sur ' + L.length);
  console.log('        Les chemins enregistres ne menent a rien. Disque debranche,');
  console.log('        ou bibliotheque exportee depuis une autre machine.');
  console.log('        Exemple : ' + (L[0] && L[0].path));
} else {
  console.log('  %s fichiers joignables sur %s', joignables.length.toLocaleString('fr-FR'),
              L.length.toLocaleString('fr-FR'));
  const { analyze } = require('../src/analyze.js');
  const essais = [0, Math.floor(joignables.length / 2), joignables.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i).slice(0, 3);
  for (const i of essais) {
    const t = joignables[i];
    const debut = Date.now();
    try {
      const r = await analyze(t.path, { seconds: 90 });
      const A = require('../src/analysis');
      const sur = c => (c >= A.SUR_TEMPO ? 'sur' : 'incertain');
      ok((t.title || path.basename(t.path)).slice(0, 34),
         'tempo ' + r.bpm + ' (' + r.bpmConfidence + ', ' + sur(r.bpmConfidence) + ')' +
         '  tonalite ' + (r.key || '-') + ' (' + r.keyConfidence + ', marge ' + r.keyMargin + ')' +
         '  energie ' + r.energy + '  timbre ' + JSON.stringify(r.timbre) +
         '  en ' + (Date.now() - debut) + ' ms');
      /* Ce que le tag du logiciel disait, en face. C'est la seule
         facon de voir d'un coup d'oeil si c'est notre mesure ou la
         bibliotheque qui raconte n'importe quoi. */
      if (t.bpm > 0 || t.key) {
        console.log('        le tag disait : tempo ' + (t.bpm > 0 ? t.bpm : '-') +
                    '   tonalite ' + (t.key || '-'));
      }
    } catch (e) {
      rate((t.title || path.basename(t.path)).slice(0, 34), e.message);
      console.log('        fichier : ' + t.path);
    }
  }
}

/* ---------- 5. la detection du deck ---------- */
titre('5. la detection du morceau qui tourne');
try {
  const rb = require('../src/sources/rekordbox.js');
  if (!rb.dispo) console.log('  (lecture des fichiers ouverts indisponible sur ce systeme)');
  else {
    const ps = await new Promise(r => rb.pids(r));
    if (!ps.length) {
      console.log('  rekordbox n\'est pas lance.');
      console.log('  -> lance-le, mets un morceau sur un deck, et relance ce diagnostic.');
    } else {
      ok('rekordbox tourne', ps.length + ' processus');
      const fichiers = await new Promise(r => {
        let reste = ps.length, acc = [];
        ps.forEach(pid => rb.fichiersAudio(pid, fs2 => {
          acc = acc.concat(fs2); if (--reste === 0) r(acc);
        }));
      });
      if (!fichiers.length) {
        rate('AUCUN fichier audio ouvert');
        console.log('        Liaison deduit le morceau qui tourne des fichiers que');
        console.log('        rekordbox tient ouverts. S\'il n\'en tient aucun, il n\'y a');
        console.log('        rien a lire. Charge un morceau sur un deck et relance.');
      } else {
        ok('fichiers audio ouverts', String(fichiers.length));
        const parChemin = new Map(L.map(t => [t.path, t]));
        let reconnus = 0;
        for (const f of fichiers) {
          const t = parChemin.get(f);
          console.log('        %s %s', t ? 'connu  ' : 'INCONNU', path.basename(f).slice(0, 56));
          if (t) reconnus++;
        }
        if (!reconnus) {
          rate('aucun n\'est dans la bibliotheque');
          console.log('        Les fichiers ouverts ne correspondent a aucun titre lu.');
          console.log('        C\'est pour ca que rien ne s\'affiche quand tu lances un son.');
        }
      }
    }
  }
} catch (e) { rate('detection impossible', e.message); }

console.log('\n' + '='.repeat(60));
if (echecs) console.log('%d marche(s) cassee(s). Colle tout ce qui precede.', echecs);
else console.log('Toute la chaine repond. Colle quand meme la sortie.');
})();
