'use strict';
/* ============================================================
   Les affinites — « les sons matchent, mais pas assez ».

   Le moteur sait juger si deux morceaux sont COMPATIBLES :
   tempo, tonalite, energie, timbre. Il ne sait pas si un DJ les
   enchaine reellement. Ce sont deux choses differentes, et
   l'ecart entre les deux est exactement ce que les DJs
   rapportent : « ca colle, mais ce n'est pas ce que je jouerais ».

   Or Liaison a deja la reponse chez lui. session.js garde chaque
   morceau joue, dans l'ordre, depuis la premiere soiree. On sait
   donc, pour CE DJ, ce qui appelle quoi.

   Deux echelles, parce qu'elles n'ont pas la meme densite :

     — la paire exacte. « Les Sardines puis Coton Eye Joe. »
       Signal tres fort, mais rare : il faut des dizaines de
       soirees avant que ca se repete.

     — la famille. « Apres de la variete, il part souvent en
       disco. » Signal plus faible, mais disponible des la
       deuxieme soiree, et il generalise aux morceaux qu'il n'a
       jamais enchaines.

   On mesure une ASSOCIATION, pas une frequence. Si un DJ joue
   40 % de house, alors « house apres n'importe quoi » arrive
   souvent — sans rien dire. Ce qui compte est le rapport entre
   « la house suit la variete » et « la house tout court ». C'est
   ce rapport qu'on calcule, et c'est lui qui distingue une
   habitude d'un simple gout.

   Rien ne sort de la machine. Aucun serveur, aucun compte.
   ============================================================ */

const genres = require('./genres');

/* En dessous, l'historique ne dit rien de fiable : on se tait. */
const MINI_TRANSITIONS = 25;
/* Lissage : evite qu'une seule occurrence fasse loi. */
const LISSAGE = 4;

function famillesDe(entree) {
  /* Les entrees d'historique portent leurs propres etiquettes — c'est
     pour ca que session.js les conserve. On n'a donc pas besoin de la
     bibliotheque pour relire le passe. */
  return genres.famillesDe({ tags: entree && entree.tags ? entree.tags : [] });
}

/**
 * Construit la memoire des enchainements a partir des sets passes.
 * @param {Array} sets  l'historique de session.js
 */
function construire(sets) {
  const paires = new Map();        // "idA>idB"     -> compte
  const famPaires = new Map();     // "famA>famB"   -> compte
  const famArrivee = new Map();    // "famB"        -> compte
  /* ------------------------------------------------------------
     Les departs, comptes ICI et pas a l'usage.

     Ils l'etaient dans score(), par un parcours de toute la table
     des paires — donc une fois par famille, par candidat, a chaque
     changement de morceau. Mesure sur 22 000 titres : 120
     enchainements passaient de 1,9 a 12,6 secondes, et le pire cas
     de 84 a 261 ms. Un widget qui met un quart de seconde a
     repondre en cabine, ca se sent.

     Ces totaux ne dependent que de l'historique : ils se calculent
     une fois, au chargement.
     ------------------------------------------------------------ */
  const famDeparts = new Map();    // "famA"        -> compte
  let n = 0;

  for (const s of sets || []) {
    const p = (s && s.played) || [];
    for (let i = 1; i < p.length; i++) {
      const a = p[i - 1], b = p[i];
      if (!a || !b || a.id == null || b.id == null) continue;
      n++;
      const cle = a.id + '>' + b.id;
      paires.set(cle, (paires.get(cle) || 0) + 1);

      const fa = Array.from(famillesDe(a).keys());
      const fb = Array.from(famillesDe(b).keys());
      for (const y of fb) famArrivee.set(y, (famArrivee.get(y) || 0) + 1);
      for (const x of fa) {
        famDeparts.set(x, (famDeparts.get(x) || 0) + 1);
        for (const y of fb) {
          const k = x + '>' + y;
          famPaires.set(k, (famPaires.get(k) || 0) + 1);
        }
      }
    }
  }
  return { paires, famPaires, famArrivee, famDeparts, n, assez: n >= MINI_TRANSITIONS };
}

/**
 * Ce que l'histoire de ce DJ dit de l'enchainement cur -> cand.
 * @returns {number} 0 a 100. 50 = l'histoire ne dit rien.
 */
function score(cur, cand, M) {
  if (!M || !M.assez || !cur || !cand) return 50;

  /* 1. la paire exacte, quand elle existe : c'est le signal le plus sur */
  const vues = M.paires.get(cur.id + '>' + cand.id) || 0;
  if (vues > 0) return Math.min(100, 74 + Math.min(26, vues * 9));

  /* 2. sinon, l'association entre familles.
        rapport = P(arriver en B | on part de A) / P(arriver en B)
        Au-dessus de 1, l'enchainement est une habitude ; en dessous,
        c'est un chemin que ce DJ ne prend pas. */
  /* On passe les morceaux EUX-MEMES, pas une copie de leurs
     etiquettes : genres.famillesDe garde son resultat sur l'objet,
     et fabriquer « { tags: ... } » a chaque candidat jetait cette
     memoire a la poubelle — 22 000 recalculs par changement de
     morceau au lieu de zero. */
  const fa = Array.from(genres.famillesDe(cur).keys());
  const fb = Array.from(genres.famillesDe(cand).keys());
  if (!fa.length || !fb.length) return 50;

  let meilleur = 1;
  for (const x of fa) {
    const departs = (M.famDeparts && M.famDeparts.get(x)) || 0;
    if (!departs) continue;
    for (const y of fb) {
      const ensemble = M.famPaires.get(x + '>' + y) || 0;
      const arrivees = M.famArrivee.get(y) || 0;
      if (!arrivees) continue;
      const pSachant = (ensemble + LISSAGE * (arrivees / M.n)) / (departs + LISSAGE);
      const pSeul = arrivees / M.n;
      if (pSeul <= 0) continue;
      const r = pSachant / pSeul;
      if (r > meilleur) meilleur = r;
    }
  }
  /* Un rapport de 1 vaut 50, de 2 vaut ~70, de 4 vaut ~85.
     Le logarithme evite qu'une famille rare ne s'envole. */
  return Math.round(Math.max(28, Math.min(96, 50 + Math.log2(meilleur) * 20)));
}

/** Ce qu'on peut montrer au DJ, en clair. */
function explication(cur, cand, M) {
  if (!M || !M.assez) return null;
  const vues = M.paires.get(cur.id + '>' + cand.id) || 0;
  if (vues >= 3) return 'tu l\'enchaines souvent';
  if (vues > 0) return 'tu l\'as deja enchaine';
  return null;
}

module.exports = { construire, score, explication, MINI_TRANSITIONS };
