'use strict';
/* ============================================================
   La fraicheur — pourquoi « ca propose des trucs qui ne sont
   plus a la mode ».

   Le moteur ne savait rien des epoques. Un titre de 2012 et un
   titre de la semaine derniere se valaient, du moment que le
   tempo et la tonalite collaient. En club, c'est la faute qui
   se remarque le plus vite : personne ne joue de la big room de
   2013 en 2026, meme parfaitement calee.

   Mais « vieux » ne veut PAS dire « demode », et c'est tout le
   piege. « Les Sardines » date de 1996 et ne sera jamais demode
   a un mariage. « Wake Me Up » date de 2013 et l'est deja. Ce
   qui vieillit n'est pas l'annee : c'est l'annee CROISEE avec la
   famille de genre.

   D'ou la table ci-dessous. Elle dit, par famille, a quelle
   vitesse un morceau se date. Le disco, la motown, la variete,
   les hymnes ne se datent pas — ils sont deja hors du temps. La
   big room, la drill, le reggaeton se datent tres vite.

   Et il y a un troisieme temps, que tout DJ connait : au bout
   d'une vingtaine d'annees, ce qui etait demode redevient
   jouable. L'eurodance des annees 90 est passee de ringarde a
   « soiree annees 90 ». La courbe remonte donc en partie.

   Rien de tout cela ne demande le reseau : l'annee vient des
   tags, la famille de genres.js.
   ============================================================ */

const genres = require('./genres');

/* 0 = intemporel, 1 = se date tres vite.
   Ces valeurs ne sortent pas d'un calcul : elles sortent de ce
   qu'on entend en soiree. Elles sont faites pour etre discutees
   avec un DJ, pas pour etre exactes. */
const PERISSABILITE = {
  'edm': 0.95, 'drill': 0.80, 'trance': 0.70, 'rap fr': 0.62,
  'reggaeton': 0.60, 'pop': 0.50, 'tech house': 0.50, 'afro': 0.50,
  'dancehall': 0.45, 'hip hop': 0.45, 'garage': 0.42, 'drum and bass': 0.40,
  'techno': 0.35, 'rnb': 0.35, 'house': 0.30, 'zouk': 0.25,
  'latin': 0.20, 'ambient': 0.20, 'french touch': 0.15,
  'variete': 0.10, 'rock': 0.10, 'country': 0.10, 'schlager': 0.10,
  'disco': 0.05, 'funk': 0.05,
  'motown': 0.00, 'hymne': 0.00, 'jazz': 0.00
};

/* En dessous de ce nombre d'annees, un morceau est « d'aujourd'hui ». */
const NEUF = 2;
/* L'age auquel un genre perissable a pris toute sa penalite. */
const DATE = 12;
/* L'age ou le retour en grace commence, et celui ou il est acquis. */
const RETOUR = 22;
const VINTAGE = 32;

/** La perissabilite d'un morceau : celle de sa famille la plus sure. */
function perissabilite(track) {
  let p = null, meilleureSurete = 0;
  for (const [f, sur] of genres.famillesDe(track)) {
    const v = PERISSABILITE[f];
    if (v == null) continue;
    if (sur > meilleureSurete) { meilleureSurete = sur; p = v; }
  }
  /* Genre inconnu : on ne date rien. Punir ce qu'on ne connait pas
     est la faute que le moteur a deja payee une fois, sur l'energie
     des morceaux non analyses. */
  return p == null ? 0.25 : p;
}

/** La part de la penalite acquise a cet age, de 0 a 1. */
function usure(age) {
  if (age <= NEUF) return 0;
  if (age < DATE) return (age - NEUF) / (DATE - NEUF);
  if (age < RETOUR) return 1;
  if (age < VINTAGE) return 1 - 0.55 * (age - RETOUR) / (VINTAGE - RETOUR);
  return 0.45;                     /* redevenu jouable, sans etre neuf */
}

/**
 * La fraicheur d'un morceau, de 0 a 100.
 * @param {object} track
 * @param {number} [anneeRef] l'annee en cours
 * @returns {number} 100 = de son temps ; 20 = date.
 */
function fraicheur(track, anneeRef) {
  const an = track && track.year;
  if (!(an > 1900)) return 62;     /* annee inconnue : neutre, jamais punie */
  const ref = anneeRef || new Date().getFullYear();
  const age = Math.max(0, ref - an);
  const p = perissabilite(track);
  return Math.round(Math.max(8, 100 - p * usure(age) * 86));
}

/** Pour l'affichage : dire au DJ POURQUOI un titre est note bas. */
function raison(track, anneeRef) {
  const an = track && track.year;
  if (!(an > 1900)) return null;
  const ref = anneeRef || new Date().getFullYear();
  const age = ref - an;
  const p = perissabilite(track);
  if (p < 0.2) return age > 18 ? 'un classique' : null;
  if (usure(age) < 0.25) return null;
  if (age >= RETOUR) return 'vintage assume';
  return 'date (' + an + ')';
}

module.exports = { fraicheur, perissabilite, usure, raison, PERISSABILITE };
