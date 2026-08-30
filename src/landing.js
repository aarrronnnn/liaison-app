'use strict';
/* ============================================================
   L'atterrissage — finir a l'heure, et bien.

   Un set a une fin annoncee : la salle ferme a 4 h, le DJ suivant
   branche a 1 h 30, le traiteur remballe a minuit. La faute
   classique n'est pas de mal enchainer — c'est de bruler sa
   derniere cartouche vingt minutes trop tot, puis de meubler.

   On ne planifie pas la soiree entiere, ce serait mentir : le
   moteur ne sait pas ce qui va se passer. On planifie seulement
   la descente, qui est la partie previsible.

   Trois phases, calculees depuis le temps restant :
     tenir    — on reste au niveau, on ne monte plus
     dernier  — le sommet, la carte gardee pour ca
     poser    — on redescend, on laisse la salle partir debout

   La regle qui compte : le morceau de cloture est reserve des
   maintenant, et il est retire des suggestions jusqu'a son heure.
   Sinon il sort au milieu du set et il n'y a plus de fin.
   ============================================================ */

const { keyOf, mmss, tempoScore } = require('./engine');

const MIN = 60;

/**
 * Decoupe le temps restant en phases.
 * @param {number} restant  minutes annoncees par le DJ
 * @param {number} moyenne  duree moyenne d'un morceau joue, en minutes
 */
function phases(restant, moyenne) {
  moyenne = moyenne > 1 ? moyenne : 4.2;
  const titres = Math.max(1, Math.round(restant / moyenne));

  /* Moins de deux morceaux : il n'y a plus de plan, il y a une sortie. */
  if (titres <= 2) {
    return [{ k: 'poser', nom: 'La sortie', de: 0, a: restant, titres: titres,
              texte: 'Il reste la place d\'un ou deux morceaux : joue la cloture.' }];
  }

  /* La descente prend le dernier tiers, jamais moins de deux morceaux
     ni plus de quatre : au-dela, ce n'est plus un atterrissage, c'est
     un set qui s'eteint. */
  const nPoser = Math.min(4, Math.max(2, Math.round(titres * 0.33)));
  const nDernier = 1;
  const nTenir = Math.max(0, titres - nPoser - nDernier);

  const tTenir = nTenir * moyenne;
  const tDernier = nDernier * moyenne;

  const out = [];
  if (nTenir) out.push({
    k: 'tenir', nom: 'Tenir le niveau', de: 0, a: tTenir, titres: nTenir,
    texte: 'Encore ' + nTenir + ' morceau' + (nTenir > 1 ? 'x' : '') + ' au niveau actuel. Ne monte plus : garde la marge pour le dernier.'
  });
  out.push({
    k: 'dernier', nom: 'Le dernier gros', de: tTenir, a: tTenir + tDernier, titres: nDernier,
    texte: 'C\'est ici que passe la carte que tu gardais. Apres, on redescend.'
  });
  out.push({
    k: 'poser', nom: 'Poser la salle', de: tTenir + tDernier, a: restant, titres: nPoser,
    texte: nPoser + ' morceaux pour redescendre et finir sur la cloture. Les gens doivent partir debout, pas surpris.'
  });
  return out;
}

/**
 * Choisit le morceau de cloture et le reserve.
 *
 * Une cloture n'est pas le morceau le plus fort de la bibliotheque :
 * c'est celui que la salle reconnait, qui ne demande pas d'enchainer
 * apres, et qui n'a pas deja ete joue ce soir. On privilegie donc la
 * notoriete et une energie moyenne-haute, pas le pic.
 */
function closer(library, opt) {
  opt = opt || {};
  const played = opt.playedIds || new Set();
  const banned = opt.banned || new Set();
  const wanted = opt.wanted || new Set();
  const keep = opt.keep || (() => true);

  let best = null, bestScore = -1;
  for (const t of library) {
    if (played.has(t.id) || banned.has(keyOf(t)) || !keep(t)) continue;
    if (!(t.bpm > 0)) continue;
    const e = t.energy == null ? 5 : t.energy;
    /* ni une berceuse, ni le plus gros drop de la nuit */
    if (e < 4 || e > 8.5) continue;
    const pop = t.pop == null ? 40 : t.pop;
    const chant = t.vocal ? 12 : 0;             /* on finit sur quelque chose qui se chante */
    const long = t.duration > 200 ? 6 : 0;
    const score = pop * 0.66 + (10 - Math.abs(e - 6.6)) * 3.4 + chant + long
                + (wanted.has(t.id) ? 10 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  }
  return best;
}

/**
 * Le plan complet.
 *
 * @param {object} o
 *   o.restantMin   minutes annoncees
 *   o.library      bibliotheque (deja filtree si des filtres sont actifs)
 *   o.playedIds    Set des morceaux deja passes ce soir
 *   o.playedDurs   durees reelles observees, en secondes (facultatif)
 *   o.banned, o.wanted, o.keep
 * @returns {{ok, restant, fin, phases, closer, arc, note}}
 */
function plan(o) {
  o = o || {};
  const restant = Math.max(0, Math.round(o.restantMin || 0));
  if (!restant) return { ok: false, note: 'Annonce le temps qu\'il te reste et Liaison prepare la descente.' };

  /* duree moyenne : celle observee ce soir si on l'a, sinon celle de la
     bibliotheque, sinon 4 min 12 — la mediane d'un morceau club. */
  let moyenne = 0;
  if (o.playedDurs && o.playedDurs.length >= 3) {
    const v = o.playedDurs.slice().sort((a, b) => a - b);
    moyenne = v[Math.floor(v.length / 2)] / MIN;
  } else if (o.library && o.library.length) {
    const d = o.library.map(t => t.duration).filter(x => x > 60).sort((a, b) => a - b);
    if (d.length) moyenne = d[Math.floor(d.length / 2)] / MIN;
  }
  if (!(moyenne > 1.5) || moyenne > 9) moyenne = 4.2;

  const ph = phases(restant, moyenne);
  const cl = closer(o.library || [], o);

  /* la courbe visee, en dix points, pour l'afficher */
  const arc = [];
  const total = restant || 1;
  for (let i = 0; i <= 10; i++) {
    const t = (i / 10) * total;
    const p = ph.find(x => t >= x.de && t <= x.a) || ph[ph.length - 1];
    arc.push({ min: Math.round(t), e: p.k === 'tenir' ? 7.4 : p.k === 'dernier' ? 9.2 : 9.2 - ((t - p.de) / Math.max(1, p.a - p.de)) * 3.6 });
  }

  const fin = new Date(Date.now() + restant * MIN * 1000);
  return {
    ok: true,
    restant: restant,
    moyenne: Math.round(moyenne * 10) / 10,
    fin: fin.getHours() + 'h' + String(fin.getMinutes()).padStart(2, '0'),
    phases: ph,
    closer: cl ? { id: cl.id, title: cl.title, artist: cl.artist, bpm: cl.bpm, key: cl.key,
                   energy: cl.energy, duration: cl.duration } : null,
    arc: arc,
    note: cl
      ? 'Cloture reservee : ' + (cl.artist ? cl.artist + ' — ' : '') + cl.title +
        '. Elle ne remontera plus dans les suggestions avant la fin.'
      : 'Aucune cloture evidente dans ce qui reste — choisis-la toi-meme, Liaison gardera la descente.'
  };
}

/* ------------------------------------------------------------
   La cloture, revue a l'heure dite.

   On reserve une cloture quarante-cinq minutes avant la fin, en
   ignorant forcement ou le set sera rendu a ce moment-la. Mesure
   sur quarante soirees : une fois sur cinq, le set a derive de
   118 vers 136 BPM et la cloture reservee se retrouvait a quinze
   pour cent d'ecart. On la faisait alors remonter de force — donc
   on proposait en premier un enchainement rate.

   Une reservation sert a garder une bonne fin disponible, pas a
   imposer un titre precis. Quand l'heure vient, on verifie donc
   que la cloture reservee est encore atteignable ; sinon on en
   choisit une autre parmi ce qui l'est. Le DJ y gagne une vraie
   fin plutot qu'un nom tenu par principe.
   ------------------------------------------------------------ */
function clotureMaintenant(p, cur, library, opt) {
  if (!p || !p.ok || !p.closer) return null;
  opt = opt || {};
  const reservee = p.closer;

  /* encore mixable ? six pour cent, c'est ce qu'un DJ cale au pitch
     sans que ca s'entende */
  if (cur && cur.bpm > 0 && reservee.bpm > 0) {
    const tp = tempoScore(cur.bpm, reservee.bpm);
    const ecart = Math.abs(tp.delta) / cur.bpm * 100;
    if (ecart <= 6) return { track: reservee, remplacee: false, ecart: ecart };
  } else {
    return { track: reservee, remplacee: false, ecart: 0 };
  }

  /* sinon : la meilleure cloture parmi ce qui se cale maintenant */
  const atteignables = (library || []).filter(t => {
    if (!(t.bpm > 0) || !cur || !(cur.bpm > 0)) return false;
    const tp = tempoScore(cur.bpm, t.bpm);
    return Math.abs(tp.delta) / cur.bpm * 100 <= 6;
  });
  const remplacante = closer(atteignables, opt);
  if (!remplacante) return { track: reservee, remplacee: false, ecart: 99, faute: true };
  const tp = tempoScore(cur.bpm, remplacante.bpm);
  return {
    track: { id: remplacante.id, title: remplacante.title, artist: remplacante.artist,
             bpm: remplacante.bpm, key: remplacante.key, energy: remplacante.energy,
             duration: remplacante.duration },
    remplacee: true,
    ancienne: reservee.title,
    ecart: Math.abs(tp.delta) / cur.bpm * 100
  };
}

/**
 * Quelle phase maintenant, et quelle consigne pour le moteur ?
 * @returns {{k, nom, arc:'up'|'hold'|'down', texte, reste}}
 */
function now(p, ecouleMin) {
  if (!p || !p.ok) return null;
  const t = Math.max(0, ecouleMin || 0);
  const reste = Math.max(0, p.restant - t);
  const ph = p.phases.find(x => t >= x.de && t < x.a) || p.phases[p.phases.length - 1];
  return {
    k: ph.k, nom: ph.nom, texte: ph.texte, reste: Math.round(reste),
    arc: ph.k === 'tenir' ? 'hold' : ph.k === 'dernier' ? 'up' : 'down',
    /* La cloture redevient jouable dans la derniere ligne droite.
       La fenetre valait 1,2 morceau : une seule chance de la voir
       sortir, et sur huit soirees simulees elle etait manquee trois
       fois. A 2,4 morceaux, le DJ la voit passer deux ou trois fois
       avant la fin — assez pour la prendre, pas assez pour qu'elle
       tombe au milieu de la descente. */
    liberer: ph.k === 'poser' && reste <= (p.moyenne || 4.2) * 2.4
  };
}

module.exports = { plan, phases, closer, clotureMaintenant, now, mmss };
