'use strict';
/* ============================================================
   Rejouer un set sans le repeter.
   On garde le vivier de morceaux d'une soiree precedente, on y
   ajoute ce qu'on veut, et on reconstruit un ordre qui reste
   mixable tout en s'eloignant de l'ordre d'origine.
   ============================================================ */
const { suggest, keyOf } = require('./engine');

function pairKey(a, b) { return a.id + '>' + b.id; }

/**
 * @param {array} previous ordre joue la derniere fois (morceaux)
 * @param {array} additions morceaux a inserer en plus
 * @param {object} opt { dna, arc:'up'|'hold'|'down', drop:0..1, trends, banned, seed }
 * @returns {{order:array, novelty:number, movedAvg:number, kept:number, added:number}}
 */
function reshuffle(previous, additions, opt) {
  opt = opt || {};
  const drop = opt.drop || 0;            // proportion du set precedent qu'on retire
  const dna = opt.dna || {};
  const arc = opt.arc || 'hold';
  const trends = opt.trends || new Map();
  const banned = opt.banned || new Set();

  const prevPairs = new Set();
  const prevPos = new Map();
  previous.forEach((t, i) => {
    prevPos.set(t.id, i);
    if (i > 0) prevPairs.add(pairKey(previous[i - 1], t));
  });

  /* vivier : le set precedent moins ce qu'on abandonne, plus les ajouts */
  let pool = previous.slice();
  if (drop > 0) {
    const n = Math.floor(pool.length * drop);
    const ranked = pool.slice().sort((a, b) => (a.pop || 40) - (b.pop || 40)); // on lache les moins forts
    const dropped = new Set(ranked.slice(0, n).map(t => t.id));
    pool = pool.filter(t => !dropped.has(t.id));
  }
  const addedIds = new Set((additions || []).map(t => t.id));
  pool = pool.concat(additions || []).filter(t => !banned.has(keyOf(t)));

  /* depart : pas le meme qu'avant */
  const openers = pool.slice().sort((a, b) => Math.abs((a.energy || 5) - (previous[0] ? (previous[0].energy || 5) : 5))
                                             - Math.abs((b.energy || 5) - (previous[0] ? (previous[0].energy || 5) : 5)));
  let current = openers.find(t => !previous[0] || t.id !== previous[0].id) || pool[0];
  if (!current) return { order: [], novelty: 0, movedAvg: 0, kept: 0, added: 0 };

  const remaining = new Map(pool.map(t => [t.id, t]));
  remaining.delete(current.id);
  const order = [current];

  while (remaining.size) {
    const cands = suggest(current, Array.from(remaining.values()),
      { dna: dna, arc: arc, trends: trends, limit: 12 });
    if (!cands.length) { const n = remaining.values().next().value; order.push(n); remaining.delete(n.id); current = n; continue; }

    let best = null, bestScore = -1e9;
    for (const c of cands) {
      let s = c.total;
      if (prevPairs.has(pairKey(current, c.track))) s -= 26;          // meme enchainement qu'avant
      const pp = prevPos.get(c.track.id);
      if (pp != null) {
        const dist = Math.abs(pp - order.length);
        if (dist <= 2) s -= (3 - dist) * 9;                           // meme place dans la soiree
      }
      if (addedIds.has(c.track.id)) s += 7;                           // on met en avant les nouveaux
      if (s > bestScore) { bestScore = s; best = c.track; }
    }
    order.push(best); remaining.delete(best.id); current = best;
  }

  /* mesures */
  let newPairs = 0;
  for (let i = 1; i < order.length; i++) if (!prevPairs.has(pairKey(order[i - 1], order[i]))) newPairs++;
  let moved = 0, counted = 0;
  order.forEach((t, i) => { const pp = prevPos.get(t.id); if (pp != null) { moved += Math.abs(pp - i); counted++; } });

  return {
    order: order,
    novelty: order.length > 1 ? Math.round((newPairs / (order.length - 1)) * 100) : 100,
    movedAvg: counted ? Math.round((moved / counted) * 10) / 10 : 0,
    kept: counted,
    added: order.length - counted
  };
}

module.exports = { reshuffle };
