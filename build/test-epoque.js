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
   ne rien savoir ne doit jamais couter cher.

   Ce cas demandait une note « neutre », entre 55 et 70, quelle que
   soit la famille. C'etait contraire a la these du module lui-meme :
   si le disco ne se date pas, alors ignorer l'annee d'un disco ne
   devrait rien changer du tout — et le mettre a 62 le punit d'une
   ignorance qui ne lui coute rien.

   Le defaut s'est vu en reparant les reeditions (cas 6) : un
   pressage de 1976 obtenait 98, le meme disque remasterise tombait
   a 62. On corrigeait une erreur de 2 points par une erreur de 36.

   La regle testee devient donc : l'ignorance coute EN PROPORTION de
   ce que la famille doit a son epoque. L'intention d'origine — ne
   jamais punir l'inconnu — est tenue plus serieusement qu'avant,
   pas relachee. */
{
  const sansAn = epoque.fraicheur(t('House', null), REF);
  const datee = epoque.fraicheur(t('EDM', 2012), REF);
  const houseDate = epoque.fraicheur(t('House', 2012), REF);
  verifier('4. sans annee, on ne perd jamais plus que ce que le genre doit a son epoque',
           sansAn >= houseDate, 'sans annee ' + sansAn + ', house de 2012 ' + houseDate);
  verifier('4bis. et toujours meilleure qu\'un titre vraiment date',
           sansAn > datee, sansAn + ' contre ' + datee);

  /* Ce que la nouvelle regle apporte : l'ignorance ne coute presque
     rien a une famille intemporelle, et cher a une famille qui vit
     de son epoque. Un seul chiffre pour les deux serait faux deux
     fois. */
  const discoSansAn = epoque.fraicheur(t('Disco', null), REF);
  const edmSansAn = epoque.fraicheur(t('EDM', null), REF);
  verifier('4bis-a. ne pas dater un disco ne coute presque rien',
           discoSansAn >= 95, 'fraicheur ' + discoSansAn);
  verifier('4bis-b. ne pas dater de l\'EDM coute cher, et c\'est normal',
           edmSansAn <= 70, 'fraicheur ' + edmSansAn);
  verifier('4bis-c. les deux ne peuvent pas porter la meme note',
           discoSansAn - edmSansAn >= 20, discoSansAn + ' contre ' + edmSansAn);

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

/* ============================================================
   LE REMASTER : MEME CHANSON, AUTRE ANNEE.

   « J'ai une version de Daddy Cool mixee en version originale.
     Quand je la mets, ca me propose des morceaux vieillots. Si je
     prends la version remasterisee, ca me propose des morceaux
     actuels — et pourtant c'est la meme chanson. »

   Deux fichiers, une chanson, deux annees : celle du pressage et
   celle de la reedition. Le tag ne ment pas, il repond a une autre
   question que la notre.
   ============================================================ */
{
  const L = require('../src/library.js');
  const epoque = require('../src/epoque.js');
  const bulle = require('../src/bulle.js');

  const original = L.anneeDeLaMusique({ title: 'Daddy Cool', date: '1976' });
  const remaster = L.anneeDeLaMusique({ title: 'Daddy Cool (2010 Remaster)', date: '2010' });
  const avecOrigine = L.anneeDeLaMusique({ title: 'Daddy Cool', date: '2010', originalyear: '1976' });
  const neuf = L.anneeDeLaMusique({ title: 'Levitating', date: '2020' });

  verifier('6. le pressage d\'origine garde son annee',
           original.an === 1976 && !original.incertaine, 'annee ' + original.an);
  verifier('6bis. le tag d\'annee d\'origine, quand il existe, fait foi',
           avecOrigine.an === 1976 && !avecOrigine.incertaine,
           'annee ' + avecOrigine.an + ' au lieu de 2010');
  verifier('6ter. sans ce tag, l\'annee d\'une reedition est declaree incertaine',
           remaster.incertaine === true, 'annee ' + remaster.an + ', incertaine');
  verifier('6quater. une vraie nouveaute n\'est pas soupconnee',
           neuf.an === 2020 && !neuf.incertaine, 'annee ' + neuf.an);

  /* Et surtout : les deux versions doivent etre notees PAREIL. */
  const commeMorceau = (r) => ({ title: 'Daddy Cool', artist: 'Boney M.', genre: 'Disco',
    tags: ['disco'], bpm: 126, key: '9A', year: r.an, anneeIncertaine: r.incertaine });
  const fO = epoque.fraicheur(commeMorceau(original), 2026);
  const fR = epoque.fraicheur(commeMorceau(remaster), 2026);
  verifier('6quinquies. les deux versions ne sont plus datees differemment',
           Math.abs(fO - fR) <= 4, 'fraicheur ' + fO + ' contre ' + fR);

  /* Dans une bulle « annees 70 », le remaster ne doit pas etre
     exclu comme s'il datait de 2010. */
  verifier('6sexies. et une bulle d\'epoque ne l\'exclut pas non plus',
           bulle.anneeDe(commeMorceau(remaster)) === null,
           'annee vue par la bulle : ' + bulle.anneeDe(commeMorceau(remaster)));
}

if (echecs) {
  console.error('\n' + echecs + ' cas d\'epoque en echec.');
  process.exit(1);
}
console.log('\nepoque : le demode tombe, le classique reste.');
