'use strict';
/* ============================================================
   Le mode preparation.

   Beaucoup de soirees se jouent sur des CDJ, sans ordinateur en
   cabine. Le widget n'y sert alors a rien : il n'y a pas d'ecran
   ou le poser. Ce qui se transporte, c'est une cle USB preparee
   la veille — et c'est justement le moment ou le DJ est seul
   devant vingt mille morceaux a se demander lesquels emporter.

   On construit donc, chez lui, le vivier qu'il aurait joue : un
   ordre mixable, cale sur la courbe du contexte, qui tient la
   duree annoncee, respecte les listes du client et evite ce qu'il
   a deja joue au meme endroit.

   Ce n'est pas un set fige. Un set fige ne survit pas au premier
   regard sur la piste. C'est un vivier ORDONNE : plus large que
   necessaire, range dans l'ordre ou il tiendrait, pour que le DJ
   pioche dedans sans reflechir a 2 h du matin.
   ============================================================ */
const { suggest, keyOf, mmss } = require('./engine');

const MIN = 60;

/* La courbe visee, heure par heure, en dix points. Elle vient du
   contexte quand il en donne une, sinon d'un arc de club
   classique : on monte, on tient, on redescend. */
function courbe(pack, points) {
  points = points || 12;
  const arc = [];
  const src = pack && pack.arc && pack.arc.length >= 3 ? pack.arc : null;
  for (let i = 0; i < points; i++) {
    const x = i / (points - 1);
    if (src) {
      const p = x * (src.length - 1);
      const a = Math.floor(p), b = Math.min(src.length - 1, a + 1), f = p - a;
      arc.push(src[a] * (1 - f) + src[b] * f);
    } else {
      /* montee jusqu'aux deux tiers, plateau court, descente */
      arc.push(x < 0.66 ? 4.6 + x * 6 : 8.6 - (x - 0.66) * 7.4);
    }
  }
  return arc;
}

/**
 * Construit le vivier.
 *
 * @param {object} o
 *   o.library     bibliotheque (deja filtree si des filtres sont poses)
 *   o.dureeMin    duree annoncee de la soiree, en minutes
 *   o.pack        contexte (pays + evenement)
 *   o.dna         genres privilegies
 *   o.wanted      Set des titres voulus par le client
 *   o.banned      Set des cles interdites
 *   o.marge       combien de morceaux en plus du strict necessaire (defaut 1,6)
 *   o.eviterIds   Set des morceaux deja joues au meme endroit
 *   o.depart      morceau d'ouverture impose (facultatif)
 * @returns {{ok, duree, n, ordre, phases, note}}
 */
function preparer(o) {
  o = o || {};
  const duree = Math.max(15, Math.round(o.dureeMin || 0));
  const library = (o.library || []).filter(t => t.bpm > 0);
  if (!duree) return { ok: false, note: 'Annonce la duree de la soiree.' };
  if (library.length < 10)
    return { ok: false, note: 'Pas assez de morceaux jouables : ' + library.length + ' seulement.' };

  const banned = o.banned || new Set();
  const wanted = o.wanted || new Set();
  const eviter = o.eviterIds || new Set();
  const dna = o.dna || {};

  /* combien de morceaux tiennent dans la soiree */
  const durees = library.map(t => t.duration).filter(x => x > 60).sort((a, b) => a - b);
  const mediane = durees.length ? durees[Math.floor(durees.length / 2)] : 250;
  /* Un morceau n'est jamais joue en entier : on entre dans son
     intro et on sort avant sa fin. Les trois quarts, mesures sur
     les plans de mix, sont une bonne approximation. */
  const parMorceau = (mediane * 0.75) / MIN;
  const cible = Math.max(4, Math.round(duree / parMorceau));
  const marge = o.marge || 1.6;
  const aPrendre = Math.min(library.length, Math.round(cible * marge));

  const arc = courbe(o.pack, cible);

  /* ---------- construction ----------
     A chaque pas, on demande au moteur ce qui s'enchaine le mieux
     depuis le morceau precedent, avec la consigne d'energie du
     moment. On ne reprend jamais un morceau deja pris. */
  const pris = new Set();
  const ordre = [];
  const dispo = library.filter(t => !banned.has(keyOf(t)));

  /* Le depart : ce que le DJ impose, sinon le morceau le plus
     proche du premier point de la courbe, en privilegiant ce que
     la salle reconnait — on n'ouvre pas sur un inconnu. */
  let cur = o.depart && dispo.find(t => t.id === o.depart);
  if (!cur) {
    let best = null, bs = -1;
    for (const t of dispo) {
      if (eviter.has(t.id)) continue;
      const e = t.energy == null ? 5 : t.energy;
      const s = 100 - Math.abs(e - arc[0]) * 14 + (t.pop || 40) * 0.25 + (wanted.has(t.id) ? 20 : 0);
      if (s > bs) { bs = s; best = t; }
    }
    cur = best || dispo[0];
  }
  pris.add(cur.id);
  ordre.push({ track: cur, cible: arc[0] });

  for (let i = 1; i < aPrendre; i++) {
    /* la position dans la courbe suit la progression reelle */
    const x = Math.min(1, i / Math.max(1, cible - 1));
    const idx = Math.min(arc.length - 1, Math.floor(x * (arc.length - 1)));
    const viser = arc[idx];
    const precedent = ordre[ordre.length - 1].track;
    const monte = viser - (precedent.energy == null ? 5 : precedent.energy);
    const sens = monte > 0.5 ? 'up' : monte < -0.5 ? 'down' : 'hold';

    const vivier = dispo.filter(t => !pris.has(t.id));
    if (!vivier.length) break;

    const props = suggest(precedent, vivier, {
      dna: dna, arc: sens, mode: 'crowd', wanted: wanted, limit: 8
    });
    if (!props.length) break;

    /* Parmi les huit propositions, on prend celle qui colle le
       mieux a la courbe — le moteur classe la mixabilite, la
       courbe tranche entre des candidats tous mixables. Un titre
       deja joue au meme endroit est penalise, sans etre interdit :
       une bibliotheque etroite doit quand meme donner un set. */
    let choisi = null, bs = -Infinity;
    for (const p of props) {
      const e = p.track.energy == null ? 5 : p.track.energy;
      const s = p.total - Math.abs(e - viser) * 9
              - (eviter.has(p.track.id) ? 18 : 0)
              + (wanted.has(p.track.id) ? 14 : 0);
      if (s > bs) { bs = s; choisi = p; }
    }
    if (!choisi) break;
    pris.add(choisi.track.id);
    ordre.push({ track: choisi.track, cible: viser, tempo: choisi.tempo, h: choisi.h,
                 transition: choisi.transition, total: choisi.total });
  }

  /* ---------- ce que ca donne ---------- */
  let cumul = 0;
  const lignes = ordre.map((x, i) => {
    const t = x.track;
    const depart = cumul;
    cumul += (t.duration > 60 ? t.duration * 0.75 : mediane * 0.75);
    return {
      n: i + 1,
      id: t.id, title: t.title, artist: t.artist, path: t.path,
      bpm: t.bpm, key: t.key, energy: t.energy, duration: t.duration || 0,
      a: mmss(depart),
      cible: Math.round(x.cible * 10) / 10,
      transition: x.transition ? x.transition.n : null,
      client: wanted.has(t.id),
      deja: eviter.has(t.id),
      /* au-dela de la duree annoncee, c'est la reserve */
      reserve: depart / MIN > duree
    };
  });

  const dansLeTemps = lignes.filter(l => !l.reserve).length;
  const clients = lignes.filter(l => l.client).length;
  const voulus = wanted.size;

  return {
    ok: true,
    duree: duree,
    n: lignes.length,
    tenus: dansLeTemps,
    reserve: lignes.length - dansLeTemps,
    ordre: lignes,
    clients: clients,
    voulus: voulus,
    note: dansLeTemps + ' morceaux pour tenir ' + duree + ' minutes, plus ' +
          (lignes.length - dansLeTemps) + ' de reserve.' +
          (voulus ? ' ' + clients + ' des ' + voulus + ' titres du client sont places.' : '')
  };
}

/* ---------- exports ----------
   Deux formats, deux usages :

   — le M3U, que rekordbox, Serato, Traktor et VirtualDJ ouvrent
     tous les quatre. Le DJ l'importe, la playlist apparait, il
     l'exporte sur sa cle. C'est le chemin le plus court entre ce
     module et une cle USB.

   — le texte, pour le lire et le corriger avant.

   On n'ecrit pas dans la base du logiciel : elle lui appartient,
   et une ecriture ratee dans un database V2 coute une
   bibliotheque. Un fichier a cote, qu'il importe lui-meme. */
function m3u(plan) {
  if (!plan || !plan.ok) return '';
  const l = ['#EXTM3U'];
  for (const x of plan.ordre) {
    if (!x.path) continue;
    l.push('#EXTINF:' + (x.duration > 0 ? Math.round(x.duration) : -1) + ',' +
           (x.artist ? x.artist + ' - ' : '') + x.title);
    l.push(x.path);
  }
  return l.join('\n') + '\n';
}

function texte(plan, titre) {
  if (!plan || !plan.ok) return '';
  const entete = (titre || 'Preparation') + ' — ' + plan.duree + ' min';
  const l = [entete, '-'.repeat(entete.length)];
  for (const x of plan.ordre) {
    l.push(String(x.n).padStart(3) + '  ' + x.a.padStart(6) + '  ' +
      (x.artist ? x.artist + ' — ' : '') + x.title +
      '  [' + (x.key || '?') + ' · ' + x.bpm + ']' +
      (x.client ? '  (client)' : '') + (x.reserve ? '  (reserve)' : ''));
  }
  l.push('', plan.note);
  return l.join('\n') + '\n';
}

module.exports = { preparer, m3u, texte, courbe };
