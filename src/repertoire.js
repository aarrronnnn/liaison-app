'use strict';
/* ============================================================
   Liaison — le repertoire du DJ, et ce qui n'en fait pas partie.

   « Certains DJ ont des sons bizarres d'autres pays dans la
     bibliotheque. Ceux-la on va eviter de les proposer. »

   Le probleme est reel et il est banal : une bibliotheque de DJ
   n'est pas une selection, c'est une SEDIMENTATION. Dix ans de
   packs telecharges, de cles USB de collegues, de morceaux
   recuperes pour un mariage precis et jamais rejoues. Il y traine
   trente titres en cyrillique, un pack de schlager allemand, et
   quatre heures de musique de ceremonie. Aucun n'est mauvais ;
   simplement, ce DJ-la ne les joue pas, et les voir remonter dans
   les propositions un samedi soir lui fait perdre la seule chose
   qu'il n'a pas : du temps.

   ------------------------------------------------------------
   CE QU'ON NE FAIT PAS

   On ne dresse aucune liste de langues, de pays ou de genres
   « exotiques ». Ce serait faux autant que laid : le repertoire
   normal d'un DJ marocain a Bruxelles est le corps etranger d'un
   DJ de mariage en Bourgogne, et l'inverse est tout aussi vrai.
   Une liste ecrite ici trancherait pour eux deux, et se
   tromperait au moins une fois sur deux.

   ------------------------------------------------------------
   CE QU'ON FAIT

   On mesure le CENTRE DE GRAVITE de SA bibliotheque, sur deux
   axes qu'on sait lire sans rien deviner :

     — L'ECRITURE des titres et des noms d'artistes. Elle se
       compte caractere par caractere : latin, cyrillique, arabe,
       grec, hebreu, han, kana, hangul, devanagari, thai. Ce n'est
       pas la langue — « Despacito » et « Bella ciao » sont en
       latin comme le reste — mais c'est exactement le signal qui
       separe les trente titres qui ne ressemblent a rien du
       catalogue du DJ.

     — LA FAMILLE DE GENRE, que genres.js sait deja rapprocher.
       Un pack de schlager dans une bibliotheque qui n'en contient
       rien d'autre se detache pareillement, sans avoir besoin
       qu'on sache ce qu'est le schlager.

   Un morceau dont l'ecriture ou la famille represente une part
   infime de la bibliotheque est un corps etranger : il est
   RELEGUE, jamais ecarte. Il reste trouvable a la loupe, il sort
   si le client le demande, et il remonte des que le DJ en joue un.
   C'est la regle de tout ce moteur : on trie, on ne jette pas.

   Et la porte s'ouvre toute seule. Des que le DJ lance un titre
   d'une ecriture ou d'une famille, celle-ci cesse d'etre etrangere
   pour le reste de la soiree. Un DJ qui attaque son bloc oriental
   a minuit n'a rien a regler : il joue le premier titre, et
   Liaison suit.
   ============================================================ */
const genres = require('./genres');

/* ------------------------------------------------------------
   La famille dominante d'un morceau.

   genres.famillesDe() rend une MAP (famille -> surete), pas un
   tableau. Le confondre avec un tableau ne plante pas : « .length »
   vaut undefined, le test est faux, et l'axe des familles se tait
   sur TOUTE la bibliotheque — silencieusement, exactement comme le
   defaut que gout.js raconte plus haut dans ce depot. Le banc
   test-repertoire.js couvre ce cas depuis.

   On prend la famille la plus sure, et a egalite la premiere : un
   morceau vaut une voix, pas cinq.
   ------------------------------------------------------------ */
function familleDe(track) {
  const m = genres.famillesDe(track);
  if (!m || !m.size) return null;
  let best = null, sur = -1;
  for (const [f, s] of m) if (s > sur) { sur = s; best = f; }
  return best;
}

/* ------------------------------------------------------------
   Les ecritures, par plages de caracteres.

   On ne compte que les LETTRES : les chiffres, la ponctuation et
   les espaces sont les memes partout et ne disent rien. Un titre
   comme « 7 (feat. X) » ne doit pas etre classe latin sur ses
   parentheses.
   ------------------------------------------------------------ */
const PLAGES = [
  ['latin',       [[0x41, 0x5A], [0x61, 0x7A], [0xC0, 0x24F], [0x1E00, 0x1EFF]]],
  ['grec',        [[0x370, 0x3FF], [0x1F00, 0x1FFF]]],
  ['cyrillique',  [[0x400, 0x4FF], [0x500, 0x52F]]],
  ['hebreu',      [[0x590, 0x5FF]]],
  ['arabe',       [[0x600, 0x6FF], [0x750, 0x77F], [0x8A0, 0x8FF]]],
  ['devanagari',  [[0x900, 0x97F]]],
  ['bengali',     [[0x980, 0x9FF]]],
  ['thai',        [[0xE00, 0xE7F]]],
  ['georgien',    [[0x10A0, 0x10FF]]],
  ['armenien',    [[0x530, 0x58F]]],
  ['ethiopien',   [[0x1200, 0x137F]]],
  ['kana',        [[0x3040, 0x30FF]]],
  ['han',         [[0x3400, 0x4DBF], [0x4E00, 0x9FFF], [0xF900, 0xFAFF]]],
  ['hangul',      [[0x1100, 0x11FF], [0xAC00, 0xD7AF], [0x3130, 0x318F]]]
];

function ecritureDe(code) {
  for (const [nom, plages] of PLAGES)
    for (const [a, b] of plages) if (code >= a && code <= b) return nom;
  return null;
}

/**
 * L'ecriture dominante d'un morceau, d'apres son titre et son artiste.
 * @returns {string|null} null quand on n'a pas de quoi trancher —
 *          et « pas de quoi trancher » ne doit JAMAIS couter des points.
 */
function ecritureDe1(track) {
  const s = String((track && track.title) || '') + ' ' + String((track && track.artist) || '');
  const compte = new Map();
  let lettres = 0;
  for (const ch of s) {
    const e = ecritureDe(ch.codePointAt(0));
    if (!e) continue;
    lettres++;
    compte.set(e, (compte.get(e) || 0) + 1);
  }
  /* Moins de trois lettres : un titre numerique, un nom de fichier
     vide, un tag casse. On ne conclut rien. */
  if (lettres < 3) return null;
  let best = null, n = -1;
  for (const [e, c] of compte) if (c > n) { n = c; best = e; }
  /* ------------------------------------------------------------
     Le latin qui n'est qu'un habillage.

     « Мельница (Melnitsa) — Дорога сна » porte autant de latin que
     de cyrillique a cause de la translitteration entre parentheses,
     et « BTS (방탄소년단) » de meme. Compter le simple maximum ferait
     passer ces titres pour latins. Des qu'une ecriture non latine
     represente un tiers des lettres, c'est elle qui decrit le
     morceau : le latin, lui, est partout.
     ------------------------------------------------------------ */
  if (best === 'latin') {
    for (const [e, c] of compte) {
      if (e !== 'latin' && c / lettres >= 0.33) return e;
    }
  }
  return best;
}

/**
 * Le centre de gravite d'une bibliotheque.
 * Calcule UNE FOIS par import, jamais par suggestion : c'est un
 * parcours de toute la bibliotheque, soit quelques dizaines de
 * millisecondes sur vingt-deux mille titres — negligeable a
 * l'import, insupportable a chaque changement de morceau.
 */
function centre(library) {
  const ecritures = new Map(), familles = new Map();
  let nEcriture = 0, nFamille = 0;
  for (const t of library || []) {
    const e = ecritureDe1(t);
    if (e) { ecritures.set(e, (ecritures.get(e) || 0) + 1); nEcriture++; }
    const f = familleDe(t);
    if (f) { familles.set(f, (familles.get(f) || 0) + 1); nFamille++; }
  }
  return { ecritures: ecritures, familles: familles,
           nEcriture: nEcriture, nFamille: nFamille, n: (library || []).length };
}

/* En dessous de cette part de la bibliotheque, une ecriture ou une
   famille est un corps etranger. Deux pour cent : sur dix mille
   titres, ca veut dire moins de deux cents. Au-dela, ce n'est plus
   une poche oubliee, c'est une partie du repertoire. */
const SEUIL = 0.02;
/* Et en dessous de ce nombre de titres, la mesure ne veut rien
   dire : une bibliotheque de trente morceaux n'a pas de centre de
   gravite, elle n'a que des exceptions. */
const MINI = 300;

/**
 * Ce morceau appartient-il au repertoire du DJ ?
 * @param {object} track
 * @param {object} c        le centre rendu par centre()
 * @param {Set}    ouvertes ecritures et familles que le DJ a deja jouees
 * @returns {number} 0 a 100 — 100 = pleinement dans son repertoire
 */
function score(track, c, ouvertes) {
  /* Pas de centre mesurable : l'axe se tait plutot que d'inventer. */
  if (!c || c.n < MINI) return 100;
  const ouv = ouvertes || new Set();
  let note = 100;

  const e = ecritureDe1(track);
  if (e && c.nEcriture >= MINI) {
    if (ouv.has('e:' + e)) return 100;            /* il en a joue un : la porte est ouverte */
    const part = (c.ecritures.get(e) || 0) / c.nEcriture;
    if (part < SEUIL) {
      /* De 8 (un titre isole) a 55 (juste sous le seuil) : la chute
         est franche, mais elle laisse le morceau exister. */
      note = Math.min(note, 8 + Math.round((part / SEUIL) * 47));
    }
  }

  const f = familleDe(track);
  if (f && c.nFamille >= MINI) {
    if (ouv.has('f:' + f)) return 100;
    const part = (c.familles.get(f) || 0) / c.nFamille;
    /* Une famille rare pese moins lourd qu'une ecriture rare : une
       bibliotheque contient legitimement quelques genres peu
       representes, et un DJ pioche dedans sans que ce soit une
       erreur. Une ecriture rare, elle, est presque toujours un
       residu de pack. */
    if (part < SEUIL) note = Math.min(note, 45 + Math.round((part / SEUIL) * 40));
  }
  return note;
}

/** Ce qu'on affiche au DJ quand un morceau est relegue. */
function raison(track, c) {
  if (!c || c.n < MINI) return null;
  const e = ecritureDe1(track);
  if (e && c.nEcriture >= MINI) {
    const part = (c.ecritures.get(e) || 0) / c.nEcriture;
    if (part < SEUIL) return 'rare dans ta bibliotheque';
  }
  const f = familleDe(track);
  if (f && c.nFamille >= MINI) {
    const part = (c.familles.get(f) || 0) / c.nFamille;
    if (part < SEUIL) return f + ' : rare chez toi';
  }
  return null;
}

/** Les portes qu'un morceau joue ouvre, pour le reste de la soiree. */
function ouvrir(track, ouvertes) {
  const s = ouvertes || new Set();
  const e = ecritureDe1(track);
  if (e) s.add('e:' + e);
  const f = familleDe(track);
  if (f) s.add('f:' + f);
  return s;
}

module.exports = { centre, score, raison, ouvrir, ecritureDe1, familleDe, SEUIL, MINI };
