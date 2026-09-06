'use strict';
/* ============================================================
   « David Guetta avec les chutes du Niagara. »

   C'est le rapport de bug qui a produit ce fichier, et il decrivait
   un vrai defaut, pas une impression.

   Le moteur note six axes. L'energie en pese 15 %, le timbre 14 %.
   Quand ces deux mesures manquaient — morceau pas encore analyse —
   le calcul les remplacait par des valeurs NEUTRES :

     energyScore(5, 5, 'up')  = 77,6 sur 100
     timbreScore(null, null)  = 60   sur 100

   Autrement dit : ne rien savoir rapportait 29 % de la note,
   gratuitement. Un morceau reellement mesure mais dont l'energie
   collait moyennement tombait plus bas. L'inconnu battait le connu.

   Une nappe d'ambiance passait donc devant un morceau de club :
   BPM invente par rekordbox, pas de tonalite donc rien a perdre sur
   l'harmonie, et les 29 % restants offerts.

   Ces essais figent le comportement corrige :
     — un morceau non mesure ne passe jamais devant un morceau
       mesure qui colle ;
     — tant qu'il existe assez de morceaux mesures, eux seuls sont
       proposes ;
     — mais sur une bibliotheque fraiche, ou rien n'est encore
       analyse, l'application propose quand meme quelque chose.
   ============================================================ */
const engine = require('../src/engine.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(56),
              detail ? '  — ' + detail : '');
}

/* ---------- le morceau qui tourne : un gros titre de club ---------- */
const guetta = {
  id: 'cur', artist: 'David Guetta', title: 'Titles', bpm: 128, key: '8A',
  energy: 8, timbre: [0.6, 0.5, 0.7], genre: 'Dance', pop: 90,
  analyzed: true, vocal: true
};

/* ---------- la nappe d'ambiance, jamais analysee ----------
   Elle porte un BPM parce que rekordbox en invente un sur a peu
   pres tout, et aucune tonalite. Elle n'a ni energie ni timbre. */
const niagara = {
  id: 'niagara', artist: 'Ambiance', title: 'Les chutes du Niagara',
  bpm: 127, key: '8A', energy: null, timbre: null, genre: 'Dance', pop: 60,
  analyzed: false
};

/* ---------- un vrai enchainement, mesure ----------
   Attention a ne pas le rendre PARFAIT : un morceau dont l'energie
   et le timbre collent au millimetre battrait la nappe meme avec
   l'ancien calcul, et l'essai passerait pour de mauvaises raisons.
   Ce qu'on veut reproduire, c'est le cas reel : un enchainement
   correct mais pas ideal — le genre de titre qu'un DJ joue tous les
   soirs — qui se faisait doubler par un fichier jamais ecoute. */
function titreMesure(i) {
  return {
    id: 'ok' + i, artist: 'Artiste ' + i, title: 'Titre ' + i,
    bpm: 127 + (i % 3), key: '8A', energy: 6, timbre: [0.2, 0.9, 0.1],
    genre: 'Dance', pop: 60, analyzed: true, vocal: false
  };
}

/* ============================================================
   1. Le cas signale : un seul bon candidat face a la nappe.
   ============================================================ */
{
  const bib = [guetta, niagara, titreMesure(1)];
  const r = engine.suggest(guetta, bib, { limit: 5, arc: 'up' });
  const noms = r.map(x => x.track.id);
  const rangOk = noms.indexOf('ok1'), rangNap = noms.indexOf('niagara');
  verifier('1. la nappe ne passe pas devant le titre mesure',
           rangOk !== -1 && (rangNap === -1 || rangOk < rangNap),
           'ordre obtenu : ' + noms.join(', ') +
           '  (notes : ' + r.map(x => x.track.id + '=' + x.total).join(' ') + ')');
}

/* ============================================================
   2. Assez de morceaux mesures : la nappe disparait.
   ============================================================ */
{
  const bib = [guetta, niagara];
  for (let i = 1; i <= 12; i++) bib.push(titreMesure(i));
  const r = engine.suggest(guetta, bib, { limit: 5, arc: 'up' });
  verifier('2. avec 12 titres mesures, la nappe sort de la liste',
           !r.some(x => x.track.id === 'niagara'),
           r.length + ' propositions');
  verifier('2bis. les cinq proposes sont tous mesures',
           r.every(x => x.track.analyzed), '');
}

/* ============================================================
   3. Bibliotheque fraiche : rien n'est analyse, il faut quand
      meme proposer quelque chose, sinon l'app parait cassee.
   ============================================================ */
{
  const bib = [guetta];
  for (let i = 1; i <= 6; i++) {
    const t = titreMesure(i);
    t.analyzed = false; t.energy = null; t.timbre = null;
    bib.push(t);
  }
  const r = engine.suggest(guetta, bib, { limit: 5, arc: 'up' });
  verifier('3. rien d\'analyse : l\'app propose quand meme',
           r.length > 0, r.length + ' propositions');
}

/* ============================================================
   4. Le morceau EN COURS n'est pas mesure : l'axe energie ne veut
      plus rien dire, il ne doit punir personne au hasard. Les
      candidats mesures et non mesures gardent le meme ecart que
      leur harmonie et leur tempo justifient.
   ============================================================ */
{
  const curNon = Object.assign({}, guetta, { energy: null, timbre: null, analyzed: false });
  const bib = [curNon, titreMesure(1), titreMesure(2)];
  const r = engine.suggest(curNon, bib, { limit: 5, arc: 'up' });
  verifier('4. morceau en cours non mesure : ca propose quand meme',
           r.length === 2, r.length + ' propositions');
}

/* ============================================================
   5. Le crible de tempo tient toujours : un morceau a 90 BPM
      n'a rien a faire derriere un morceau a 128.
   ============================================================ */
{
  const lent = titreMesure(9);
  lent.id = 'lent'; lent.bpm = 90;
  const bib = [guetta, lent, titreMesure(1)];
  const r = engine.suggest(guetta, bib, { limit: 5, arc: 'up' });
  verifier('5. un titre a 90 BPM reste ecarte a 128',
           !r.some(x => x.track.id === 'lent'), '');
}

if (echecs) {
  console.error('\n' + echecs + ' cas de suggestion en echec.');
  process.exit(1);
}
console.log('\nsuggestions : l\'inconnu ne passe plus devant le connu.');
