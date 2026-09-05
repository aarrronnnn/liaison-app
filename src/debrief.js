'use strict';
/* ============================================================
   Le debrief de fin de soiree.

   Un DJ ne recoit jamais de retour sur ce qu'il vient de jouer.
   La salle etait pleine ou vide, il a une impression, et c'est
   tout. Il ne sait pas a quelle heure l'energie est vraiment
   montee, ni combien de temps il est reste dans le meme genre,
   ni quel enchainement etait le meilleur de la nuit — il s'en
   souvient parfois, jamais avec des chiffres.

   Liaison a tout ce qu'il faut pour le lui dire : il a note
   chaque morceau, son heure, sa duree reelle, son tempo, sa
   tonalite, son energie, ses genres, et ce qu'il proposait au
   moment ou le DJ a choisi autre chose.

   Ce module ne juge pas et ne conseille pas. Il MESURE, et il
   rend des phrases francaises. C'est la difference entre un
   outil et un professeur — et c'est la promesse de la page
   d'accueil : « aucun conseil, aucune note, aucun tu aurais du ».
   ============================================================ */
const engine = require('./engine');
const genres = require('./genres');

const hhmm = t => {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, '0') + ' h ' + String(d.getMinutes()).padStart(2, '0');
};
const arrondi = (x, n) => Math.round(x * Math.pow(10, n || 0)) / Math.pow(10, n || 0);

/* La duree reelle de chaque morceau, deduite de l'heure du suivant.
   Le dernier n'a pas de suivant : on lui prete la mediane. */
function durees(joues) {
  const d = [];
  for (let i = 1; i < joues.length; i++) {
    const s = (joues[i].at - joues[i - 1].at) / 1000;
    d.push(s > 30 && s < 1200 ? s : null);
  }
  const vrais = d.filter(x => x != null).sort((a, b) => a - b);
  const med = vrais.length ? vrais[Math.floor(vrais.length / 2)] : 210;
  return d.map(x => x == null ? med : x).concat([med]);
}

/* ------------------------------------------------------------
   La courbe reellement jouee, heure par heure.
   ------------------------------------------------------------ */
function courbe(joues) {
  const par = new Map();
  for (const t of joues) {
    const h = new Date(t.at).getHours();
    if (!par.has(h)) par.set(h, []);
    par.get(h).push(t.energy == null ? 5 : t.energy);
  }
  return Array.from(par.entries())
    .map(([h, es]) => ({ h: h, e: arrondi(es.reduce((a, b) => a + b, 0) / es.length, 1), n: es.length }))
    /* on remet dans l'ordre de la nuit : 22, 23, 0, 1, 2… */
    .sort((a, b) => ((a.h + 6) % 24) - ((b.h + 6) % 24));
}

/* ------------------------------------------------------------
   Les meilleurs enchainements de la nuit.

   On renote a posteriori chaque passage d'un morceau au suivant,
   avec le meme moteur qui proposait sur le moment. Ce ne sont pas
   des suggestions : ce sont les choix du DJ, mesures.
   ------------------------------------------------------------ */
function enchainements(joues) {
  const out = [];
  for (let i = 1; i < joues.length; i++) {
    const a = joues[i - 1], b = joues[i];
    if (!(a.bpm > 0) || !(b.bpm > 0)) continue;
    const h = engine.harmScore(a.key, b.key);
    const tp = engine.tempoScore(a.bpm, b.bpm);
    /* Harmonie et tempo seulement : ce sont les deux seules choses
       qu'on peut affirmer sans connaitre l'intention. */
    const note = Math.round(h * 0.55 + tp.s * 0.45);
    out.push({
      de: a.title, deA: a.artist, vers: b.title, versA: b.artist,
      note: note, h: h, tempo: arrondi(tp.pct, 2),
      cle: (a.key || '?') + ' → ' + (b.key || '?'),
      quand: hhmm(b.at)
    });
  }
  return out;
}

/* ------------------------------------------------------------
   La variete : combien de familles de genres, et la plus longue
   serie sans en changer.
   ------------------------------------------------------------ */
function variete(joues) {
  const vues = new Map();
  let serie = 0, pire = 0, pireFam = null, courante = null;
  for (const t of joues) {
    const fams = Array.from(genres.famillesDe(t).keys());
    for (const f of fams) vues.set(f, (vues.get(f) || 0) + 1);
    const principale = fams[0] || null;
    if (principale && principale === courante) {
      serie++;
      if (serie > pire) { pire = serie; pireFam = principale; }
    } else { courante = principale; serie = 1; if (serie > pire) { pire = serie; pireFam = principale; } }
  }
  const total = joues.length || 1;
  const classe = Array.from(vues.entries()).sort((a, b) => b[1] - a[1]);
  return {
    familles: vues.size,
    dominante: classe[0] ? { nom: classe[0][0], part: Math.round(classe[0][1] / total * 100) } : null,
    plusLongueSerie: pire,
    serieFamille: pireFam,
    top: classe.slice(0, 5).map(([n, c]) => ({ nom: n, part: Math.round(c / total * 100) }))
  };
}

/* ------------------------------------------------------------
   Le debrief complet.
   @param {object} set        une entree de SetLog (avec .played)
   @param {object} opt        { demandes: [...], cible: [[heure,energie],...] }
   ------------------------------------------------------------ */
function debrief(set, opt) {
  opt = opt || {};
  const joues = (set && set.played) || [];
  if (joues.length < 3) return null;          /* trop court pour dire quoi que ce soit */

  const d = durees(joues);
  const totalSec = d.reduce((a, b) => a + b, 0);
  const bpms = joues.map(t => t.bpm).filter(x => x > 0);
  const energies = joues.map(t => t.energy).filter(x => x != null);
  const c = courbe(joues);
  const ench = enchainements(joues);
  const v = variete(joues);

  const pic = c.length ? c.reduce((m, x) => x.e > m.e ? x : m, c[0]) : null;
  const artistes = new Set(joues.map(t => String(t.artist || '').toLowerCase()).filter(Boolean));

  /* Ce que la salle a demande, et ce qui a ete joue. */
  const dem = opt.demandes || [];
  const titres = new Set(joues.map(t => (String(t.artist || '') + ' ' + String(t.title || '')).toLowerCase()));
  const honorees = dem.filter(r => {
    const cle = (String(r.artist || '') + ' ' + String(r.title || '')).toLowerCase().trim();
    for (const t of titres) if (t.includes(String(r.title || '').toLowerCase()) && r.title) return true;
    return titres.has(cle);
  }).length;

  const meilleurs = ench.slice().sort((a, b) => b.note - a.note).slice(0, 3);

  return {
    nom: set.name || 'Session',
    quand: set.at,
    debut: joues.length ? hhmm(joues[0].at) : '',
    fin: joues.length ? hhmm(joues[joues.length - 1].at) : '',
    morceaux: joues.length,
    minutes: Math.round(totalSec / 60),
    dureeMoyenne: Math.round(totalSec / joues.length),
    tempo: bpms.length ? { min: Math.min(...bpms), max: Math.max(...bpms),
      median: bpms.slice().sort((a, b) => a - b)[Math.floor(bpms.length / 2)] } : null,
    energie: energies.length ? { min: Math.min(...energies), max: Math.max(...energies),
      moyenne: arrondi(energies.reduce((a, b) => a + b, 0) / energies.length, 1) } : null,
    pic: pic,
    courbe: c,
    artistes: artistes.size,
    variete: v,
    enchainements: { n: ench.length, meilleurs: meilleurs,
      medianeHarmonie: ench.length ? ench.slice().sort((a, b) => a.h - b.h)[Math.floor(ench.length / 2)].h : null,
      medianeTempo: ench.length ? arrondi(ench.slice().sort((a, b) => a.tempo - b.tempo)[Math.floor(ench.length / 2)].tempo, 2) : null },
    demandes: { recues: dem.length, jouees: honorees }
  };
}

/* ------------------------------------------------------------
   Le meme debrief, en phrases. Des constats, jamais des conseils.
   ------------------------------------------------------------ */
function enPhrases(D) {
  if (!D) return [];
  const p = [];
  p.push({ t: 'La nuit', d: D.morceaux + ' morceaux entre ' + D.debut + ' et ' + D.fin +
    ', soit ' + Math.floor(D.minutes / 60) + ' h ' + String(D.minutes % 60).padStart(2, '0') +
    ' de musique. Un morceau toutes les ' + Math.floor(D.dureeMoyenne / 60) + ' min ' +
    String(D.dureeMoyenne % 60).padStart(2, '0') + ' s en moyenne.' });

  if (D.pic) p.push({ t: 'Le pic', d: 'L\'energie la plus haute est tombee entre ' + D.pic.h +
    ' h et ' + ((D.pic.h + 1) % 24) + ' h, a ' + D.pic.e + ' sur 10, sur ' + D.pic.n + ' morceaux.' });

  if (D.tempo) p.push({ t: 'Le tempo', d: 'De ' + Math.round(D.tempo.min) + ' a ' +
    Math.round(D.tempo.max) + ' BPM, mediane a ' + Math.round(D.tempo.median) + '. ' +
    'Ecart median entre deux morceaux enchaines : ' + D.enchainements.medianeTempo + ' %.' });

  if (D.variete.dominante) p.push({ t: 'La variete', d: D.variete.familles +
    ' familles de genres traversees. La plus presente : ' + D.variete.dominante.nom +
    ', a ' + D.variete.dominante.part + ' % du set. Plus longue serie sans changer de famille : ' +
    D.variete.plusLongueSerie + ' morceaux' + (D.variete.serieFamille ? ' de ' + D.variete.serieFamille : '') + '.' });

  p.push({ t: 'Les artistes', d: D.artistes + ' artistes differents sur ' + D.morceaux +
    ' morceaux, soit ' + Math.round(D.artistes / D.morceaux * 100) + ' % de noms uniques.' });

  if (D.enchainements.medianeHarmonie != null) p.push({ t: 'L\'harmonie',
    d: 'Accord median entre deux morceaux : ' + D.enchainements.medianeHarmonie + ' sur 100. ' +
       '100 = meme tonalite, 93 = voisine sur la roue, 50 = tonalite inconnue.' });

  if (D.demandes.recues) {
    const n = D.demandes.recues, j = D.demandes.jouees;
    p.push({ t: 'La salle', d: n + ' demande' + (n > 1 ? 's' : '') + ' recue' + (n > 1 ? 's' : '') +
      ', ' + j + ' jouee' + (j > 1 ? 's' : '') + '.' });
  }

  return p;
}

module.exports = { debrief, enPhrases, courbe, enchainements, variete, durees };
