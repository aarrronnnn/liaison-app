'use strict';
/* ============================================================
   « Des fois ca propose des trucs qui ne sont plus a la mode. »

   Le retour le plus frequent apres « les sons matchent pas
   assez ». Le moteur ignorait totalement les epoques : un titre
   de 2012 et un titre de la semaine derniere se valaient, du
   moment que le tempo et la tonalite collaient.

   Le piege, et c'est tout l'interet de ce fichier : « vieux » ne
   veut PAS dire « demode ». Un essai qui penaliserait l'age
   casserait les mariages, ou les classiques sont le repertoire.
   Ce qui se date, c'est l'annee CROISEE avec la famille.

   On verifie donc les deux sens : que le demode tombe, et que
   l'intemporel ne tombe pas.
   ============================================================ */
const engine = require('../src/engine.js');
const epoque = require('../src/epoque.js');
const lib = require('../src/library.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(54),
              detail ? '  — ' + detail : '');
}
const REF = 2026;
const t = (genre, year) => lib.finalize([{ path: '/m/' + genre + year + Math.random() + '.mp3',
  title: 't', artist: 'a', genre: genre, year: year, bpm: 126, key: '8A', duration: 210, pop: 60 }])[0];

/* ---------- 1. ce qui se date, se date ---------- */
{
  const vieuxEdm = epoque.fraicheur(t('EDM', 2012), REF);
  const neufEdm = epoque.fraicheur(t('EDM', 2025), REF);
  verifier('1. la big room de 2012 est notee basse', vieuxEdm < 30, 'fraicheur ' + vieuxEdm);
  verifier('1bis. celle de 2025 est au maximum', neufEdm >= 95, 'fraicheur ' + neufEdm);
}

/* ---------- 2. ce qui ne se date pas ne tombe jamais ----------
   C'est la moitie qui compte le plus : un mariage se joue avec
   des morceaux de quarante ans. */
{
  for (const [g, an] of [['Motown', 1968], ['Disco', 1978], ['Funk', 1976],
                         ['Variete francaise', 1996], ['Hymne', 1985]]) {
    const f = epoque.fraicheur(t(g, an), REF);
    verifier('2. ' + (g + ' ' + an).padEnd(26) + ' reste jouable', f >= 88, 'fraicheur ' + f);
  }
}

/* ---------- 3. le retour en grace ----------
   La trance de 1999 a ete ringarde ; elle ne l'est plus tout a
   fait. La courbe doit remonter, sans revenir au neuf. */
{
  const creux = epoque.fraicheur(t('Trance', 2012), REF);
  const vintage = epoque.fraicheur(t('Trance', 1999), REF);
  verifier('3. le creux de la ringardise est bien le milieu',
           vintage > creux, 'a 14 ans : ' + creux + ', a 27 ans : ' + vintage);
  verifier('3bis. sans pour autant redevenir du neuf', vintage < 80, 'fraicheur ' + vintage);
}

/* ---------- 4. l'annee inconnue n'est jamais punie ----------
   La lecon deja payee sur l'energie des morceaux non analyses :
   ne rien savoir ne doit jamais couter cher. */
{
  const sansAn = epoque.fraicheur(t('House', null), REF);
  const datee = epoque.fraicheur(t('EDM', 2012), REF);
  verifier('4. sans annee, la note est neutre', sansAn >= 55 && sansAn <= 70, 'fraicheur ' + sansAn);
  verifier('4bis. et toujours meilleure qu\'un titre vraiment date',
           sansAn > datee, sansAn + ' contre ' + datee);
  const inconnuGenre = epoque.fraicheur(t('Bagad breton', 1998), REF);
  verifier('4ter. un genre inconnu n\'est pas date d\'office',
           inconnuGenre >= 70, 'fraicheur ' + inconnuGenre);
}

/* ============================================================
   5. Le cas signale, de bout en bout : depuis un titre actuel,
      la big room de 2012 ne doit plus passer devant.
   ============================================================ */
{
  /* Le titre date est rendu MAXIMALEMENT attirant sur tous les
     anciens axes : meme famille, meme tempo, meme tonalite que le
     morceau en cours, et plus connu que les autres. S'il tombe
     quand meme, c'est bien la fraicheur qui l'a fait tomber — et
     pas un hasard de fixture. */
  const mk = (i, g, y, k, bpm, pop) => ({ path: '/m/y' + i + '.mp3', artist: 'A' + i,
    title: g + ' ' + y, genre: g, year: y, bpm: bpm, key: k, duration: 210, pop: pop });
  const bib = lib.finalize([
    mk(0, 'EDM', 2024, '8A', 128, 70),          /* ce qui tourne */
    mk(1, 'EDM', 2012, '8A', 128, 95),          /* parfait partout, sauf l'epoque */
    mk(2, 'Tech House', 2025, '9A', 126, 60),
    mk(3, 'House', 2023, '7A', 125, 58),
    mk(4, 'EDM', 2025, '5A', 131, 55)]);

  const r = engine.suggest(bib[0], bib, { limit: 4, arc: 'hold', annee: 2026 });
  const noms = r.map(x => x.track.title);
  const rang = noms.indexOf('EDM 2012');

  /* ---------- le temoin ----------
     On rejoue le meme cas en reduisant l'axe a son minimum : c'est
     le comportement d'avant. Le titre date doit y etre PREMIER. */
  const ancien = engine.suggest(bib[0], bib, { limit: 4, arc: 'hold', annee: 2026, poids: { fr: 0.5 } });
  const avant = ancien.map(x => x.track.title).indexOf('EDM 2012');
  console.log('\n  temoin — axe reduit au minimum, le titre de 2012 sort en position %s',
              avant === -1 ? 'hors liste' : (avant + 1));
  if (avant !== 0) {
    echecs++;
    console.error('  RATE le temoin ne reproduit pas le defaut : ce cas ne prouve rien.');
  }
  verifier('5. avec l\'axe, le titre de 2012 recule',
           rang > avant, 'de la position ' + (avant + 1) + ' a la position ' +
           (rang === -1 ? 'hors liste' : (rang + 1)) + '  —  ' + noms.join(' | '));
  verifier('5bis. et c\'est un titre actuel qui prend sa place',
           /2025|2023|2024/.test(noms[0]), 'premier : ' + noms[0]);
}

if (echecs) {
  console.error('\n' + echecs + ' cas d\'epoque en echec.');
  process.exit(1);
}
console.log('\nepoque : le demode tombe, le classique reste.');
