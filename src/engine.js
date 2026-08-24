'use strict';
/* ============================================================
   Liaison — moteur d'enchaînement.
   Aucune dépendance : partagé entre le process principal et l'UI.
   ============================================================ */

const camelot = k => ({ n: parseInt(k, 10), l: String(k).slice(-1).toUpperCase() });

function harmScore(a, b) {
  if (!a || !b) return 50;
  if (a === b) return 100;
  const A = camelot(a), B = camelot(b);
  if (!A.n || !B.n) return 50;
  const d = Math.min((A.n - B.n + 12) % 12, (B.n - A.n + 12) % 12);
  if (A.l === B.l && d === 1) return 93;
  if (A.n === B.n && A.l !== B.l) return 89;
  if (A.l === B.l && d === 2) return 72;
  if (A.l !== B.l && d === 1) return 64;
  if (A.l === B.l && d === 3) return 52;
  return Math.max(18, 60 - d * 8);
}

function tempoScore(a, b) {
  let best = Infinity, ratio = 1;
  for (const r of [1, 2, 0.5]) {
    const d = Math.abs(b * r - a);
    if (d < best) { best = d; ratio = r; }
  }
  const pct = (best / a) * 100;
  let s;
  if (pct <= 0.4) s = 100;
  else if (pct <= 3) s = 100 - (pct - 0.4) * 9;
  else if (pct <= 6) s = 76 - (pct - 3) * 13;
  else s = Math.max(8, 37 - (pct - 6) * 7);
  return { s, pct, ratio, delta: b * ratio - a };
}

const energyScore = (cur, e, arc) =>
  Math.max(4, 100 - Math.abs(e - (arc === 'up' ? cur + 1.4 : arc === 'down' ? cur - 1.6 : cur + 0.2)) * 16);

const timbreScore = (a, b) => {
  if (!a || !b) return 60;
  return Math.max(10, 100 - Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 11);
};

function crowdScore(track, dna) {
  const tags = track.tags || [];
  let hit = 0, max = 0;
  for (const k of Object.keys(dna || {})) {
    max = Math.max(max, dna[k]);
    if (tags.includes(k)) hit = Math.max(hit, dna[k]);
  }
  /* Ecart accentue : sans ca, un genre a 70 et un genre a 90 se valent
     presque, et le contexte de soiree ne se voit pas dans la liste. */
  const rel = max ? hit / max : 0.5;
  const base = Math.pow(rel, 1.6) * 100;
  return Math.round(base * 0.82 + (track.pop || 40) * 0.18);
}

function transitionOf(cur, nx, tp, h) {
  if (tp.ratio !== 1)
    return { n: 'Bascule tempo x' + (tp.ratio === 2 ? '2' : '0,5'), d: 'Double ou moitie tempo — la grille rythmique reste alignee.' };
  if (h >= 93 && Math.abs(tp.delta) < 1 && (nx.out || 32) >= 32)
    return { n: 'Blend long — 32 temps', d: 'Tonalites compatibles et intro longue : superposition franche sur deux phrases.' };
  if (h >= 89 && nx.energy - cur.energy >= 2)
    return { n: 'Cut sur le drop', d: "Saut d'energie net : couper au premier temps de la phrase plutot que fondre." };
  if (h >= 72 && h < 93)
    return { n: 'Bass swap — 16 temps', d: 'Tonalites voisines : basculer les basses en 16 temps.' };
  if (Math.abs(tp.delta) > 2.2)
    return { n: 'Echo out + pitch ride', d: 'Ecart de tempo reel : sortir en echo et rattraper au pitch.' };
  return { n: 'Fondu filtre — 24 temps', d: 'Fondu passe-haut sur la sortie pour liberer les basses.' };
}

const keyOf = t => ((t.artist || '') + ' - ' + (t.title || '')).toLowerCase().replace(/\s+/g, ' ').trim();

function suggest(cur, library, opt) {
  opt = opt || {};
  const dna = opt.dna || {};
  const arc = opt.arc || 'up';
  const mode = opt.mode || 'crowd';
  const banned = opt.banned || new Set();
  const trends = opt.trends || new Map();
  const limit = opt.limit || 5;
  if (!cur) return [];
  const wCrowd = mode === 'crowd' ? 0.26 : 0.06;
  const wTrend = mode === 'trend' ? 0.18 : 0.04;
  const W = 0.27 + 0.24 + 0.15 + 0.14 + wCrowd + wTrend;

  return library
    .filter(t => t.id !== cur.id && !banned.has(keyOf(t)) && t.bpm > 0)
    .map(t => {
      const h = harmScore(cur.key, t.key);
      const tp = tempoScore(cur.bpm, t.bpm);
      const en = energyScore(cur.energy == null ? 5 : cur.energy, t.energy == null ? 5 : t.energy, arc);
      const ti = timbreScore(cur.timbre, t.timbre);
      const cr = crowdScore(t, dna);
      const td = trends.has(keyOf(t)) ? trends.get(keyOf(t)) : 20;
      let total = (h * 0.27 + tp.s * 0.24 + en * 0.15 + ti * 0.14 + cr * wCrowd + td * wTrend) / W;
      if (mode === 'deep') total += (100 - (t.pop || 40)) * 0.06;
      const voc = cur.vocal && t.vocal ? -6 : 0;
      total = Math.max(4, Math.min(99, Math.round(total + voc)));
      return { track: t, h: h, tempo: tp, energyScore: en, timbreScore: ti, crowd: cr, trend: td,
               total: total, transition: transitionOf(cur, t, tp, h) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

/* ---- correspondance floue : retrouver un morceau depuis un texte scrape ---- */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\((original|extended|radio|club|edit|mix|remix)[^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}
function match(text, library, threshold) {
  threshold = threshold == null ? 0.58 : threshold;
  const q = normalize(text);
  if (q.length < 4) return null;
  let best = null, bestScore = 0;
  for (const t of library) {
    const a = normalize(t.artist + ' ' + t.title);
    const b = normalize(t.title + ' ' + t.artist);
    const sc = Math.max(dice(q, a), dice(q, b), dice(q, normalize(t.title)));
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  return bestScore >= threshold ? { track: best, score: bestScore } : null;
}

module.exports = { camelot, harmScore, tempoScore, energyScore, timbreScore, crowdScore,
                   transitionOf, suggest, keyOf, normalize, match, dice };
