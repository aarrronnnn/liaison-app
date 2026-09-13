'use strict';
/* ============================================================
   Le plancher — ce que le morceau FAIT a la salle.

   « Apres Les Sardines, il me propose Charles Aznavour. »

   Sur la roue de Camelot, ca se tient. En genre aussi : les deux
   sont de la variete francaise. En tempo, encore mieux — et c'est
   la le piege, on y revient dans engine.js.

   Mais dans une salle, l'un remplit la piste et l'autre la vide.
   Le moteur savait tout d'eux sauf la seule chose qui comptait :
   ce qu'ils PROVOQUENT.

   Le genre ne peut pas repondre. « Variete francaise » contient
   Les Sardines et Aznavour, Goldman et Dalida, la java et le slow.
   C'est une etiquette de rayon de disquaire, pas une fonction de
   soiree.

   Ce qui repond, c'est le signal, et Liaison le mesure deja :

     — le tempo. Une piste se remplit entre 115 et 135. En dessous
       de 100, on ne danse plus de la meme facon ; sous 85, on ne
       danse plus du tout, on ecoute.
     — l'energie, mesuree sur le niveau et la densite d'attaques.
     — la densite du timbre, deuxieme composante du vecteur : elle
       dit si le morceau est percussif ou tenu. Un slow est tenu,
       une fete est percussive.
     — la famille, en dernier recours quand rien n'est analyse.

   Aucun appel reseau, aucune base externe. Tout est deja la ; il
   manquait juste de le lire ensemble.
   ============================================================ */

const genres = require('./genres');

/* Ce qu'une famille fait a une piste, quand on ne sait rien d'autre.
   Volontairement moyen pour la variete et la pop : ces deux-la
   contiennent tout et leur contraire. C'est au signal de trancher. */
const FAMILLE = {
  'hymne': 92, 'edm': 90, 'disco': 88, 'tech house': 86, 'house': 84,
  'funk': 82, 'afro': 82, 'techno': 82, 'dancehall': 80, 'reggaeton': 80,
  'garage': 80, 'drum and bass': 78, 'trance': 78, 'french touch': 78,
  'motown': 76, 'latin': 74, 'schlager': 72, 'rock': 62, 'zouk': 60,
  'hip hop': 60, 'rap fr': 58, 'drill': 56, 'pop': 58, 'variete': 55,
  'rnb': 46, 'country': 44, 'jazz': 30, 'ambient': 12
};

/** Ce que le tempo seul dit du plancher, de 0 a 100. */
function parTempo(bpm) {
  if (!(bpm > 0)) return null;
  if (bpm >= 115 && bpm <= 136) return 100;          /* le coeur de piste */
  if (bpm > 136 && bpm <= 150) return 92;
  if (bpm > 150) return 74;                          /* dnb, hardstyle : ca danse */
  if (bpm >= 100) return 78;                         /* ca bouge, moins fort */
  if (bpm >= 88) return 52;                          /* hip hop, reggaeton lent */
  if (bpm >= 74) return 26;                          /* on se balance */
  return 10;                                         /* slow : la piste se vide */
}

function baseFamille(track) {
  let v = null, sur = 0;
  for (const [f, s] of genres.famillesDe(track)) {
    const b = FAMILLE[f];
    if (b == null) continue;
    if (s > sur) { sur = s; v = b; }
  }
  return v;
}

/**
 * La force de plancher d'un morceau.
 * @returns {{v:number, sur:number}} v de 0 a 100, sur = confiance 0 a 1.
 */
function plancher(track) {
  if (!track) return { v: 50, sur: 0 };
  const t = parTempo(track.bpm);
  const fam = baseFamille(track);
  const mesure = !!track.analyzed;

  /* Sans tempo ni famille, on ne sait rien : on ne juge pas. */
  if (t == null && fam == null) return { v: 50, sur: 0 };
  if (t == null) return { v: fam, sur: 0.35 };

  if (!mesure) {
    /* Le tempo porte l'essentiel, la famille corrige. */
    const v = fam == null ? t : Math.round(t * 0.68 + fam * 0.32);
    return { v: v, sur: 0.55 };
  }

  /* Analyse faite : l'energie et la densite d'attaques entrent.
     timbre[1] est la densite — percussif contre tenu. */
  const en = (track.energy == null ? 5 : track.energy) * 10;
  const dens = Array.isArray(track.timbre) && track.timbre.length > 1
    ? Math.max(0, Math.min(10, track.timbre[1])) * 10 : 50;
  const base = fam == null ? t : t * 0.72 + fam * 0.28;
  const v = Math.round(Math.max(2, Math.min(100, base * 0.50 + en * 0.32 + dens * 0.18)));
  return { v: v, sur: 0.9 };
}

/**
 * Ce que coute de passer d'un plancher a un autre.
 *
 * Monter ne coute rien : relancer une piste est le metier. C'est la
 * CHUTE qui vide la salle, et c'est elle qu'on penalise — sauf quand
 * le DJ redescend volontairement (fin de soiree, atterrissage).
 *
 * @returns {number} 0 a 100, 100 = enchainement sans rupture.
 */
function continuite(cur, cand, arc) {
  const a = plancher(cur), b = plancher(cand);
  const confiance = Math.min(a.sur, b.sur);
  if (confiance < 0.3) return 60;          /* on ne sait pas : on ne juge pas */
  const chute = a.v - b.v;
  if (chute <= 0) return 92;               /* egal ou plus fort : parfait */
  if (arc === 'down') return Math.max(55, 100 - chute * 0.4);
  /* Une chute de 20 points passe encore, 40 se sent, 60 vide la piste. */
  return Math.round(Math.max(4, 100 - Math.pow(chute / 10, 1.9) * 6.5));
}

/** De quoi l'expliquer au DJ plutot que de lui donner un chiffre. */
function raison(cur, cand, arc) {
  const a = plancher(cur), b = plancher(cand);
  if (Math.min(a.sur, b.sur) < 0.3) return null;
  const chute = a.v - b.v;
  if (chute >= 45) return 'casse la piste';
  if (chute >= 28 && arc !== 'down') return 'fait retomber';
  if (chute <= -25) return 'relance';
  return null;
}

module.exports = { plancher, continuite, raison, parTempo, FAMILLE };
