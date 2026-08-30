'use strict';
/* ============================================================
   Les filtres de cabine.

   Le moteur sait proposer le morceau qui s'enchaine le mieux.
   Il ne sait pas que ce soir c'est un vin d'honneur, que la
   grand-mere est au premier rang, ou que tu viens deja de passer
   ce titre il y a vingt minutes. Ces quatre interrupteurs disent
   au moteur ce que la salle interdit — avant qu'il ne note quoi
   que ce soit.

   Un filtre retire des morceaux. Il n'en fait jamais remonter :
   c'est ce qui le rend previsible a 2 h du matin.
   ============================================================ */

/* ---------- paroles explicites ----------
   Une seule source porte vraiment l'etiquette : iTunes, qui recopie
   celle de l'Store. Ailleurs il n'existe aucun champ « explicit ».
   On complete donc par ce qui est ecrit dans le titre — les DJs
   marquent souvent « (Clean) » ou « [Explicit] » eux-memes — puis,
   en dernier recours, par une courte liste de mots.

   C'est un filet, pas un mur : il attrape ce qui est annonce, pas
   ce qui est chante. Un mariage ne se joue pas la-dessus tout seul. */
const MARQUE_EXPLICITE = /\[\s*explicit\s*\]|\(\s*explicit\s*\)|\bexplicit\b|\bdirty\s*(version|mix|edit)?\b|\buncensored\b/i;
const MARQUE_PROPRE = /\bclean\s*(version|mix|edit|radio)?\b|\bradio\s*edit\b|\bcensored\b/i;
const MOTS = /\b(fuck|fucking|fuckin|shit|bitch|bitches|nigga|niggas|cunt|motherfucker|pussy|salope|encul[ée]|nique|niquer|putain|batard|b[âa]tard|c[ou]nnasse)\b/i;

/**
 * Ce morceau est-il annonce comme explicite ?
 * @returns {boolean}
 */
function estExplicite(t) {
  if (!t) return false;
  const texte = ((t.title || '') + ' ' + (t.artist || '') + ' ' + (t.album || ''));
  if (MARQUE_PROPRE.test(texte)) return false;    /* le DJ a range la version propre */
  if (t.explicit === 1 || t.explicit === true) return true;
  if (MARQUE_EXPLICITE.test(texte)) return true;
  return MOTS.test(texte);
}

/**
 * Construit le tamis a partir de l'etat des interrupteurs.
 *
 * @param {object} f
 *   f.crate      {ids:Set|Array}  ne garder que cette liste
 *   f.playedIds  Set              ce qui est deja passe ce soir
 *   f.skipPlayed bool             l'exclure
 *   f.noExplicit bool             ecarter les paroles annoncees explicites
 *   f.bpmMin, f.bpmMax  number    plage verrouillee (au tempo reel)
 * @returns {{keep:function, active:string[], n:number}}
 */
function build(f) {
  f = f || {};
  const active = [];

  let crateIds = null;
  if (f.crate && f.crate.ids) {
    crateIds = f.crate.ids instanceof Set ? f.crate.ids : new Set(f.crate.ids);
    active.push(f.crate.name || 'Liste');
  }

  const played = f.skipPlayed && f.playedIds
    ? (f.playedIds instanceof Set ? f.playedIds : new Set(f.playedIds))
    : null;
  if (played) active.push('Pas deja joue');

  if (f.noExplicit) active.push('Sans paroles explicites');

  const bmin = f.bpmMin > 0 ? f.bpmMin : null;
  const bmax = f.bpmMax > 0 ? f.bpmMax : null;
  if (bmin || bmax) active.push((bmin || '?') + '–' + (bmax || '?') + ' BPM');

  const keep = t => {
    if (!t) return false;
    if (crateIds && !crateIds.has(t.id)) return false;
    if (played && played.has(t.id)) return false;
    if (f.noExplicit && estExplicite(t)) return false;
    if (bmin && t.bpm < bmin) return false;
    if (bmax && t.bpm > bmax) return false;
    return true;
  };

  return { keep: keep, active: active, n: active.length };
}

/**
 * Applique le tamis a une bibliotheque.
 *
 * Si le tamis ne laisse rien — un crate de trente titres plus une
 * plage de BPM etroite, c'est vite arrive —, on rend la bibliotheque
 * entiere en le signalant. Un widget vide en plein set est une panne ;
 * un widget qui dit « le filtre ne laisse rien » est un outil.
 *
 * @returns {{tracks:Array, vide:boolean, active:string[]}}
 */
function apply(library, f) {
  const t = build(f);
  if (!t.n) return { tracks: library, vide: false, active: [] };
  const out = library.filter(t.keep);
  if (out.length < 3) return { tracks: library, vide: true, active: t.active };
  return { tracks: out, vide: false, active: t.active };
}

module.exports = { build, apply, estExplicite };
