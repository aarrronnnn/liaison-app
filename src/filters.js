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
const genresmod = require('./genres');

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
/* ============================================================
   DEUX SORTES DE FILTRES, ET C'EST TOUT LE SUJET.

   Jusqu'ici les quatre interrupteurs se ressemblaient. Ils ne
   servent pourtant pas au meme moment :

     LES FILTRES DE SOIREE — le crate du vin d'honneur, « sans
     paroles explicites », « pas ce qui est deja passe ». Le DJ les
     pose une fois en arrivant et n'y touche plus. Les remettre a
     zero tout seuls serait une trahison : il joue un titre explicite
     devant la famille sans rien avoir demande.

     LES FILTRES D'INSTANT — « la maintenant, donne-moi du disco a
     plus ou moins deux pour cent ». Ils repondent a une situation
     qui dure trois minutes. Les garder au-dela, c'est se retrouver
     a 2 h du matin avec un filtre pose a 23 h qu'on a oublie, et
     un widget qui ne propose plus rien sans qu'on comprenne
     pourquoi.

   Les seconds retombent donc tout seuls des que le morceau suivant
   part sur un deck. C'est main.js qui le fait ; ici on se contente
   de les distinguer, pour que personne n'ait a s'en souvenir.
   ============================================================ */
const INSTANT = ['genres', 'marge', 'energyMin', 'energyMax'];

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

  /* ------------------------------------------------------------
     Les genres, dans les mots du DJ.

     On compare sur la forme a plat — accents, casse et separateurs
     mis de cote — parce que le DJ a coche « Variete francaise » sur
     un ecran et que ses fichiers portent « variété française ».
     Un morceau passe des qu'UNE de ses etiquettes est cochee : on
     filtre, on ne fait pas une intersection.
     ------------------------------------------------------------ */
  let genres = null;
  if (f.genres && f.genres.length) {
    genres = new Set(Array.from(f.genres).map(g => genresmod.aplatir(g)).filter(Boolean));
    if (!genres.size) genres = null;
    else active.push(genres.size === 1 ? Array.from(f.genres)[0] : genres.size + ' genres');
  }

  const emin = f.energyMin > 0 ? f.energyMin : null;
  const emax = f.energyMax > 0 && f.energyMax < 10 ? f.energyMax : null;
  if (emin || emax) active.push('Energie ' + (emin || 1) + '–' + (emax || 10));

  const keep = t => {
    if (!t) return false;
    if (crateIds && !crateIds.has(t.id)) return false;
    if (played && played.has(t.id)) return false;
    if (f.noExplicit && estExplicite(t)) return false;
    if (bmin && t.bpm < bmin) return false;
    if (bmax && t.bpm > bmax) return false;
    if (genres) {
      const tags = t.tags || [];
      let vu = false;
      for (const tag of tags) { if (genres.has(genresmod.aplatir(tag))) { vu = true; break; } }
      if (!vu) return false;
    }
    /* Un morceau pas encore analyse porte l'energie par defaut. Le
       filtrer sur ce chiffre-la reviendrait a ecarter tout ce que
       l'analyse n'a pas encore atteint — c'est-a-dire l'essentiel
       de la bibliotheque la premiere heure. */
    if ((emin || emax) && t.analyzed) {
      const e = t.energy;
      if (emin && e < emin) return false;
      if (emax && e > emax) return false;
    }
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

module.exports = { build, apply, estExplicite, INSTANT };
