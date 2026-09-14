'use strict';
/* ============================================================
   POURQUOI DEUX VERSIONS DU MEME MORCEAU NE DONNENT PAS LA MEME
   CHOSE.

   « Ca depend des versions. Si je mets une version de Boney M.,
     ca me propose un bon mix. Sur une autre version, ca me propose
     encore un peu de la merde. »

   « J'ai une version de Daddy Cool mixee en version originale :
     ca me propose des morceaux vieillots. Si je prends la version
     remasterisee, ca me propose des morceaux actuels — et pourtant
     c'est la meme chanson. »

   Deux fichiers, une chanson, deux resultats. La cause est
   forcement dans ce qui DIFFERE entre les deux fichiers, et il n'y
   a que quatre candidats : les tags, ce que Liaison mesure, le
   chemin, et ce que le moteur en fait.

   Cet outil les met cote a cote. Il ne devine rien : il lit la
   vraie bibliotheque, analyse les vrais fichiers, et affiche les
   ecarts.

   USAGE
     node build/versions.js "daddy cool"
     node build/versions.js "boney m"
   ============================================================ */
const path = require('path');
const engine = require('../src/engine.js');
const epoque = require('../src/epoque.js');
const plancher = require('../src/plancher.js');
const genres = require('../src/genres.js');
const { charger } = require('./_biblio.js');
const { analyze, ffmpegPath } = require('../src/analyze.js');
const { spawnSync } = require('child_process');

const requete = process.argv.slice(2).join(' ').trim();
if (!requete) {
  console.log('\nUsage :  node build/versions.js "daddy cool"\n');
  process.exit(1);
}

const cadre = (t) => console.log('\n' + t + '\n' + '-'.repeat(t.length));
const col = (v, n) => String(v == null || v === '' ? '-' : v).padEnd(n);

function ffmpegDemarre() {
  try { const r = spawnSync(ffmpegPath(), ['-version']); return !r.error && r.status === 0; }
  catch (e) { return false; }
}

(async () => {
  const b = charger();
  if (b.erreur) { console.log('Lecture de la bibliotheque impossible : ' + b.erreur); process.exit(1); }
  const L = b.tracks;
  if (!L.length) {
    console.log('\nAucun morceau lu. Ouvre Liaison une fois, ou lance d\'abord :');
    console.log('    node build/diagnostic.js\n');
    process.exit(1);
  }
  console.log('\nBibliotheque : ' + L.length.toLocaleString('fr-FR') + ' morceaux  (' + b.source + ')');

  const q = engine.normalize(requete);
  const trouves = L.filter(t => engine.normalize((t.title || '') + ' ' + (t.artist || '')).indexOf(q) >= 0);

  if (!trouves.length) {
    console.log('\nAucun morceau ne contient « ' + requete +' ».');
    const proches = engine.search(requete, L, 5, 0.3);
    if (proches.length) {
      console.log('Le plus proche :');
      for (const p of proches) console.log('    ' + p.track.artist + ' - ' + p.track.title);
    }
    process.exit(0);
  }

  cadre(trouves.length + ' version(s) de « ' + requete + ' »');

  /* ---------- 1. ce que disent les tags ---------- */
  console.log('\n  CE QUE DISENT LES TAGS');
  console.log('  ' + col('#', 3) + col('titre', 34) + col('genre', 18) +
              col('tempo', 7) + col('ton', 5) + col('annee', 7) + 'famille');
  trouves.forEach((t, i) => {
    const fam = Array.from(genres.famillesDe(t).keys()).join('+') || '(aucune)';
    console.log('  ' + col(i + 1, 3) + col((t.title || '').slice(0, 32), 34) +
      col((t.genre || '').slice(0, 16), 18) + col(t.bpm > 0 ? t.bpm : null, 7) +
      col(t.key, 5) + col(t.year ? t.year + (t.anneeIncertaine ? '?' : '') : null, 7) + fam);
  });
  trouves.forEach((t, i) => console.log('  ' + col(i + 1, 3) + (t.path || '(sans fichier)')));

  /* ---------- 2. ce que Liaison mesure ---------- */
  const mesures = new Map();
  if (!ffmpegDemarre()) {
    console.log('\n  (ffmpeg ne demarre pas ici : mesures non faites)');
  } else {
    console.log('\n  CE QUE LIAISON MESURE LUI-MEME');
    console.log('  ' + col('#', 3) + col('tempo', 14) + col('tonalite', 16) +
                col('energie', 9) + 'timbre');
    for (let i = 0; i < trouves.length; i++) {
      const t = trouves[i];
      if (!t.path) { console.log('  ' + col(i + 1, 3) + 'pas de fichier'); continue; }
      try {
        const r = await analyze(t.path, { seconds: 90 });
        mesures.set(t.id, r);
        console.log('  ' + col(i + 1, 3) +
          col(r.bpm + ' (' + r.bpmConfidence + ')', 14) +
          col(r.key + ' (' + r.keyConfidence + ')', 16) +
          col(r.energy, 9) + JSON.stringify(r.timbre));
      } catch (e) {
        console.log('  ' + col(i + 1, 3) + 'ILLISIBLE : ' + e.message);
      }
    }
  }

  /* ---------- 3. ce que le moteur propose ---------- */
  console.log('\n  CE QUE LE MOTEUR PROPOSE APRES CHACUNE');
  const listes = [];
  trouves.forEach((t, i) => {
    /* On donne au moteur ce qu'il aurait vraiment : les tags,
       corriges par la mesure quand elle est sure. */
    const m = mesures.get(t.id);
    const vu = Object.assign({}, t);
    if (m) {
      if (m.bpmConfidence >= 0.55 && m.bpm > 40) vu.bpm = m.bpm;
      if (!vu.key && m.keyConfidence >= 0.72) vu.key = m.key;
      vu.energy = m.energy;
      vu.timbre = m.timbre;
      vu.analyzed = true;
    }
    const r = engine.suggest(vu, L, { limit: 5, arc: 'hold' });
    listes.push(r.map(x => x.track.id));
    console.log('\n  version ' + (i + 1) + ' — ' + (t.title || '') +
      '   [tempo ' + (vu.bpm > 0 ? vu.bpm : '-') + ', ton ' + (vu.key || '-') +
      ', energie ' + (vu.energy == null ? '-' : vu.energy) + ']');
    if (!r.length) { console.log('      (aucune proposition)'); return; }
    for (const x of r) {
      const an = x.track.year ? ' ' + x.track.year : '';
      console.log('      ' + col(x.total, 5) + (x.track.artist || '') + ' - ' + (x.track.title || '') + an);
    }
  });

  /* ---------- 4. le verdict ---------- */
  if (trouves.length < 2) {
    console.log('\n  Une seule version : rien a comparer.\n');
    return;
  }
  cadre('CE QUI DIFFERE, ET CE QUE CA COUTE');

  const communs = listes.reduce((a, b) => a.filter(x => b.indexOf(x) >= 0));
  console.log('\n  propositions communes a toutes les versions : ' +
              communs.length + ' sur 5');
  if (communs.length >= 4) {
    console.log('  -> les versions donnent quasiment la meme chose : la difference');
    console.log('     ressentie vient d\'ailleurs (filtres du soir, morceaux deja joues).');
  }

  const different = (champ, lire) => {
    const vus = trouves.map(lire);
    const uniques = Array.from(new Set(vus.map(v => JSON.stringify(v))));
    if (uniques.length <= 1) return;
    console.log('\n  ' + champ + ' DIFFERE d\'une version a l\'autre :');
    trouves.forEach((t, i) => console.log('      version ' + (i + 1) + ' : ' + JSON.stringify(vus[i])));
  };

  different('LE GENRE', t => t.genre || null);
  different('LA FAMILLE DE GENRE', t => Array.from(genres.famillesDe(t).keys()));
  different('L\'ANNEE', t => (t.year || null));
  different('LE TEMPO DES TAGS', t => (t.bpm > 0 ? t.bpm : null));
  different('LA TONALITE DES TAGS', t => t.key || null);
  if (mesures.size === trouves.length) {
    different('L\'ENERGIE MESUREE', t => (mesures.get(t.id) || {}).energy);
    different('LE TEMPO MESURE', t => (mesures.get(t.id) || {}).bpm);
  }
  different('LA FRAICHEUR (epoque.js)', t => epoque.fraicheur(t));
  different('LA FORCE DE PLANCHER', t => plancher.plancher(
    Object.assign({}, t, mesures.get(t.id)
      ? { energy: mesures.get(t.id).energy, timbre: mesures.get(t.id).timbre, analyzed: true }
      : {})).v);

  console.log('\n  Le genre et la famille pesent le plus lourd : parente 0,24 et');
  console.log('  salle 0,26 sur un total de 1. Deux rips du meme titre tagues');
  console.log('  « Disco » et « Pop » ne partent donc pas du meme monde.\n');
})().catch(e => { console.error('\n' + (e && e.message) + '\n'); process.exit(1); });
