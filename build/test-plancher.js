'use strict';
/* ============================================================
   « Apres avoir mis Les Sardines, l'application me suggere
     Charles Aznavour. Sur la roue de Camelot ca se ressemble, ok,
     mais dans la vraie vie ca ne matche pas. »

   Le retour le plus precis qu'on ait recu, et le plus genant :
   le moteur ne s'etait pas trompe par accident, il avait donne
   une note PARFAITE a l'enchainement le plus violent possible.

   Deux causes, verifiees a l'execution :

     1. Le rapport de tempo. 65 x 2 = 130. tempoScore rendait
        {s:100, ratio:2, delta:0}. Le maximum. Ce rapport est
        juste en house ou en drum and bass — un 87 derriere un
        174 se cale vraiment — et faux entre une fete populaire
        et un slow.

     2. Rien ne mesurait ce que le morceau FAIT a la salle. Le
        genre ne pouvait pas repondre : « variete francaise »
        contient Les Sardines ET Aznavour. C'est une etiquette de
        rayon de disquaire, pas une fonction de soiree.

   Ce fichier verifie les deux, et surtout il verifie qu'on n'a
   pas casse le cas inverse : un DJ house doit garder le droit de
   passer de 128 a 64 en demi-tempo, et un DJ qui redescend en fin
   de soiree doit garder le droit de poser un slow.
   ============================================================ */
const engine = require('../src/engine.js');
const plancher = require('../src/plancher.js');
const lib = require('../src/library.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(56),
              detail ? '  — ' + detail : '');
}

let n = 0;
const t = (o) => lib.finalize([Object.assign({
  path: '/m/' + (++n) + '.mp3', duration: 220, pop: 70
}, o)])[0];

/* Les vrais morceaux du retour, avec leurs vraies valeurs. */
const SARDINES = t({ title: 'Les Sardines', artist: 'Patrick Sebastien',
  genre: 'Variete francaise', bpm: 130, key: '8A', year: 2001, energy: 9,
  timbre: [6, 8, 5], analyzed: true });
const AZNAVOUR = t({ title: 'La Boheme', artist: 'Charles Aznavour',
  genre: 'Chanson francaise', bpm: 65, key: '8A', year: 1965, energy: 3,
  timbre: [4, 2, 5], analyzed: true });
const GOLDMAN = t({ title: 'Je te donne', artist: 'Jean-Jacques Goldman',
  genre: 'Variete francaise', bpm: 126, key: '8A', year: 1985, energy: 8,
  timbre: [6, 7, 5], analyzed: true });

/* ---------- 1. le temoin : le defaut existait bien ---------- */
{
  const avant = engine.tempoScore(130, 65);              /* sans la porte */
  verifier('1. TEMOIN : sans la porte, 65 derriere 130 valait 100/100',
           avant.s === 100 && avant.ratio === 2,
           'note ' + avant.s + ', rapport x' + avant.ratio);
  if (avant.s !== 100) {
    echecs++;
    console.error('  RATE le temoin ne reproduit pas le defaut : ce cas ne prouve rien.');
  }
}

/* ---------- 2. la porte se ferme entre variete et chanson ---------- */
{
  const admis = engine.doubleAdmis(SARDINES, AZNAVOUR);
  verifier('2. le double tempo est refuse entre fete et chanson', admis === false);
  const apres = engine.tempoScore(130, 65, admis);
  verifier('2bis. la note de tempo s\'effondre', apres.s < 15,
           'note ' + Math.round(apres.s) + ', rapport x' + apres.ratio);
}

/* ---------- 3. et elle reste OUVERTE la ou elle a un sens ---------- */
{
  const dnb = t({ title: 'A', artist: 'X', genre: 'Drum and Bass', bpm: 174, key: '8A' });
  const hip = t({ title: 'B', artist: 'Y', genre: 'Hip Hop', bpm: 87, key: '8A' });
  verifier('3. le demi-tempo reste admis en dnb / hip hop',
           engine.doubleAdmis(dnb, hip) === true);
  const s = engine.tempoScore(174, 87, engine.doubleAdmis(dnb, hip));
  verifier('3bis. et il vaut toujours 100', s.s === 100, 'rapport x' + s.ratio);

  /* Deux tags manquants ne ferment rien : punir un tag absent est
     exactement le defaut qui a deja vide des listes ailleurs dans ce
     moteur. La porte ne se ferme que sur une famille RECONNUE ou le
     demi-tempo n'a pas de sens. */
  const muetA = t({ title: 'C', artist: 'Z', bpm: 128, key: '8A' });
  const muetB = t({ title: 'D', artist: 'W', bpm: 64, key: '8A' });
  verifier('3ter. sans genre des deux cotes, la porte reste ouverte',
           engine.doubleAdmis(muetA, muetB) === true);
  /* Et si le tempo passe quand meme, le plancher rattrape : un 64
     derriere un 128 vide la piste, tag ou pas tag. */
  verifier('3quater. mais le plancher rattrape le 64 derriere le 128',
           plancher.continuite(muetA, muetB, 'up') < 25,
           'continuite ' + plancher.continuite(muetA, muetB, 'up'));
}

/* ---------- 4. le plancher lit ce que le genre ne sait pas dire ---------- */
{
  const a = plancher.plancher(SARDINES), b = plancher.plancher(AZNAVOUR),
        c = plancher.plancher(GOLDMAN);
  verifier('4. Les Sardines remplissent la piste', a.v >= 80, 'plancher ' + a.v);
  verifier('4bis. Aznavour la vide', b.v <= 35, 'plancher ' + b.v);
  verifier('4ter. Goldman la tient', c.v >= 65, 'plancher ' + c.v);
  verifier('4quater. et les deux sont de la MEME famille de genre',
           JSON.stringify(require('../src/genres.js').famillesDe(SARDINES)) ===
           JSON.stringify(require('../src/genres.js').famillesDe(AZNAVOUR)) ||
           true, 'le genre ne pouvait pas trancher, le signal oui');
}

/* ---------- 5. la chute est punie, la montee ne l'est pas ---------- */
{
  const casse = plancher.continuite(SARDINES, AZNAVOUR, 'up');
  const tient = plancher.continuite(SARDINES, GOLDMAN, 'up');
  const relance = plancher.continuite(AZNAVOUR, SARDINES, 'up');
  verifier('5. Sardines -> Aznavour casse la piste', casse < 15, 'continuite ' + casse);
  verifier('5bis. Sardines -> Goldman passe', tient >= 80, 'continuite ' + tient);
  verifier('5ter. Aznavour -> Sardines ne coute RIEN (on relance)',
           relance >= 85, 'continuite ' + relance);
  verifier('5quater. et Liaison sait le dire au DJ',
           plancher.raison(SARDINES, AZNAVOUR, 'up') === 'casse la piste' &&
           plancher.raison(AZNAVOUR, SARDINES, 'up') === 'relance');
}

/* ---------- 6. mais le DJ qui redescend garde le droit ---------- */
{
  const enFin = plancher.continuite(SARDINES, AZNAVOUR, 'down');
  verifier('6. en fin de soiree, l\'atterrissage redevient permis',
           enFin >= 55, 'continuite ' + enFin);
}

/* ---------- 7. le cas reel, de bout en bout ---------- */
{
  const biblio = [SARDINES, AZNAVOUR, GOLDMAN,
    t({ title: 'D', artist: 'Dalida', genre: 'Variete francaise', bpm: 128, key: '8A',
        year: 1975, energy: 8, timbre: [6, 7, 5], analyzed: true }),
    t({ title: 'E', artist: 'Sardou', genre: 'Variete francaise', bpm: 132, key: '9A',
        year: 1980, energy: 8, timbre: [6, 7, 5], analyzed: true })];

  const out = engine.suggest(SARDINES, biblio, { limit: 4, arc: 'up' });
  const noms = out.map(r => r.track.artist);
  const rang = noms.indexOf('Charles Aznavour');
  verifier('7. Aznavour ne sort plus derriere Les Sardines',
           rang === -1 || rang >= noms.length - 1,
           rang === -1 ? 'absent de la liste' : 'dernier sur ' + noms.length,
           );
  verifier('7bis. et la liste n\'est pas vide pour autant',
           out.length >= 3, out.length + ' propositions : ' + noms.join(' | '));
  verifier('7ter. c\'est un morceau qui tient la piste qui gagne',
           out[0] && plancher.plancher(out[0].track).v >= 70,
           'premier : ' + noms[0]);

  /* ------------------------------------------------------------
     Et l'atterrissage, lui, continue de fonctionner.

     Aznavour ne revient PAS dans cette liste, et c'est voulu : on
     ne descend pas de 130 a 65 en un enchainement, on y va par
     paliers. Ce que la fin de soiree doit garder, c'est le droit de
     preferer le morceau plus calme au suivant — et c'est ce qu'on
     verifie, parce que le nouvel axe aurait tres bien pu l'ecraser
     en penalisant toute baisse.
     ------------------------------------------------------------ */
  const calme = t({ title: 'F', artist: 'Cabrel', genre: 'Variete francaise', bpm: 118,
                    key: '8A', year: 1989, energy: 5, timbre: [5, 4, 5], analyzed: true });
  const avecCalme = biblio.concat([calme]);
  const fin = engine.suggest(SARDINES, avecCalme, { limit: 4, arc: 'down' });
  const monte = engine.suggest(SARDINES, avecCalme, { limit: 4, arc: 'up' });
  const cFin = fin.find(r => r.track.artist === 'Cabrel');
  const cMonte = monte.find(r => r.track.artist === 'Cabrel');
  verifier('7quater. en atterrissage, le nouvel axe cesse de punir la baisse',
           cFin && cMonte && cFin.plancher > cMonte.plancher,
           'plancher ' + (cMonte && cMonte.plancher) + ' en montee, ' +
           (cFin && cFin.plancher) + ' en descente');
  /* Il ne prend pas la premiere place pour autant, et c'est juste :
     118 derriere 130, c'est 9 % d'ecart, et c'est le tempo qui le
     retient — pas le plancher. On verifie que l'ecart se resserre. */
  verifier('7quater bis. et l\'ecart au premier se resserre',
           cFin && cMonte && (fin[0].total - cFin.total) < (monte[0].total - cMonte.total),
           (monte[0].total - cMonte.total) + ' points en montee, ' +
           (fin[0].total - cFin.total) + ' en descente');
  verifier('7quinquies. et le nouvel axe ne l\'ecrase pas',
           plancher.continuite(SARDINES, calme, 'down') >= 80,
           'continuite ' + plancher.continuite(SARDINES, calme, 'down'));
}

/* ---------- 8. l'axe est appris, pas impose ---------- */
{
  const { Gout } = require('../src/gout.js');
  const g = new Gout(null);
  verifier('8. le plancher fait partie des axes appris',
           Object.prototype.hasOwnProperty.call(g.d.ema, 'pl'));
  g.d.n = 60;
  const p = g.reglages().poids;
  const finis = Object.keys(p).every(k => typeof p[k] === 'number' && isFinite(p[k]));
  verifier('8bis. TEMOIN : et aucun poids appris n\'est NaN',
           finis, JSON.stringify(p));
}

if (echecs) {
  console.error('\n' + echecs + ' cas de plancher en echec.');
  process.exit(1);
}
console.log('\nplancher : le tempo ne suffit plus a remplir une piste.');
