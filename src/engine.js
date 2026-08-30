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
  const wanted = opt.wanted || new Set();     /* les titres que le client a demandes */
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
      /* Un titre demande par le client remonte, mais ne double jamais un
         morceau injouable : le bonus s'ajoute au score, il ne le remplace pas. */
      const ask = wanted.has(t.id) ? 14 : 0;
      total = Math.max(4, Math.min(99, Math.round(total + voc + ask)));
      return { track: t, h: h, tempo: tp, energyScore: en, timbreScore: ti, crowd: cr, trend: td,
               client: wanted.has(t.id), total: total, transition: transitionOf(cur, t, tp, h) };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}


/* ============================================================
   Plan de mix — les instants, pas les intentions.

   Une suggestion ne vaut rien si elle ne dit pas quand agir.
   Avec la structure des deux morceaux, on calcule trois reperes
   sur la timeline du morceau qui tourne :
     lance   — ou demarrer la platine B
     bascule — ou echanger les basses
     sors    — ou couper A
   Les durees de B sont converties au tempo reellement joue :
   un morceau cale de 120 a 124 voit son intro raccourcir.
   ============================================================ */
const mmss = t => {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return m + ':' + (s < 10 ? '0' : '') + (s === 60 ? 0 : s);
};

function mixPlan(cur, next, curS, nextS, tp) {
  tp = tp || tempoScore(cur.bpm, next.bpm);
  const ratio = tp.ratio || 1;
  /* B joue au tempo de A : ses durees se contractent ou s'etirent */
  const stretch = (next.bpm * ratio) / (cur.bpm || next.bpm);

  if (!curS || !curS.ok || !nextS || !nextS.ok) {
    return {
      ok: false,
      note: 'Analyse des points de mix en cours — les reperes arrivent dans un instant.'
    };
  }

  const beat = 60 / (cur.bpm || 124);
  const bar = beat * 4;
  const phrase = beat * 32;

  /* l'intro de B, telle qu'elle durera une fois calee sur A */
  const introPlayed = Math.max(0, (nextS.readyAt - nextS.inPoint) / stretch);

  /* on veut que la batterie de B arrive pile quand celle de A part */
  let start = curS.outPoint - introPlayed;
  const floor = curS.readyAt + phrase;                 /* jamais dans l'intro de A */
  if (start < floor) start = floor;
  /* Calage sur la grille de phrases de A, vers le bas.
     Arrondir au plus proche ferait parfois entrer B apres la sortie
     de A : un trou sans batterie, la faute qui vide une piste.
     En arrondissant vers le bas, le pire cas est une phrase de
     double batterie — exactement ce que gere la bascule de basses. */
  const snap = curS.firstBeat + Math.floor((start - curS.firstBeat) / phrase) * phrase;
  if (snap >= floor && snap < curS.duration) start = snap;

  const swap = Math.max(start + bar, curS.outPoint);
  const outAt = Math.min(curS.duration, Math.max(swap + phrase, curS.lastCall));
  const overlapBars = Math.max(1, Math.round((outAt - start) / bar));

  /* une intro courte ne laisse pas le temps de fondre */
  const tight = introPlayed < bar * 4;

  return {
    ok: true,
    start: Math.round(start * 10) / 10,
    swap: Math.round(swap * 10) / 10,
    out: Math.round(outAt * 10) / 10,
    startLabel: mmss(start),
    swapLabel: mmss(swap),
    outLabel: mmss(outAt),
    overlapBars: overlapBars,
    introPlayed: Math.round(introPlayed),
    outroBars: curS.outroBars,
    tight: tight,
    stretch: Math.round(stretch * 1000) / 1000,
    text: tight
      ? 'Lance a ' + mmss(start) + ', B entre vite — coupe A a ' + mmss(swap) + '.'
      : 'Lance a ' + mmss(start) + ', bascule les basses a ' + mmss(swap) + ', sors A a ' + mmss(outAt) + '.'
  };
}

/* ============================================================
   Sauvetage — le dancefloor se vide.

   On jette la courbe de soiree par la fenetre. Ce qui compte :
   un titre que la salle reconnait des la premiere mesure, assez
   fort, et mixable tout de suite depuis ce qui tourne. On penalise
   les intros longues : a 2 h du matin, personne n'attend 45 s.
   ============================================================ */
function rescue(cur, library, opt) {
  opt = opt || {};
  const dna = opt.dna || {};
  const banned = opt.banned || new Set();
  const structures = opt.structures || new Map();
  const wanted = opt.wanted || new Set();
  const limit = opt.limit || 3;
  if (!cur) return [];

  const out = [];
  for (const t of library) {
    if (t.id === cur.id || banned.has(keyOf(t)) || !(t.bpm > 0)) continue;
    const tp = tempoScore(cur.bpm, t.bpm);
    if (tp.s < 52) continue;                     /* injouable maintenant : on passe */

    const h = harmScore(cur.key, t.key);
    const e = t.energy == null ? 5 : t.energy;
    if (e < 6) continue;                         /* on remonte la salle, pas on l'endort */

    /* reconnaissance immediate : notoriete d'abord, ADN de la salle ensuite */
    const fam = (t.pop == null ? 40 : t.pop) * 0.62 + crowdScore(t, dna) * 0.38;

    /* impact : energie, voix, et une intro courte */
    const st = structures.get(t.id);
    const introBars = st && st.ok ? st.introBars : null;
    const quick = introBars == null ? 60 : Math.max(0, 100 - Math.max(0, introBars - 4) * 9);
    const impact = e * 7 + (t.vocal ? 14 : 0) + quick * 0.3;

    const total = Math.round(
      tp.s * 0.28 + h * 0.14 + fam * 0.34 + Math.min(100, impact) * 0.24
    ) + (wanted.has(t.id) ? 12 : 0);
    out.push({
      track: t, total: Math.max(4, Math.min(99, total)),
      tempo: tp, h: h, fam: Math.round(fam), energy: e,
      introBars: introBars, client: wanted.has(t.id),
      why: wanted.has(t.id) ? 'Demande par le client'
        : (introBars != null && introBars <= 4
            ? 'Entre en ' + introBars + ' mesures'
            : (t.pop >= 70 ? 'La salle la connait' : 'Energie ' + e + '/10')),
      transition: transitionOf(cur, t, tp, h)
    });
  }
  return out.sort((a, b) => b.total - a.total).slice(0, limit);
}

/* ============================================================
   Correspondance floue.

   Trois sources ecrivent mal, et pour trois raisons differentes :
     — les tags d'une bibliotheque, remplis a la main depuis vingt ans
       (« 03_daft_punk-get_lucky_(320kbps).mp3 »)
     — une playlist client, copiee d'une plateforme a une autre
     — un invite qui tape sur son telephone, sans accent, avec des
       fautes, et souvent dans le desordre (« sweet dreems eurythmic »)

   Un seul indice ne suffit pas. On en combine trois : la proximite
   des lettres, la part des mots de la requete qu'on retrouve, et
   l'inclusion pure. Le meilleur des trois gagne.
   ============================================================ */

/* Le bruit qu'on trouve dans les noms de fichiers et les titres
   recopies : mentions de plateforme, qualite, numero de piste. */
const BRUIT = [
  /\b(official|officiel)\s*(music\s*)?(video|audio|lyric[s]?|clip)\b/g,
  /\b(hd|hq|4k|1080p|720p|320\s*kbps|320|128\s*kbps|full\s*album)\b/g,
  /\b(lyrics?|paroles|audio only|visualizer|s[eé]ance)\b/g,
  /\bwww\.[a-z0-9.-]+\b/g, /\b[a-z0-9-]+\.(com|net|fr|org)\b/g,
  /\.(mp3|wav|aiff?|flac|m4a|ogg|aac)\b/g
];

function normalize(s) {
  let t = String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')     /* accents */
    .replace(/[_–—]/g, ' ')                     /* tirets longs, underscores */
    .replace(/^\s*\d{1,3}\s*[-.)]\s*/, ' ');              /* « 03. » en tete */
  for (const r of BRUIT) t = t.replace(r, ' ');
  return t
    .replace(/\b(feat|ft|featuring|avec|with)\b\.?/g, ' ')
    .replace(/\((original|extended|radio|club|edit|mix|remix|version|instrumental)[^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
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

/* Deux mots se ressemblent-ils assez ? On accepte le prefixe (« eurythmic »
   pour « eurythmics ») et la faute de frappe (« dreems » pour « dreams »). */
function motProche(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
  if (Math.abs(a.length - b.length) <= 2 && Math.min(a.length, b.length) >= 4)
    return dice(a, b) >= 0.72;
  return false;
}

/* Quelle part des mots tapes retrouve-t-on dans le titre ?
   C'est l'indice qui sauve « sweet dreams eurythmics » face a
   « Eurythmics - Sweet Dreams (Are Made of This) » : l'ordre ne
   compte pas, les mots en trop du titre ne penalisent pas. */
function partDesMots(q, cible) {
  const A = q.split(' ').filter(w => w.length > 1);
  const B = cible.split(' ').filter(w => w.length > 1);
  if (!A.length || !B.length) return 0;
  let trouves = 0;
  for (const a of A) if (B.some(b => motProche(a, b))) trouves++;
  return trouves / A.length;
}

function combine(q, cible) {
  const d = dice(q, cible);
  const t = partDesMots(q, cible);
  /* inclusion franche : la requete est le titre, ou l'inverse */
  if (cible.includes(q) || q.includes(cible)) return Math.min(1, 0.86 + 0.14 * d);
  return Math.max(d, 0.42 * d + 0.58 * t);
}

/**
 * Retrouve un morceau depuis un texte approximatif.
 * @param {string} text  ce qui a ete tape, scrape ou colle
 * @param {Array} library
 * @param {number} threshold  0.58 par defaut ; 0.5 pour les invites
 */
function match(text, library, threshold) {
  threshold = threshold == null ? 0.58 : threshold;
  const q = normalize(text);
  if (q.length < 3) return null;
  let best = null, bestScore = 0;
  for (const t of library) {
    const artist = t.artist || '', title = t.title || '';
    const sc = Math.max(
      combine(q, normalize(artist + ' ' + title)),
      combine(q, normalize(title + ' ' + artist)),
      combine(q, normalize(title))
    );
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  return bestScore >= threshold ? { track: best, score: bestScore } : null;
}

/** Les n meilleurs, pour proposer un choix plutot qu'imposer une reponse. */
function search(text, library, limit, threshold) {
  const q = normalize(text);
  if (q.length < 2) return [];
  const out = [];
  for (const t of library) {
    const sc = Math.max(
      combine(q, normalize((t.artist || '') + ' ' + (t.title || ''))),
      combine(q, normalize((t.title || '') + ' ' + (t.artist || ''))),
      combine(q, normalize(t.title || ''))
    );
    if (sc >= (threshold == null ? 0.34 : threshold)) out.push({ track: t, score: sc });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit || 8);
}

module.exports = { camelot, harmScore, tempoScore, energyScore, timbreScore, crowdScore,
                   transitionOf, suggest, keyOf, normalize, match, search, dice, combine,
                   mixPlan, rescue, mmss };
