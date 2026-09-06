'use strict';
/* ============================================================
   La bulle — rester dans le meme style.

   D'ou vient ce fichier. Un DJ passe « Terrien en detresse »,
   Liaison lui propose Boney M. Rien n'est faux : meme tempo,
   tonalites compatibles, et un pack de mariage francais porte le
   disco aussi haut que la variete. Le moteur repondait exactement
   a la question qu'on lui posait — « quel est le meilleur
   enchainement pour faire monter cette soiree ? »

   Sauf que ce n'etait pas la question. Pour une soiree a theme,
   la question est : « qu'est-ce qui RESSEMBLE a ce que je viens
   de passer ? » Ce n'est pas la meme chose, et aucun reglage
   existant ne permettait de le demander.

   La difference tient en une phrase : le moteur compare chaque
   candidat a l'ADN DE LA SOIREE — une moyenne abstraite, la meme
   du debut a la fin. La bulle, elle, compare chaque candidat au
   MORCEAU D'ANCRAGE : sa famille de genre, son epoque, sa
   couleur, son registre. On ne change pas la note, on change le
   point de comparaison.

   ------------------------------------------------------------
   Pourquoi la bulle est ANCREE, et pas glissante.

   La version evidente — « ressembler au morceau qui tourne » —
   se defait toute seule. Chaque titre propose ressemble au
   precedent, et la chaine derive : partie du disco de 1978, elle
   arrive au nu-disco de 2015 en six enchainements, chacun
   parfaitement justifie. C'est le defaut d'origine, en plus lent
   et en plus sournois.

   On fige donc la reference. Le DJ appuie sur BULLE pendant un
   morceau : CE morceau-la definit la bulle, et tout le reste de
   la soiree y est compare. La derive devient impossible par
   construction. Un bouton pour recentrer, un bouton pour sortir.

   ------------------------------------------------------------
   Ce que la bulle ne fait PAS.

   Elle ne touche ni au tempo ni a l'harmonie : un enchainement
   dans le style mais injouable reste injouable. Elle ne remplace
   pas le moteur, elle deplace son centre de gravite.

   Et elle ne ment jamais sur ce qu'elle sait. Si la bibliotheque
   ne porte pas d'annees, l'epoque n'est pas devinee : l'axe est
   retire, et l'etiquette affichee au DJ le dit.
   ============================================================ */

const genres = require('./genres');

/* Ce que vaut un morceau dont on ignore l'annee. Sous la moyenne,
   pas eliminatoire : sur une bibliotheque sans tag d'annee, punir
   l'inconnu viderait la liste. Meme lecon que l'energie non mesuree
   dans engine.js — ne pas savoir doit couter un peu, jamais tout. */
const ERE_INCONNUE = 45;

/* Une annee credible. Les tags contiennent de tout : « 0 », des
   dates completes, « 2019-04-03T00:00:00Z », parfois un siecle. */
function anneeDe(t) {
  const v = t && t.year;
  if (v == null) return null;
  const n = parseInt(String(v).slice(0, 4), 10);
  if (!isFinite(n) || n < 1900 || n > 2100) return null;
  return n;
}

/* La famille dominante d'un morceau, pour l'afficher. */
function familleLisible(t) {
  let best = null, bv = 0;
  for (const [f, sur] of genres.famillesDe(t)) if (sur > bv) { bv = sur; best = f; }
  return best;
}

function decennie(an) {
  if (an == null) return null;
  const d = Math.floor(an / 10) * 10;
  if (d >= 2000) return 'annees ' + d;
  return 'annees ' + String(d).slice(2);      /* 1980 -> « annees 80 » */
}

/**
 * Fige une bulle autour d'un morceau.
 *
 * @param {object} cur      le morceau qui tourne au moment du clic
 * @param {Array}  library  sert a savoir si l'axe des epoques est utilisable
 * @returns {object|null}
 */
function ancrer(cur, library) {
  if (!cur) return null;
  const familles = genres.famillesDe(cur);
  const an = anneeDe(cur);

  /* ------------------------------------------------------------
     L'epoque ne compte que si la bibliotheque sait la dire.

     Un axe qui vaut « inconnu » pour quatre-vingt-dix pour cent
     des morceaux ne classe rien : il ajoute du bruit et donne au
     DJ l'illusion d'un filtre par decennie qui n'existe pas. On
     compte donc, une fois, combien de titres portent une annee.
     Sous un tiers, l'axe est retire — et l'etiquette affichee ne
     parle plus d'epoque.

     On echantillonne : sur vingt-deux mille morceaux, deux mille
     suffisent a repondre a « y a-t-il des annees dans cette
     bibliotheque ? », et l'ancrage doit etre instantane.
     ------------------------------------------------------------ */
  let avec = 0, vus = 0;
  if (library && library.length) {
    const pas = Math.max(1, Math.floor(library.length / 2000));
    for (let i = 0; i < library.length; i += pas) { vus++; if (anneeDe(library[i]) != null) avec++; }
  }
  const avecAnnees = an != null && vus > 0 && (avec / vus) >= 0.33;

  const fam = familleLisible(cur);

  /* ------------------------------------------------------------
     Une bulle sans prise ne se pose pas.

     Si le morceau d'ancrage n'a ni genre reconnu ni annee lisible,
     la bulle ne peut RIEN filtrer — mais elle continuait de
     deplacer les poids : l'ADN de soiree tombait de 0,26 a 0,05,
     la courbe passait en « tenir », et la penalite de genre etait
     levee. Mesure sur un pack de mariage francais, ancre sur un
     MP3 sans etiquette : la variete francaise disparaissait des
     propositions, remplacee par du schlager et de la country —
     toutes affichees « dans la bulle ».

     Appuyer sur un bouton de theme ne doit jamais rendre les
     suggestions PIRES. Sans prise, on ne pose pas, et on le dit.
     ------------------------------------------------------------ */
  if (!fam && !avecAnnees) {
    return { impossible: true,
             raison: an != null
               ? 'Ce morceau n\'a pas de genre reconnu, et ta bibliotheque ne porte pas assez d\'annees.'
               : 'Ce morceau n\'a ni genre ni annee : Liaison n\'a rien a quoi se raccrocher.' };
  }

  const morceaux = [];
  if (fam) morceaux.push(fam);
  if (avecAnnees) morceaux.push(decennie(an));

  return {
    familles: familles,
    annee: an,
    avecAnnees: avecAnnees,
    pop: cur.pop == null ? 40 : cur.pop,
    timbre: cur.analyzed ? cur.timbre : null,
    id: cur.id,
    titre: cur.title || '',
    artiste: cur.artist || '',
    famille: fam,
    /* Ce que la bulle sait vraiment, en toutes lettres. Si elle ne
       sait rien, on le dit aussi : mieux vaut « le morceau » qu'une
       etiquette inventee. */
    etiquette: morceaux.join(' · '),
    partAnnees: vus ? Math.round((avec / vus) * 100) : 0,
    /* Le morceau d'ancrage porte une annee, mais pas la bibliotheque :
       l'epoque est perdue pour une raison qui se repare. On le dit
       plutot que de laisser croire que « annees 80 » a ete pris en
       compte. */
    epoquePerdue: an != null && !avecAnnees
  };
}

/** Proximite de famille, 0..100. Neutre si la bulle n'a pas de genre. */
function noteFamille(t, bulle) {
  if (!bulle.familles || !bulle.familles.size) return 55;
  let best = 0;
  for (const [f, sur] of genres.famillesDe(t)) {
    const ref = bulle.familles.get(f);
    if (ref != null) { const v = Math.min(sur, ref); if (v > best) best = v; }
  }
  /* 1 = les deux portent le genre en propre ; 0,6 = rapprochement
     par inclusion de mots. On etale pour que la difference se voie. */
  return Math.round(Math.pow(best, 0.85) * 100);
}

/** Proximite d'epoque, 0..100. */
function noteEre(t, bulle, deja) {
  if (!bulle.avecAnnees) return 55;
  const a = deja !== undefined ? deja : anneeDe(t);
  if (a == null) return ERE_INCONNUE;
  const d = Math.abs(a - bulle.annee);
  if (d <= 3) return 100;
  if (d <= 7) return 100 - (d - 3) * 5;        /* 80 a sept ans */
  if (d <= 15) return 80 - (d - 7) * 5;        /* 40 a quinze ans */
  return Math.max(6, 40 - (d - 15) * 2);
}

/** Meme registre : un tube appelle un tube, une perle appelle une perle. */
function noteRegistre(t, bulle) {
  const p = t.pop == null ? 40 : t.pop;
  return Math.max(20, 100 - Math.abs(p - bulle.pop) * 1.1);
}

function noteCouleur(t, bulle) {
  if (!bulle.timbre || !t.analyzed || !t.timbre) return 50;
  return Math.max(10, 100 - Math.hypot(t.timbre[0] - bulle.timbre[0],
                                       t.timbre[1] - bulle.timbre[1],
                                       t.timbre[2] - bulle.timbre[2]) * 11);
}

/**
 * A quel point ce morceau est-il dans la bulle ? 0..100.
 * @returns {{note:number, fam:number, ere:number}}
 */
function note(t, bulle) {
  const fam = noteFamille(t, bulle);
  const an = bulle.avecAnnees ? anneeDe(t) : null;
  const ere = noteEre(t, bulle, an);
  const reg = noteRegistre(t, bulle);
  const cou = noteCouleur(t, bulle);
  /* Quand l'epoque n'est pas lisible, son poids ne se perd pas :
     il revient a la famille, qui est alors le seul indice solide. */
  const wF = bulle.avecAnnees ? 0.46 : 0.70;
  const wE = bulle.avecAnnees ? 0.28 : 0.04;
  const wR = 0.14, wC = 0.12;
  const W = wF + wE + wR + wC;
  /* L'appartenance sort du meme calcul. Elle etait recalculee juste
     apres, par un second appel qui refaisait le rapprochement de
     familles et la lecture d'annee de chaque candidat : trois fois
     genres.famillesDe par morceau au lieu de deux, sur vingt-deux
     mille candidats et a chaque changement de titre. */
  let dedans = true;
  if (bulle.familles && bulle.familles.size && fam < 50) dedans = false;
  /* Un morceau sans annee n'est pas ecarte — punir un tag manquant
     serait injuste — mais sa note d'epoque le laisse derriere ceux
     qui en portent une. */
  else if (bulle.avecAnnees && an != null && Math.abs(an - bulle.annee) > 10) dedans = false;
  return { note: Math.round((fam * wF + ere * wE + reg * wR + cou * wC) / W),
           fam: fam, ere: ere, dedans: dedans };
}

/* ------------------------------------------------------------
   La porte.

   Baisser la note d'un morceau hors sujet ne suffit pas : sur
   vingt-deux mille candidats, il s'en trouve toujours un qui
   rattrape son ecart de style par un tempo parfait et une
   tonalite identique. Et il suffit d'UN Boney M au milieu d'une
   soiree annees 80 pour que le DJ cesse de faire confiance au
   mode.

   Une soiree a theme est donc un filtre, pas une preference.
   ------------------------------------------------------------ */
function dedans(t, bulle) { return note(t, bulle).dedans; }

module.exports = { ancrer, note, dedans, anneeDe, decennie, familleLisible, ERE_INCONNUE };
