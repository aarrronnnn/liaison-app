'use strict';
/* ============================================================
   « Les sons matchent, mais pas assez. »

   C'est le retour le plus frequent, et c'est une critique juste.
   Le moteur savait juger si deux morceaux sont COMPATIBLES —
   tempo, tonalite, energie, timbre. Il ne savait pas si un DJ les
   enchaine reellement. Ce sont deux choses differentes, et l'ecart
   entre les deux est exactement ce que les DJs entendent.

   Or la reponse etait deja sur leur machine : session.js garde
   chaque morceau joue, dans l'ordre, depuis la premiere soiree.

   Ce fichier verifie les trois choses qui comptent :
     — l'habitude observee remonte le morceau ;
     — l'axe mesure une ASSOCIATION, pas une frequence : un genre
       que le DJ joue beaucoup ne doit pas remonter partout ;
     — sans historique, l'axe se tait completement.
   ============================================================ */
const engine = require('../src/engine.js');
const aff = require('../src/affinites.js');
const lib = require('../src/library.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(54),
              detail ? '  — ' + detail : '');
}

/* Un DJ de mariage : il part de la variete et enchaine en disco,
   systematiquement. Il joue aussi beaucoup de house, mais un peu
   partout — sans que ce soit une habitude d'enchainement. */
function historique() {
  const suite = ['Variete francaise', 'Disco', 'House', 'Pop',
                 'Variete francaise', 'Disco', 'House', 'House'];
  const sets = [];
  for (let s = 0; s < 5; s++) {
    const played = suite.map((g, i) => ({
      id: 1000 + s * 10 + i, artist: g + ' ' + i, title: g + ' ' + i,
      tags: [g.toLowerCase()], at: Date.now() + i * 200000
    }));
    sets.push({ id: s, played: played });
  }
  return sets;
}

const M = aff.construire(historique());
const t = (id, g) => ({ id: id, tags: [g.toLowerCase()] });

/* ---------- 1. l'habitude se voit ---------- */
{
  const habitude = aff.score(t(1, 'Variete francaise'), t(99, 'Disco'), M);
  const jamais = aff.score(t(1, 'Variete francaise'), t(98, 'Techno'), M);
  verifier('1. variete puis disco : l\'habitude remonte', habitude > 65, 'note ' + habitude);
  verifier('1bis. variete puis techno : jamais vu, note neutre',
           jamais >= 45 && jamais <= 55, 'note ' + jamais);
}

/* ---------- 2. association, pas popularite ----------
   La house est le genre le plus joue de cet historique. Si l'axe
   mesurait la frequence, elle remonterait APRES N'IMPORTE QUOI.
   Elle ne doit remonter qu'apres ce qui l'appelle vraiment. */
{
  const apresPop = aff.score(t(3, 'Pop'), t(97, 'House'), M);
  const apresDisco = aff.score(t(2, 'Disco'), t(97, 'House'), M);
  verifier('2. le genre le plus joue ne remonte pas partout',
           apresPop < apresDisco,
           'apres pop ' + apresPop + ', apres disco ' + apresDisco);
}

/* ---------- 3. la paire exacte, quand elle existe ---------- */
{
  const h = historique();
  const a = h[0].played[0], b = h[0].played[1];
  const note = aff.score({ id: a.id, tags: a.tags }, { id: b.id, tags: b.tags }, aff.construire(h));
  verifier('3. une paire deja enchainee passe devant tout', note >= 80, 'note ' + note);
  verifier('3bis. et Liaison sait le dire en clair',
           !!aff.explication({ id: a.id }, { id: b.id }, aff.construire(h)),
           aff.explication({ id: a.id }, { id: b.id }, aff.construire(h)) || '');
}

/* ---------- 4. sans historique, silence complet ----------
   Le premier soir d'un DJ, l'axe ne doit rien changer du tout. */
{
  const vide = aff.construire([]);
  verifier('4. aucun historique : l\'axe se tait', vide.assez === false, vide.n + ' transitions');
  verifier('4bis. et rend une note strictement neutre',
           aff.score(t(1, 'Variete francaise'), t(2, 'Disco'), vide) === 50, '');
  const court = aff.construire([{ played: [{ id: 1, tags: ['house'] }, { id: 2, tags: ['disco'] }] }]);
  verifier('4ter. une seule soiree ne suffit pas non plus',
           court.assez === false, court.n + ' transitions, minimum ' + aff.MINI_TRANSITIONS);
}

/* ============================================================
   5. Dans le moteur, de bout en bout.
   ============================================================ */
{
  const mk = (i, g, y) => ({ path: '/m/a' + i + '.mp3', artist: 'A' + i, title: g,
    genre: g, year: y, bpm: 126, key: '8A', duration: 210, pop: 60 });
  const bib = lib.finalize([mk(0, 'Variete francaise', 1998), mk(1, 'Disco', 1979),
                            mk(2, 'Techno', 2024), mk(3, 'Pop', 2020)]);
  const sansHisto = engine.suggest(bib[0], bib, { limit: 3, arc: 'hold', annee: 2026 });
  const avecHisto = engine.suggest(bib[0], bib, { limit: 3, arc: 'hold', annee: 2026, affinites: M });
  const rangSans = sansHisto.map(x => x.track.title).indexOf('Disco');
  const rangAvec = avecHisto.map(x => x.track.title).indexOf('Disco');
  console.log('\n  temoin — sans historique : %s', sansHisto.map(x => x.track.title).join(' | '));
  console.log('           avec historique : %s', avecHisto.map(x => x.track.title).join(' | '));
  verifier('5. l\'historique fait remonter ce qu\'il enchaine vraiment',
           rangAvec <= rangSans && avecHisto[rangAvec] && avecHisto[rangAvec].affinite > 60,
           'position ' + (rangSans + 1) + ' -> ' + (rangAvec + 1) +
           ', affinite ' + (avecHisto[rangAvec] ? avecHisto[rangAvec].affinite : '?'));
  verifier('5bis. et rien ne bouge quand on ne lui en donne pas',
           sansHisto.every(x => x.affinite === 50), 'toutes les affinites a 50');
}

if (echecs) {
  console.error('\n' + echecs + ' cas d\'affinites en echec.');
  process.exit(1);
}
console.log('\naffinites : le moteur enchaine comme ce DJ enchaine.');
