'use strict';
/* ============================================================
   La parente — est-ce que ces deux morceaux vivent dans le
   meme monde ?

   « Quand je mixe Informer, qui est un son un peu reggae, ca me
     donne L'amour, l'amour, l'amour, qui n'a rien a voir. »

   Reproduit a l'execution. Informer (ragga, 98 BPM) proposait,
   dans l'ordre : Benabar, Bon Entendeur, Corneille — et « Sweat »
   d'Inner Circle, meme famille, meme tonalite, 99 BPM, sortait
   QUATRIEME.

   La cause n'etait pas un mauvais reglage. Le moteur notait
   l'harmonie, le tempo, l'energie, le timbre, la salle, la
   tendance, la fraicheur, les affinites et le plancher — neuf
   axes — et AUCUN ne comparait le style du candidat a celui du
   morceau en cours. Le genre n'entrait que par trois portes :

     — l'ADN de la salle, qui vaut 40 pour tout le monde tant
       qu'aucun pack n'est choisi ;
     — la penalite de saturation, qui punit la repetition mais ne
       recompense jamais la parente ;
     — la bulle, qui ne s'allume que si le DJ appuie sur le bouton.

   Sur une bibliotheque de club, ou tout appartient a la meme
   famille, ca ne se voyait pas. Sur une bibliotheque de mariage —
   disco, reggae, variete, rap, zouk dans le meme dossier — ca
   donnait exactement ce qu'Aaron decrit : « ca marche bien avec
   les morceaux recents un peu club, c'est surtout sur les trucs
   disco reggae soleil que c'est nul ».

   Ce fichier repond a une seule question : de la ou on est, ce
   morceau-la est-il a cote, un peu plus loin, ou ailleurs ?

   Deux regles, les memes que partout dans ce moteur :

     — c'est une NOTE, pas un filtre. Un DJ a le droit de passer
       du zouk au rap ; on ne lui interdit rien, on ordonne.
     — un genre inconnu ne coute RIEN. Punir un tag manquant est
       le defaut qui vide les listes, et il a deja fait assez de
       degats dans ce projet.
   ============================================================ */

const genres = require('./genres');

/* ------------------------------------------------------------
   Le voisinage, ecrit a la main.

   On aurait pu calculer une distance depuis les tags, ou depuis
   le signal. Ca aurait ete plus savant et moins juste : ce qui
   rend le disco voisin du funk n'est ni son tempo ni son timbre,
   c'est qu'un DJ enchaine l'un sur l'autre depuis cinquante ans.
   Cette table est donc une table de METIER, pas de mesure — et
   elle se relit, se discute et se corrige en clair.

   Les couples sont donnes une seule fois : la table est rendue
   symetrique au chargement.
   ------------------------------------------------------------ */
const PROCHES = [
  /* la famille disco / funk / soul, le coeur du mariage */
  ['disco', 'funk', 0.92], ['disco', 'motown', 0.82], ['funk', 'motown', 0.90],
  ['disco', 'french touch', 0.80], ['funk', 'rnb', 0.58], ['motown', 'rnb', 0.55],
  ['jazz', 'motown', 0.46], ['jazz', 'funk', 0.46],

  /* la maison house, de la plus chaude a la plus dure */
  ['french touch', 'house', 0.86], ['house', 'tech house', 0.90],
  ['tech house', 'techno', 0.85], ['house', 'techno', 0.70],
  ['house', 'garage', 0.76], ['house', 'edm', 0.70], ['house', 'afro', 0.76],
  ['edm', 'trance', 0.76], ['techno', 'trance', 0.70], ['edm', 'tech house', 0.62],
  ['garage', 'drum and bass', 0.62], ['drum and bass', 'techno', 0.55],
  ['house', 'disco', 0.66],

  /* le monde du soleil : ce que le moteur ratait le plus */
  ['dancehall', 'reggaeton', 0.82], ['dancehall', 'afro', 0.66],
  ['dancehall', 'zouk', 0.64], ['zouk', 'latin', 0.62], ['zouk', 'afro', 0.60],
  ['reggaeton', 'latin', 0.76], ['reggaeton', 'afro', 0.62],
  ['dancehall', 'hip hop', 0.60], ['latin', 'pop', 0.44],

  /* le rap et ses cousins */
  ['hip hop', 'rap fr', 0.88], ['hip hop', 'rnb', 0.74], ['rap fr', 'rnb', 0.62],
  ['hip hop', 'drill', 0.82], ['rap fr', 'drill', 0.78], ['rap fr', 'afro', 0.55],

  /* la chanson, la pop et ce qui fait chanter une salle */
  ['pop', 'variete', 0.62], ['pop', 'rock', 0.62], ['variete', 'schlager', 0.62],
  ['variete', 'hymne', 0.64], ['pop', 'hymne', 0.62], ['disco', 'hymne', 0.62],
  ['rock', 'hymne', 0.56], ['pop', 'rnb', 0.56], ['pop', 'edm', 0.52],
  ['country', 'rock', 0.52], ['country', 'variete', 0.36],
  ['variete', 'rock', 0.48], ['variete', 'disco', 0.42],

  /* ce qui se joue quand personne ne danse encore */
  ['ambient', 'jazz', 0.48], ['ambient', 'house', 0.40]
];

/* Ce que vaut un couple de familles connues mais etrangeres.
   Bas, mais jamais nul : un DJ de mariage passe du rap au disco
   dans la meme soiree, et c'est son metier, pas une faute. */
const ETRANGER = 18;
/* Un maillon indirect coute : disco -> house -> tech house se
   tient encore, disco -> house -> techno beaucoup moins. */
const RELAIS = 0.78;

/* La table symetrique, plus les chemins a deux pas, calcules une
   fois au chargement. */
const TABLE = (() => {
  const m = new Map();
  const mets = (a, b, v) => {
    if (!m.has(a)) m.set(a, new Map());
    const l = m.get(a);
    if (!l.has(b) || l.get(b) < v) l.set(b, v);
  };
  for (const [a, b, v] of PROCHES) { mets(a, b, v); mets(b, a, v); }
  /* deux pas : on ne va pas plus loin. Au-dela, « voisin du voisin
     du voisin » ne veut plus rien dire pour une oreille. */
  const direct = new Map();
  for (const [a, l] of m) direct.set(a, new Map(l));
  for (const [a, la] of direct) {
    for (const [b, vab] of la) {
      const lb = direct.get(b);
      if (!lb) continue;
      for (const [c, vbc] of lb) {
        if (c === a) continue;
        mets(a, c, vab * vbc * RELAIS);
      }
    }
  }
  return m;
})();

/* ------------------------------------------------------------
   La courbe — et pourquoi la proximite brute ne suffisait pas.

   Premiere version : note = proximite x 100, tout simplement.
   Elle a casse un cas deja corrige, et le cas avait raison.

   Derriere un EDM, un autre EDM de 2012 — meme famille, meme
   tonalite, meme tempo, plus connu, mais quatorze ans de retard —
   repassait devant une tech house de 2025. La parente disait
   100 contre 62, et ces trente-huit points effacaient l'axe des
   epoques, ne pour repondre a « ca propose des trucs qui ne sont
   plus a la mode ».

   L'erreur n'etait pas dans les poids, elle etait ici. La parente
   est la pour empecher de changer de MONDE — le ragga suivi d'une
   chanson francaise — pas pour departager deux pieces de la meme
   maison. Entre voisins, elle doit se taire et laisser les autres
   axes trancher.

   La courbe dit donc exactement ca :

     meme famille          100
     voisin franc (0,9)     96
     voisin (0,62)          85     <- presque rien a perdre
     -------- le seuil du voisinage : 0,55 --------
     lointain (0,36)        48     <- ca commence a s'entendre
     etranger (0,18)        26     <- un autre monde

   Plat en haut, raide en bas.
   ------------------------------------------------------------ */
const SEUIL_VOISIN = 0.55;
const NOTE_VOISIN = 82;

function courbe(p) {
  if (p >= SEUIL_VOISIN)
    return NOTE_VOISIN + (100 - NOTE_VOISIN) * (p - SEUIL_VOISIN) / (1 - SEUIL_VOISIN);
  return ETRANGER + (NOTE_VOISIN - ETRANGER) * Math.pow(p / SEUIL_VOISIN, 1.8);
}

/** De 0 a 1 : a quel point ces deux familles se tiennent. */
function proximite(a, b) {
  if (!a || !b) return null;
  if (a === b) return 1;
  const l = TABLE.get(a);
  const v = l && l.get(b);
  return v == null ? ETRANGER / 100 : v;
}

/* Les familles qu'on sait placer. Un tag libre — « soleil »,
   « ambiance », « mes tubes » — arrive jusqu'ici sans etre dans le
   voisinage : il ne doit pas compter comme « etranger », il doit
   ne pas compter du tout. */
function famillesConnues(track) {
  const out = [];
  for (const [f, sur] of genres.famillesDe(track))
    if (TABLE.has(f)) out.push([f, sur]);
  return out;
}

/**
 * La note de parente entre le morceau en cours et un candidat.
 *
 * @returns {number} 0 a 100. 50 = on ne sait pas, et ca ne coute rien.
 */
function score(cur, cand) {
  const a = famillesConnues(cur), b = famillesConnues(cand);
  /* Inconnu d'un cote ou de l'autre : neutre. On ne punit jamais
     un tag absent — c'est la regle de tout ce moteur. */
  if (!a.length || !b.length) return 50;
  let best = 0;
  for (const [fa, sa] of a) {
    for (const [fb, sb] of b) {
      const p = proximite(fa, fb) * Math.min(1, sa) * Math.min(1, sb);
      if (p > best) best = p;
    }
  }
  return Math.round(courbe(best));
}

module.exports.courbe = courbe;

/** De quoi l'expliquer au DJ, plutot que de lui donner un chiffre. */
function raison(cur, cand) {
  const a = famillesConnues(cur), b = famillesConnues(cand);
  if (!a.length || !b.length) return null;
  const n = score(cur, cand);
  if (n >= NOTE_VOISIN) return null;          /* meme maison : rien a signaler */
  if (n <= 32) return 'autre style';
  return null;
}

module.exports = { score, raison, proximite, famillesConnues, TABLE, PROCHES, ETRANGER };
