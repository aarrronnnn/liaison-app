'use strict';
/* ============================================================
   Le pont entre les genres d'une bibliotheque et ceux d'un pack.

   Le probleme, trouve en jouant une vraie soiree : le pack
   « France — Mariage » porte « variete » a 80, et un morceau
   etiquete « Chanson francaise » obtenait 7 sur 100. Meme chose
   pour « Afro House » face a « afro », « Hip Hop » face a
   « rap fr », « Latin » face a « reggaeton ». Le rapprochement se
   faisait par chaine exacte, et personne n'ecrit ses tags avec le
   vocabulaire d'un autre.

   Consequence en cabine : a un mariage francais, Liaison ecartait
   la chanson francaise. C'est exactement l'inverse de ce qu'il
   fallait faire.

   On rapproche donc en trois temps, du plus sur au plus souple :

     1. le tag exact, apres mise a plat des accents et des
        separateurs ;
     2. une table de synonymes, ecrite a la main, qui dit que
        « chanson francaise », « variete francaise » et « french
        pop » designent la meme famille ;
     3. l'inclusion de mots : « deep house » touche « house »,
        « rap francais » touche « rap fr ».

   Ce qui n'est pas fait, volontairement : deviner. Un genre qu'on
   ne reconnait pas garde une note neutre plutot qu'une note
   inventee. Mieux vaut ignorer un morceau que le pousser pour de
   mauvaises raisons.
   ============================================================ */

/** Mise a plat : accents, separateurs, esperluettes, pluriels usuels. */
function aplatir(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[_\-/|,;.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------
   Les familles.

   Une famille = un mot canonique (celui qu'emploient les packs)
   suivi de tout ce qu'on rencontre dans les bibliotheques reelles.
   Ecrite a la main, parce qu'aucune regle ne relie « amapiano » a
   « afro » : il faut le savoir.
   ------------------------------------------------------------ */
const FAMILLES = {
  'variete':        ['chanson francaise', 'chanson', 'variete francaise', 'variete', 'french pop',
                     'french chanson', 'nouvelle chanson francaise', 'francophone'],
  'french touch':   ['french touch', 'french house', 'filter house', 'nu disco francais'],
  'house':          ['house', 'deep house', 'soulful house', 'jackin house', 'progressive house',
                     'melodic house', 'melodic house and techno', 'organic house', 'funky house',
                     'classic house', 'chicago house', 'garage house', 'bass house', 'future house'],
  'tech house':     ['tech house', 'techhouse', 'minimal deep tech', 'minimal tech'],
  'techno':         ['techno', 'melodic techno', 'peak time techno', 'driving techno', 'hard techno',
                     'detroit techno', 'acid techno'],
  'disco':          ['disco', 'nu disco', 'italo disco', 'disco funk', 'indie dance', 'cosmic disco',
                     'boogie', 'disco house'],
  'funk':           ['funk', 'soul', 'soul funk', 'motown', 'northern soul', 'rare groove', 'p funk'],
  'motown':         ['motown', 'northern soul'],
  'pop':            ['pop', 'dance pop', 'synth pop', 'electropop', 'indie pop', 'pop rock', 'top 40'],
  'rock':           ['rock', 'classic rock', 'indie rock', 'pop rock', 'new wave', 'punk'],
  'rap fr':         ['rap fr', 'rap francais', 'rap français', 'hip hop fr', 'french rap', 'rap'],
  'hip hop':        ['hip hop', 'hiphop', 'hip hop rap', 'rap', 'trap', 'boom bap', 'old school hip hop'],
  'rnb':            ['rnb', 'r and b', 'r n b', 'rhythm and blues', 'contemporary rnb', 'soul rnb', 'new jack swing'],
  'afro':           ['afro', 'afro house', 'afrobeats', 'afrobeat', 'amapiano', 'afro pop', 'coupe decale',
                     'ndombolo', 'afro tech'],
  'latin':          ['latin', 'salsa', 'bachata', 'merengue', 'cumbia', 'latin pop'],
  'reggaeton':      ['reggaeton', 'dembow', 'latin urban', 'perreo'],
  'zouk':           ['zouk', 'kompa', 'kizomba', 'zouk love'],
  'dancehall':      ['dancehall', 'reggae', 'ragga', 'roots reggae'],
  'edm':            ['edm', 'big room', 'electro house', 'festival', 'mainstage'],
  'drum and bass':  ['drum and bass', 'dnb', 'jungle', 'liquid dnb'],
  'garage':         ['garage', 'uk garage', 'ukg', '2 step', 'speed garage'],
  'trance':         ['trance', 'progressive trance', 'uplifting trance', 'psy trance'],
  'hymne':          ['hymne', 'anthem', 'sing along', 'classiques', 'evergreen', 'karaoke'],
  'jazz':           ['jazz', 'nu jazz', 'jazz funk', 'bossa nova', 'swing'],
  'ambient':        ['ambient', 'downtempo', 'chill out', 'lounge', 'balearic'],
  'country':        ['country', 'americana', 'bluegrass'],
  'schlager':       ['schlager', 'volksmusik'],
  'drill':          ['drill', 'uk drill', 'ny drill'],
};

/* Index inverse : « amapiano » -> « afro ». Construit une fois. */
const VERS_FAMILLE = new Map();
for (const [canon, membres] of Object.entries(FAMILLES)) {
  VERS_FAMILLE.set(canon, canon);
  for (const m of membres) if (!VERS_FAMILLE.has(m)) VERS_FAMILLE.set(m, canon);
}

/**
 * Les familles auxquelles appartient une etiquette.
 * Une etiquette peut en toucher plusieurs : « disco funk » est
 * a la fois du disco et du funk, et c'est vrai.
 *
 * @returns {Array<{famille:string, sur:number}>} sur = 1 exact, 0.8 synonyme, 0.6 inclusion
 */
function familles(tag) {
  const t = aplatir(tag);
  if (!t) return [];
  const out = new Map();

  /* 1. exact ou synonyme connu */
  const direct = VERS_FAMILLE.get(t);
  if (direct) out.set(direct, 1);

  /* 2. inclusion de mots : « deep house progressive » touche house */
  const mots = t.split(' ');
  for (const [cle, canon] of VERS_FAMILLE) {
    if (out.has(canon) && out.get(canon) >= 0.8) continue;
    const cm = cle.split(' ');
    /* tous les mots du synonyme presents dans l'etiquette */
    if (cm.length && cm.every(m => mots.includes(m))) {
      const sur = cm.length === mots.length ? 1 : 0.8;
      if (!out.has(canon) || out.get(canon) < sur) out.set(canon, sur);
    }
  }

  /* 3. dernier recours : un seul mot de l'etiquette est une famille */
  if (!out.size) {
    for (const m of mots) {
      const f = VERS_FAMILLE.get(m);
      if (f) out.set(f, 0.6);
    }
  }
  return Array.from(out, ([famille, sur]) => ({ famille, sur }));
}

/**
 * Etend les etiquettes d'un morceau a ses familles, avec leur
 * surete. Le resultat est mis en cache sur le morceau : c'est
 * appele des milliers de fois par suggestion.
 *
 * @returns {Map<string,number>} famille -> surete
 */
function famillesDe(track) {
  if (track._fam) return track._fam;
  const m = new Map();
  for (const tag of track.tags || []) {
    for (const { famille, sur } of familles(tag)) {
      if (!m.has(famille) || m.get(famille) < sur) m.set(famille, sur);
    }
  }
  /* le tag brut compte aussi : un pack peut nommer un genre qu'on
     ne connait pas, et l'egalite exacte doit continuer de marcher */
  for (const tag of track.tags || []) {
    const a = aplatir(tag);
    if (a && !m.has(a)) m.set(a, 1);
  }
  Object.defineProperty(track, '_fam', { value: m, enumerable: false, writable: true });
  return m;
}

/** Prepare l'ADN d'un pack : ses cles passent aussi par les familles.
 *
 *  Le maximum est calcule ici, une fois. Il l'etait dans la boucle
 *  de notation, donc reparcouru pour chacun des trente mille
 *  morceaux : neuf cent mille iterations par suggestion, pour une
 *  valeur qui ne bouge jamais.
 *
 *  @returns {{poids:Map<string,number>, max:number}}
 */
function dnaEtendu(dna) {
  const out = new Map();
  let max = 0;
  for (const [cle, poids] of Object.entries(dna || {})) {
    const a = aplatir(cle);
    if (!out.has(a) || out.get(a) < poids) out.set(a, poids);
    for (const { famille, sur } of familles(cle)) {
      const v = poids * (sur >= 1 ? 1 : 0.95);
      if (!out.has(famille) || out.get(famille) < v) out.set(famille, v);
    }
    if (poids > max) max = poids;
  }
  return { poids: out, max: max };
}

module.exports = { aplatir, familles, famillesDe, dnaEtendu, FAMILLES };
