'use strict';
/* ============================================================
   Banc — la fenetre de tempo, et d'ou viennent les chiffres.

   Ce fichier repond a trois retours du 18 septembre 2026, dans
   l'ordre ou ils ont ete donnes :

     « Il faut que le BPM soit hyper proche du son actuel : quand
       on mixe un son a 128 il faut qu'on soit autour de ce BPM
       pour pouvoir bien mixer deux musiques ensemble. »

     « Liaison me donne des donnees fausses sur les sons. Pour lui
       Mamma Mia est a 105 BPM, alors que c'est un son a 130. En
       plus il ne donne jamais la cle des musiques. »

     « J'ai supprime des musiques de ma bibliotheque et pourtant
       Liaison me les propose toujours au mix. »

   Chaque cas verifie le comportement, pas l'implementation : on
   demande des propositions, et on regarde ce qui sort.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const { AnalysisService } = require('../src/analysis.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(58),
              detail ? '  — ' + detail : '');
}

let n = 0;
const t = (o) => lib.finalize([Object.assign({
  path: '/m/' + (++n) + '.mp3', duration: 220, pop: 60, genre: 'House',
  key: '8A', energy: 6, timbre: [5, 5, 5], analyzed: true
}, o)])[0];

const nom = x => x.title;

/* ============================================================
   1. LA FENETRE — ce qui se cale passe devant, toujours.
   ============================================================ */
{
  const joue = t({ title: 'joue', bpm: 128 });
  /* Un vivier large : du cale, du limite, et du franchement loin. */
  const bib = [
    t({ title: 'cale-128', bpm: 128 }),
    t({ title: 'cale-129', bpm: 129 }),
    t({ title: 'cale-126', bpm: 126.5 }),
    t({ title: 'limite-124', bpm: 124 }),      /* -3,1 % : juste dehors */
    t({ title: 'loin-140', bpm: 140 }),        /* +9,4 % */
    t({ title: 'loin-100', bpm: 100 }),        /* -21,9 % */
    t({ title: 'moitie-64', bpm: 64 })         /* le demi-tempo */
  ];
  const r = engine.suggest(joue, bib, { limit: 3, arc: 'hold' });
  const noms = r.map(x => nom(x.track));
  verifier('1. a 128, les trois propositions sont dans les 3 %',
           r.every(x => Math.abs(x.tempo.pct) <= 3), noms.join(', '));
  verifier('1bis. le 140 et le 100 ne sortent pas',
           !noms.includes('loin-140') && !noms.includes('loin-100'), noms.join(', '));
  verifier('1ter. le demi-tempo a 64 ne sort plus du tout',
           !noms.includes('moitie-64'),
           'note de tempo pour 64 derriere 128 : ' + Math.round(engine.tempoScore(128, 64).s));
  verifier('1quater. et aucune ligne n\'est marquee hors fenetre',
           r.every(x => !x.horsFenetre));
}

/* ============================================================
   2. LE REPLI — une fenetre serree ne doit jamais vider le widget.

   C'est la contrepartie obligatoire du cas 1. Un DJ de mariage
   dont la bibliotheque est eparpillee entre 90 et 150 BPM ne doit
   pas se retrouver devant un ecran vide : il doit voir ce qu'il y
   a, en sachant que ca se coupe au lieu de se caler.
   ============================================================ */
{
  const joue = t({ title: 'joue2', bpm: 128 });
  const bib = [
    t({ title: 'a-100', bpm: 100 }),
    t({ title: 'b-146', bpm: 146 }),
    t({ title: 'c-95', bpm: 95 })
  ];
  const r = engine.suggest(joue, bib, { limit: 3, arc: 'hold' });
  verifier('2. rien dans les 3 % : on propose quand meme',
           r.length === 3, r.map(x => nom(x.track)).join(', '));
  verifier('2bis. et tout est marque hors fenetre',
           r.every(x => x.horsFenetre === true),
           'marques : ' + r.map(x => x.horsFenetre).join(', '));

  /* Et l'inverse : des qu'il y a de quoi remplir dans la fenetre,
     on n'elargit pas. Le repli est une issue de secours, pas une
     habitude. */
  const melange = bib.concat([
    t({ title: 'd-128', bpm: 128 }), t({ title: 'e-127', bpm: 127 }),
    t({ title: 'f-129', bpm: 129 })
  ]);
  const r2 = engine.suggest(joue, melange, { limit: 3, arc: 'hold' });
  verifier('2ter. des qu\'il y a de quoi caler, on n\'elargit pas',
           r2.every(x => !x.horsFenetre),
           r2.map(x => nom(x.track)).join(', '));
}

/* ============================================================
   3. LE MORCEAU SUPPRIME — il ne doit plus rien proposer.
   ============================================================ */
{
  const joue = t({ title: 'joue3', bpm: 128 });
  const vivant = t({ title: 'vivant', bpm: 128 });
  const efface = t({ title: 'efface', bpm: 128, pop: 99 });
  efface.disparu = true;
  const debranche = t({ title: 'debranche', bpm: 128, pop: 99 });
  debranche.offline = true;
  const r = engine.suggest(joue, [vivant, efface, debranche], { limit: 5, arc: 'hold' });
  const noms = r.map(x => nom(x.track));
  verifier('3. un fichier efface n\'est plus propose',
           !noms.includes('efface'), noms.join(', '));
  /* Le hors ligne, lui, est relegue et non ecarte : un volume qui ne
     repond pas revient souvent avant la fin du morceau en cours, et
     vider le widget d'un coup serait pire que de faire patienter. */
  verifier('3bis. un fichier sur un disque debranche passe en dernier',
           noms.indexOf('debranche') === noms.length - 1 && noms[0] === 'vivant',
           noms.join(', '));
  verifier('3ter. le sauvetage les ecarte aussi',
           !engine.rescue(joue, [vivant, efface, debranche], { limit: 3 })
             .map(x => nom(x.track)).some(x => x !== 'vivant'));

  /* Et l'elagage a l'import : volume present, fichier absent. */
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-'));
  const present = path.join(dossier, 'a.mp3');
  fs.writeFileSync(present, 'x');
  const e = lib.elaguerDisparus([
    { path: present, title: 'present' },
    { path: path.join(dossier, 'parti.mp3'), title: 'parti' }
  ]);
  verifier('3quater. elagage : le fichier absent sort de la bibliotheque',
           e.gardes.length === 1 && e.disparus.length === 1 &&
           e.gardes[0].title === 'present',
           'gardes ' + e.gardes.length + ', retires ' + e.disparus.length);

  /* Le cas inverse, celui qui coute le plus cher : un volume entier
     qui ne repond pas. On ne doit RIEN retirer. */
  const eVol = lib.elaguerDisparus([
    { path: '/Volumes/SSD-du-DJ-qui-nexiste-pas/a.mp3', title: 'sur le SSD' }
  ]);
  verifier('3quinquies. disque debranche : on ne retire rien',
           eVol.disparus.length === 0 && eVol.horsLigne === 1 &&
           eVol.gardes[0].offline === true,
           'retires ' + eVol.disparus.length + ', hors ligne ' + eVol.horsLigne);
}

/* ============================================================
   4. MAMMA MIA — d'ou vient le chiffre decide qui gagne.
   ============================================================ */
function mesurer(track, patch) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-a-'));
  const s = new AnalysisService(path.join(dossier, 'cache.json'), {});
  s.sansFils = true;                       /* aucun fil : on injecte le resultat */
  s.tracks.set(track.id, track);
  s.file.set(track.id, { priorite: 0, stamp: null });
  s.encours.add(track.id);
  const faux = { job: track.id };
  s._resultat(faux, { id: track.id, ok: true, patch: patch });
  s.stop();
  return track;
}

/* Le vrai cas : un champ iTunes a 105 sur un morceau a 130. */
const MESURE_SURE = { energy: 8, timbre: [5, 5, 5], vocal: 1,
                      mBpm: 130, mBpmConf: 0.8, mKey: '5A', mKeyConf: 0.8, mKeyMarge: 0.1 };
{
  const itunes = t({ title: 'Mamma Mia', bpm: 105, bpmSrc: 'itunes', key: null, analyzed: false });
  itunes.bpmSrc = 'itunes';
  mesurer(itunes, MESURE_SURE);
  verifier('4. un BPM iTunes faux est corrige par la mesure',
           itunes.bpm === 130 && itunes.bpmSource === 'liaison',
           itunes.bpm + ' BPM, source ' + itunes.bpmSource +
           ', ancien tag garde : ' + itunes.bpmTag);

  /* Le meme chiffre, mais venu d'une grille rekordbox : on ne le
     touche pas. Le DJ mixe sur SA grille, pas sur notre peigne. */
  const rb = t({ title: 'Mamma Mia rb', bpm: 105, key: '8A', analyzed: false });
  rb.bpmSrc = 'rekordbox'; rb.keySrc = 'rekordbox';
  mesurer(rb, MESURE_SURE);
  verifier('4bis. un BPM rekordbox n\'est jamais ecrase',
           rb.bpm === 105 && rb.bpmSource === 'rekordbox' && rb.bpmDoute === true,
           rb.bpm + ' BPM, source ' + rb.bpmSource + ', desaccord signale : ' + !!rb.bpmDoute);

  /* L'octave : rekordbox mis a part, un tag a 140 confirme par une
     mesure a 70 reste a 140. C'est le meme rythme, et c'est SA
     lecture. */
  const octave = t({ title: 'octave', bpm: 140, analyzed: false });
  octave.bpmSrc = 'tag';
  mesurer(octave, Object.assign({}, MESURE_SURE, { mBpm: 70, mBpmConf: 0.8 }));
  verifier('4ter. l\'octave du DJ est conservee',
           octave.bpm === 140, octave.bpm + ' BPM, source ' + octave.bpmSource);
}

/* ============================================================
   4bis. LE CACHE — l'arbitrage doit y passer AUSSI.

   Le piege le plus cher de tout ce fichier. Chez un DJ qui
   utilise deja Liaison, la quasi-totalite des morceaux arrive par
   le cache d'analyse : le calcul a deja ete fait un autre soir.
   Si l'arbitrage ne tourne que sur une analyse fraiche, corriger
   la regle ne change RIEN chez lui — il installe la mise a jour
   et Mamma Mia reste a 105 pour toujours.
   ============================================================ */
{
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-c-'));
  const fichier = path.join(dossier, 'x.mp3');
  fs.writeFileSync(fichier, 'x');
  const cache = path.join(dossier, 'cache.json');

  /* Premier soir : on mesure, et le resultat part au cache. */
  const soir1 = t({ title: 'Mamma Mia', bpm: 105, key: null, analyzed: false });
  soir1.path = fichier; soir1.bpmSrc = 'itunes';
  const s1 = new AnalysisService(cache, {});
  s1.sansFils = true;
  s1.tracks.set(soir1.id, soir1);
  s1.file.set(soir1.id, { priorite: 0, stamp: AnalysisService ? require('../src/analysis.js').AnalysisCache.stamp(fichier) : null });
  s1.encours.add(soir1.id);
  s1._resultat({ job: soir1.id }, { id: soir1.id, ok: true, patch: MESURE_SURE });
  s1.cache.save(); s1.stop();

  /* Deuxieme soir : rien n'est recalcule, tout vient du cache. */
  const soir2 = t({ title: 'Mamma Mia', bpm: 105, key: null, analyzed: false });
  soir2.path = fichier; soir2.bpmSrc = 'itunes';
  const s2 = new AnalysisService(cache, {});
  s2.sansFils = true;
  const bilan = s2.charger([soir2]);
  s2.stop();
  verifier('4quater. le cache aussi passe par l\'arbitrage',
           bilan.caches === 1 && soir2.bpm === 130 && soir2.key === '5A',
           'depuis le cache : ' + soir2.bpm + ' BPM, cle ' + soir2.key);
}

/* ============================================================
   5. LA CLE — donnee dans tous les cas ou on sait la calculer.
   ============================================================ */
{
  /* Une bibliotheque iTunes n'a aucune tonalite : c'est le cas qui
     remplissait le widget de « ? ». */
  const vide = t({ title: 'sans cle', bpm: 128, key: null, analyzed: false });
  mesurer(vide, MESURE_SURE);
  verifier('5. une tonalite absente est comblee',
           vide.key === '5A' && vide.keySource === 'liaison', vide.key);

  /* Et meme quand la mesure n'est pas sure : « 8A ? » vaut mieux
     qu'un « ? ». On le dit par la source, le widget l'affiche en
     gris avec un point d'interrogation. */
  const flou = t({ title: 'cle incertaine', bpm: 128, key: null, analyzed: false });
  mesurer(flou, Object.assign({}, MESURE_SURE, { mKeyConf: 0.4, mKeyMarge: 0.01 }));
  verifier('5bis. une mesure peu sure comble quand meme, en le disant',
           flou.key === '5A' && flou.keySource === 'liaison-incertain',
           flou.key + ' (' + flou.keySource + ')');

  /* Mais elle ne CONTREDIT rien : contre une tonalite existante, le
     seuil severe reste. */
  const tenu = t({ title: 'cle posee', bpm: 128, key: '8A', analyzed: false });
  tenu.keySrc = 'rekordbox';
  mesurer(tenu, Object.assign({}, MESURE_SURE, { mKeyConf: 0.4, mKeyMarge: 0.01 }));
  verifier('5ter. une mesure peu sure ne contredit pas une tonalite posee',
           tenu.key === '8A', tenu.key + ' (' + tenu.keySource + ')');
}

/* ============================================================
   6. LA FUSION — la source la plus fiable gagne, quel que soit
      l'ordre de detection.
   ============================================================ */
{
  const autolib = require('../src/autolibrary.js');
  const itunes = [{ path: '/m/x.mp3', title: 'X', bpm: 105, bpmSrc: 'itunes', key: null }];
  const rekord = [{ path: '/m/x.mp3', title: 'X', bpm: 130, bpmSrc: 'rekordbox', key: '5A', keySrc: 'rekordbox' }];
  const a = autolib.merge([itunes, rekord])[0];
  const b = autolib.merge([rekord, itunes])[0];
  verifier('6. iTunes d\'abord : rekordbox gagne quand meme',
           a.bpm === 130 && a.bpmSrc === 'rekordbox', a.bpm + ' (' + a.bpmSrc + ')');
  verifier('6bis. et l\'ordre inverse donne le meme resultat',
           b.bpm === 130 && b.bpmSrc === 'rekordbox', b.bpm + ' (' + b.bpmSrc + ')');
}

if (echecs) {
  console.error('\n' + echecs + ' cas de fenetre en echec.');
  process.exit(1);
}
console.log('\nfenetre : ce qui se cale passe devant, et les chiffres disent d\'ou ils viennent.');
