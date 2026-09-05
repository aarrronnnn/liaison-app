'use strict';
/* ============================================================
   Liaison — moteur d'enchaînement.
   Aucune dépendance : partagé entre le process principal et l'UI.
   ============================================================ */

const genres = require('./genres');

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

/* ------------------------------------------------------------
   La note de salle.

   Elle compare les genres du morceau a ceux que le contexte
   privilegie. C'etait une egalite de chaines : « Chanson
   francaise » ne touchait pas « variete », et un mariage francais
   ecartait donc la chanson francaise — mesure a 7 sur 100 alors
   que le pack la porte a 80. Le rapprochement passe maintenant
   par les familles de genres.

   L'ADN etendu est calcule une fois par appel a suggest(), pas
   par morceau : sur trente mille titres, la difference se compte
   en dizaines de millisecondes.
   ------------------------------------------------------------ */
function crowdScore(track, dna, dnaPret) {
  const D = dnaPret || genres.dnaEtendu(dna);
  const P = D.poids, max = D.max;
  let hit = 0;
  for (const [f, sur] of genres.famillesDe(track)) {
    const v = P.get(f);
    if (v != null) { const eff = v * sur; if (eff > hit) hit = eff; }
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

/* Construite des milliers de fois par suggestion : on la garde
   sur le morceau plutot que de la refabriquer. */
const keyOf = t => {
  if (t._k) return t._k;
  const k = ((t.artist || '') + ' - ' + (t.title || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  Object.defineProperty(t, '_k', { value: k, enumerable: false, writable: true });
  return k;
};

/* ------------------------------------------------------------
   La memoire de la derniere heure.

   Un moteur qui ne note que la compatibilite converge : il trouve
   une poche de tempo et de genre ou tout s'enchaine bien, et il
   n'en sort plus. Mesure sur une soiree de cinq heures et trente
   mille morceaux : quatre genres sur onze joues, dont 47 % de
   tech house, et un meme artiste huit fois. Techniquement
   parfait, humainement insupportable.

   On donne donc au moteur ce qu'un DJ a naturellement : le
   souvenir de ce qu'il vient de passer. Ce n'est pas un interdit,
   c'est une penalite — si un morceau est le bon malgre tout, il
   remonte quand meme.
   ------------------------------------------------------------ */
function memoireDe(recent) {
  const M = { artistes: new Map(), familles: new Map(), n: 0 };
  if (!recent || !recent.length) return M;
  /* Deux fenetres differentes, parce que les deux problemes n'ont
     pas la meme echelle. Un genre sature s'entend sur une demi-heure
     — vingt-quatre titres. Un artiste qui revient s'entend sur toute
     la soiree : mesure sur cinq heures, une fenetre de vingt-quatre
     laissait passer le meme nom six fois. On garde donc quarante-huit
     titres pour les artistes, et vingt-quatre pour les genres. */
  const pourGenres = recent.slice(-24);
  const derniers = recent.slice(-48);
  M.n = pourGenres.length;
  for (const t of pourGenres) {
    for (const [f] of genres.famillesDe(t)) M.familles.set(f, (M.familles.get(f) || 0) + 1);
  }
  derniers.forEach((t, i) => {
    /* le plus recent pese le plus : rang 0 = le dernier joue */
    const rang = derniers.length - 1 - i;
    const a = String(t.artist || '').toLowerCase().trim();
    if (a && (!M.artistes.has(a) || M.artistes.get(a) > rang)) M.artistes.set(a, rang);
  });
  return M;
}

/** Ce que la memoire retire a un candidat. Toujours negatif ou nul. */
function penaliteVariete(t, M) {
  if (!M || !M.n) return 0;
  let p = 0;

  /* Meme artiste. Deux fois de suite est une faute ; trois titres
     plus loin, c'est encore trop tot ; au-dela de douze, on oublie. */
  const a = String(t.artist || '').toLowerCase().trim();
  if (a) {
    const rang = M.artistes.get(a);
    if (rang != null) p -= rang <= 2 ? 46 : rang <= 6 ? 32 : rang <= 14 ? 20 : rang <= 28 ? 11 : 5;
  }

  /* Genre sature. On ne penalise pas un genre parce qu'il revient,
     mais parce qu'il occupe TOUTE la place : au-dela d'un tiers des
     vingt-quatre derniers, chaque point de plus coute. */
  let part = 0;
  for (const [f] of genres.famillesDe(t)) {
    const n = M.familles.get(f) || 0;
    if (n / M.n > part) part = n / M.n;
  }
  /* Seuil, pente et plafond mesures, pas choisis : sur cinq soirees
     simulees de 85 morceaux, 0,34/62/22 donnait 4,4 genres et un
     genre dominant a 34 % ; 0,22/170/40 donne 7 genres et 26 %,
     sans rien perdre en tempo (0,47 % median) ni en harmonie (97). */
  if (part > 0.22) p -= Math.min(40, (part - 0.22) * 170);

  return p;
}

/* ------------------------------------------------------------
   Le crible de tempo.

   Noter trente mille morceaux prend cent millisecondes, et le
   moteur est rappele a chaque changement de titre. Or un morceau
   dont le tempo s'ecarte de plus de 12 % n'a aucune chance
   d'entrer dans les cinq premiers : meme parfait partout ailleurs,
   sa note de tempo tombe sous 10 sur 100 et le total ne remonte
   pas. On les ecarte donc avant de les noter, en gardant le demi
   et le double, qui sont mixables.

   La marge est large a dessein — 12 % quand un DJ ne depasse
   jamais 6 — pour que le crible ne change jamais le classement :
   il ne fait qu'eviter du calcul inutile.
   ------------------------------------------------------------ */
const MARGE_CRIBLE = 0.12;
/* La marge est reglable. Certains DJs ne sortent jamais de deux
   pour cent, d'autres passent de 95 a 128 sans complexe. On mesure
   ce qu'ils font et on ouvre le crible d'autant — sans descendre
   sous 6 % (on couperait des enchainements evidents) ni depasser
   22 % (au-dela ce n'est plus un mix, c'est une coupure). */
function passeLeCrible(bpmRef, bpm, marge) {
  if (!(bpm > 0)) return false;
  const M = (typeof marge === 'number' && isFinite(marge)) ? Math.max(0.06, Math.min(0.22, marge)) : MARGE_CRIBLE;
  for (const r of [1, 2, 0.5]) {
    if (Math.abs(bpm * r - bpmRef) / bpmRef <= M) return true;
  }
  return false;
}

function suggest(cur, library, opt) {
  opt = opt || {};
  const dna = opt.dna || {};
  const arc = opt.arc || 'up';
  const mode = opt.mode || 'crowd';
  const banned = opt.banned || new Set();
  const trends = opt.trends || new Map();
  const wanted = opt.wanted || new Set();     /* les titres que le client a demandes */
  const limit = opt.limit || 5;
  /* Sans tempo sur le morceau en cours, tout le calcul part en NaN :
     tempoScore divise par cur.bpm. Ca n'arrivait pas tant que la
     bibliotheque ecartait les morceaux sans tempo — ils y entrent
     maintenant, en attendant d'etre mesures. */
  if (!cur || !(cur.bpm > 0)) return [];
  /* ------------------------------------------------------------
     Les poids, et pourquoi ils ne sont plus fixes.

     Ces six coefficients disaient ce qu'un bon enchainement est :
     l'harmonie compte 0,27, le tempo 0,24, l'energie 0,15... C'est
     une moyenne. Or il n'existe pas de DJ moyen : celui qui joue
     de la house tient l'harmonie au demi-ton et ne bouge pas de
     deux BPM ; celui qui fait un mariage saute de 95 a 128 entre
     deux titres et se moque de la tonalite. Avec des poids fixes,
     Liaison proposait au second ce qui convenait au premier, et il
     n'avait aucun moyen de s'en apercevoir.

     opt.poids est un jeu de multiplicateurs appris sur ce que le
     DJ joue REELLEMENT — voir gout.js. Absent, tout vaut 1 et le
     comportement est exactement celui d'avant.
     ------------------------------------------------------------ */
  const P = opt.poids || {};
  const m = (k) => { const v = P[k]; return (typeof v === 'number' && isFinite(v)) ? Math.max(0.5, Math.min(1.8, v)) : 1; };
  const wH = 0.27 * m('h'), wT = 0.24 * m('tp'), wE = 0.15 * m('en'), wI = 0.14 * m('ti');
  const wCrowd = (mode === 'crowd' ? 0.26 : 0.06) * m('cr');
  const wTrend = (mode === 'trend' ? 0.18 : 0.04) * m('td');
  const W = wH + wT + wE + wI + wCrowd + wTrend;

  /* prepares une fois, pas par morceau */
  const dnaPret = genres.dnaEtendu(dna);
  const M = memoireDe(opt.recent);
  /* Un titre du client qu'on n'a toujours pas joue prend du poids
     a mesure que la soiree avance : a 14 points fixes, la moitie
     des titres voulus n'etaient jamais sortis en cinq heures. */
  const urgence = 14 + Math.round((opt.avancement || 0) * 26);
  /* Un morceau epingle : la cloture reservee, quand son heure est
     venue. On la retirait des suggestions jusqu'a la fin, puis on
     la remettait dans le vivier en esperant qu'elle gagne — sur
     trente mille candidats, elle ne gagnait jamais. Une reservation
     qui ne ressort pas n'est pas une reservation. */
  const epingle = opt.epingle || null;

  return library
    .filter(t => t.id !== cur.id && !banned.has(keyOf(t)) &&
      /* Le morceau epingle traverse le crible de tempo. Sans cette
         exception, une cloture reservee a 118 BPM alors que le set
         a derive vers 132 etait ecartee avant meme d'etre notee :
         on la reservait toute la soiree pour qu'elle ne sorte
         jamais. Elle apparait donc avec son vrai ecart de tempo
         affiche — au DJ de decider s'il la cale ou s'il coupe. */
      (t.bpm > 0) && (t.id === epingle || passeLeCrible(cur.bpm, t.bpm, opt.marge)))
    .map(t => {
      const h = harmScore(cur.key, t.key);
      const tp = tempoScore(cur.bpm, t.bpm);
      const en = energyScore(cur.energy == null ? 5 : cur.energy, t.energy == null ? 5 : t.energy, arc);
      const ti = timbreScore(cur.timbre, t.timbre);
      const cr = crowdScore(t, dna, dnaPret);
      const td = trends.has(keyOf(t)) ? trends.get(keyOf(t)) : 20;
      let total = (h * wH + tp.s * wT + en * wE + ti * wI + cr * wCrowd + td * wTrend) / W;
      if (mode === 'deep') total += (100 - (t.pop || 40)) * 0.06;
      /* ------------------------------------------------------------
         La notoriete, qui n'etait nulle part.

         Le moteur savait noter l'accord, le tempo, l'energie, le
         timbre et le genre. Il ne savait pas noter « c'est un
         tube ». Or c'est le premier critere d'un DJ de mariage, et
         l'inverse exact du critere d'un DJ de club — les deux
         gouts les plus repandus, et aucun des deux n'etait
         exprimable.

         Le terme vaut zero tant que rien n'est appris : le
         comportement par defaut ne bouge pas d'un point. Il devient
         positif pour qui joue les tubes, negatif pour qui creuse.
         ------------------------------------------------------------ */
      const kPop = typeof P.pop === 'number' && isFinite(P.pop) ? Math.max(-1, Math.min(1, P.pop)) : 0;
      const noto = kPop ? ((t.pop == null ? 40 : t.pop) - 50) * kPop * 0.30 : 0;
      const voc = cur.vocal && t.vocal ? -6 : 0;
      /* Un titre demande par le client remonte, mais ne double jamais un
         morceau injouable : le bonus s'ajoute au score, il ne le remplace pas. */
      const ask = wanted.has(t.id) ? urgence : 0;
      /* Un morceau epingle echappe a la penalite de variete : c'est
         un choix delibere, pas une proposition parmi d'autres. Sans
         cette exception, une cloture dont l'artiste venait d'etre
         joue perdait quarante points et retombait dans la liste. */
      const pin = epingle && t.id === epingle ? 45 : 0;
      /* Un DJ de mariage rejoue le meme artiste deux fois dans la
         nuit et personne ne s'en plaint ; un DJ de club ne le fait
         jamais. L'echelle de la penalite est donc apprise, elle
         aussi. */
      const va = pin ? 0 : penaliteVariete(t, M) * (typeof P.variete === 'number' ? Math.max(0.25, Math.min(1.6, P.variete)) : 1);
      total = Math.max(4, Math.min(99, Math.round(total + voc + ask + va + pin + noto)));
      return { track: t, h: h, tempo: tp, energyScore: en, timbreScore: ti, crowd: cr, trend: td,
               client: wanted.has(t.id), variete: va, cloture: !!pin, total: total,
               transition: transitionOf(cur, t, tp, h) };
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
  if (!cur || !(cur.bpm > 0)) return [];

  /* Le sauvetage ignore la courbe de soiree, mais pas la memoire :
     remonter la piste avec le meme artiste qu'il y a trois titres
     s'entend, meme a 2 h du matin. La penalite est reduite de
     moitie — sauver la piste passe avant la variete. */
  const M = memoireDe(opt.recent);
  const dnaPret = genres.dnaEtendu(dna);

  const out = [];
  for (const t of library) {
    if (t.id === cur.id || banned.has(keyOf(t)) || !(t.bpm > 0)) continue;
    const tp = tempoScore(cur.bpm, t.bpm);
    if (tp.s < 52) continue;                     /* injouable maintenant : on passe */

    const h = harmScore(cur.key, t.key);

    /* ------------------------------------------------------------
       L'energie, et le morceau pas encore analyse.

       Cette ligne rejetait tout ce qui est sous 6 sur 10 — logique
       pour un bouton de sauvetage. Sauf qu'un morceau dont
       l'analyse n'a pas encore tourne recoit une energie NEUTRE de
       5, posee par finalize(). Et 5 est inferieur a 6.

       Consequence, reproduite : sur une bibliotheque fraichement
       importee, 100 % des titres valent 5, donc 100 % sont
       rejetes, donc SOS repond « rien de mixable » — au moment
       precis ou le DJ en a besoin, c'est-a-dire au debut, quand
       l'analyse de fond n'a eu le temps de traiter que quelques
       dizaines de morceaux.

       On distingue donc « energie faible, mesuree » de « energie
       inconnue ». Un titre non analyse reste candidat : sa
       notoriete dit deja s'il remonte une salle, et c'est meme le
       critere principal d'un sauvetage.
       ------------------------------------------------------------ */
    const mesuree = !!t.analyzed && t.energy != null;
    const e = t.energy == null ? 5 : t.energy;
    if (mesuree && e < 5.4) continue;            /* mesure basse : on l'ecarte */
    if (!mesuree && (t.pop == null ? 40 : t.pop) < 30) continue;
    /* pas encore analyse : c'est la notoriete qui tient lieu d'impact */

    /* reconnaissance immediate : notoriete d'abord, ADN de la salle ensuite */
    const fam = (t.pop == null ? 40 : t.pop) * 0.62 + crowdScore(t, dna, dnaPret) * 0.38;

    /* impact : energie, voix, et une intro courte */
    const st = structures.get(t.id);
    const introBars = st && st.ok ? st.introBars : null;
    const quick = introBars == null ? 60 : Math.max(0, 100 - Math.max(0, introBars - 4) * 9);
    const impact = (mesuree ? e * 7 : (t.pop == null ? 40 : t.pop) * 0.62)
                 + (t.vocal ? 14 : 0) + quick * 0.3;

    const total = Math.round(
      tp.s * 0.28 + h * 0.14 + fam * 0.34 + Math.min(100, impact) * 0.24
    ) + (wanted.has(t.id) ? 12 : 0) + Math.round(penaliteVariete(t, M) * 0.5);
    out.push({
      track: t, total: Math.max(4, Math.min(99, total)),
      tempo: tp, h: h, fam: Math.round(fam), energy: e,
      introBars: introBars, client: wanted.has(t.id),
      why: wanted.has(t.id) ? 'Demande par le client'
        : (introBars != null && introBars <= 4
            ? 'Entre en ' + introBars + ' mesures'
            : (t.pop >= 70 ? 'La salle la connait'
               : (mesuree ? 'Energie ' + e + '/10' : 'Valeur sure'))),
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

/* ------------------------------------------------------------
   Les formes mises a plat, gardees sur le morceau.

   normalize() applique cinq expressions regulieres et une
   decomposition Unicode. Le faire trois fois par morceau et par
   frappe de clavier, sur trente mille morceaux, coutait une
   seconde par lettre tapee : un invite qui ecrit « stromae » sur
   son telephone attendait sept secondes.

   Ces trois formes ne dependent que du titre et de l'artiste. On
   les calcule une fois, on les garde, et la recherche redevient
   instantanee.
   ------------------------------------------------------------ */
function formesDe(t) {
  if (t._n) return t._n;
  const artist = t.artist || '', title = t.title || '';
  const n = [
    normalize(artist + ' ' + title),
    normalize(title + ' ' + artist),
    normalize(title)
  ];
  Object.defineProperty(t, '_n', { value: n, enumerable: false, writable: true });
  return n;
}

/* ------------------------------------------------------------
   L'index de recherche.

   Comparer une requete a trente mille morceaux demande quatre-
   vingt-dix mille comparaisons de bigrammes : sept cents
   millisecondes, a chaque lettre tapee par un invite. Inutilisable
   sur un telephone.

   Or un morceau ne peut atteindre le seuil que s'il partage au
   moins un mot avec la requete — ou un debut de mot, pour survivre
   aux fautes de frappe. On construit donc, une fois par
   bibliotheque, un index des mots et des debuts de mots ; la
   requete n'est comparee qu'aux morceaux qui en partagent un.

   Le debut de mot est a trois lettres : « dreems » et « dreams »
   partagent « dre », « eurythmic » et « eurythmics » partagent
   « eur ». C'est ce qui garde la tolerance aux fautes tout en
   ecartant les vingt-neuf mille morceaux sans rapport.

   L'index est attache a la bibliotheque par une WeakMap : quand
   elle est remplacee, il disparait avec elle.
   ------------------------------------------------------------ */
const INDEX = new WeakMap();

function motsDe(s) {
  const out = [];
  for (const m of String(s || '').split(' ')) if (m.length >= 2) out.push(m);
  return out;
}

function indexDe(library) {
  let ix = INDEX.get(library);
  if (ix && ix.n === library.length) return ix;
  const mots = new Map(), debuts = new Map();
  const ajoute = (carte, cle, i) => {
    let s = carte.get(cle);
    if (!s) { s = []; carte.set(cle, s); }
    if (s[s.length - 1] !== i) s.push(i);
  };
  for (let i = 0; i < library.length; i++) {
    const f = formesDe(library[i]);
    for (const m of motsDe(f[0])) {
      ajoute(mots, m, i);
      if (m.length >= 3) ajoute(debuts, m.slice(0, 3), i);
    }
  }
  ix = { mots, debuts, n: library.length };
  INDEX.set(library, ix);
  return ix;
}

/** Les morceaux qui valent la peine d'etre compares a cette requete. */
function candidats(q, library) {
  const ix = indexDe(library);
  const vus = new Set();
  for (const m of motsDe(q)) {
    const exact = ix.mots.get(m);
    if (exact) for (const i of exact) vus.add(i);
    if (m.length >= 3) {
      const pre = ix.debuts.get(m.slice(0, 3));
      if (pre) for (const i of pre) vus.add(i);
    }
  }
  /* Filet : quand l'index ne propose rien — mots colles
     (« djpaxel »), faute sur les trois premieres lettres — on
     repasse sur la bibliotheque. C'est lent, mais ca n'arrive que
     sur une requete qui n'aurait rien donne du tout, et une demi-
     seconde d'attente vaut mieux qu'un « aucun resultat » alors
     que le morceau est la.

     Borne, en revanche. Ce filet est atteignable depuis la page
     des invites, qui tourne dans le processus principal : sur
     30 000 titres, un balayage complet gelait le widget et la
     detection du deck pendant plusieurs secondes. Six mille
     comparaisons coutent une cinquantaine de millisecondes et
     retrouvent le morceau dans la quasi-totalite des cas. */
  if (!vus.size) {
    const plafond = Math.min(library.length, 6000);
    for (let i = 0; i < plafond; i++) vus.add(i);
  }
  return vus;
}

function noteDe(q, t) {
  const f = formesDe(t);
  return Math.max(combine(q, f[0]), combine(q, f[1]), combine(q, f[2]));
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
  for (const i of candidats(q, library)) {
    const sc = noteDe(q, library[i]);
    if (sc > bestScore) { bestScore = sc; best = library[i]; }
  }
  return bestScore >= threshold ? { track: best, score: bestScore } : null;
}

/** Les n meilleurs, pour proposer un choix plutot qu'imposer une reponse. */
function search(text, library, limit, threshold) {
  const q = normalize(text);
  if (q.length < 2) return [];
  const seuil = threshold == null ? 0.34 : threshold;
  const out = [];
  for (const i of candidats(q, library)) {
    const sc = noteDe(q, library[i]);
    if (sc >= seuil) out.push({ track: library[i], score: sc });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit || 8);
}

module.exports = { camelot, harmScore, tempoScore, energyScore, timbreScore, crowdScore,
                   transitionOf, suggest, keyOf, normalize, match, search, dice, combine,
                   mixPlan, rescue, mmss, memoireDe, penaliteVariete, passeLeCrible, genres, formesDe };
