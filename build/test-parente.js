'use strict';
/* ============================================================
   « Quand je mixe Informer, qui est un son un peu reggae, ca me
     donne L'amour, l'amour, l'amour, qui n'a rien a voir. »

   Retour de cabine du 14 septembre 2026, reproduit a
   l'execution avant d'etre corrige. Informer proposait, dans
   l'ordre : Benabar, Bon Entendeur, Corneille — et « Sweat »
   d'Inner Circle, meme famille, meme tonalite, 99 BPM contre 98,
   sortait QUATRIEME.

   Le moteur notait neuf criteres et aucun ne comparait le STYLE
   du candidat a celui du morceau en cours. Voir parente.js.

   Ce fichier verifie les deux sens, et le second compte autant
   que le premier :

     — que le morceau du meme monde remonte,
     — qu'on n'a pas construit une prison. Un DJ de mariage passe
       du disco au rap, et la liste ne doit jamais se vider ni se
       refermer sur une seule famille.
   ============================================================ */
const engine = require('../src/engine.js');
const parente = require('../src/parente.js');
const lib = require('../src/library.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(54),
              detail ? '  — ' + detail : '');
}
let n = 0;
const t = (o) => lib.finalize([Object.assign({
  path: '/m/' + (++n) + '.mp3', duration: 220, pop: 70 }, o)])[0];

/* Les vrais morceaux du retour, avec leurs vraies valeurs. */
const INFORMER = t({ title: 'Informer', artist: 'Snow', genre: 'Ragga',
                     bpm: 98, key: null, year: 1992, energy: 5 });
const BIB = [
  t({ title: 'L\'amour, l\'amour, l\'amour', artist: 'Bon Entendeur',
      genre: 'Variete Francai', bpm: 97, key: '7A', year: 2021, energy: 5 }),
  t({ title: 'Avec classe', artist: 'Corneille', genre: 'RnB',
      bpm: 98, key: null, year: 2003, energy: 5 }),
  t({ title: 'L\'effet Papillon', artist: 'Benabar', genre: 'Variete Francaise',
      bpm: 98, key: null, year: 2008, energy: 4 }),
  t({ title: 'Sweat', artist: 'Inner Circle', genre: 'Ragga',
      bpm: 99, key: '7A', year: 1992, energy: 6 }),
  t({ title: 'Zouk la', artist: 'Kassav', genre: 'Zouk',
      bpm: 100, key: '7A', year: 1985, energy: 6 })
];

/* ---------- 1. le temoin ----------
   On ne peut pas « eteindre » l'axe par un poids : l'apprentissage
   borne les multiplicateurs a 0,5, jamais a zero, et c'est une
   bonne chose — un axe ne doit pas pouvoir disparaitre.

   On rejoue donc le moteur tel qu'il etait : AVEUGLE AU STYLE.
   Les memes morceaux, les memes tempos, les memes tonalites, les
   memes annees — mais sans genre. C'est exactement ce que le
   moteur voyait avant parente.js, puisque rien ne comparait la
   famille du candidat a celle du morceau en cours.
   ---------------------------------------------------------------- */
{
  const sansGenre = (x) => t({ title: x.title, artist: x.artist, bpm: x.bpm,
                               key: x.key, year: x.year, energy: x.energy });
  const aveugle = engine.suggest(sansGenre(INFORMER), BIB.map(sansGenre),
                                 { limit: 5, arc: 'up', dna: {} });
  const noms = aveugle.map(r => r.track.artist);
  const rangSweat = noms.indexOf('Inner Circle');
  verifier('1. TEMOIN : aveugle au style, le ragga sortait derriere la chanson',
           rangSweat >= 2, 'Inner Circle en position ' + (rangSweat + 1) +
           ' — ' + noms.join(', '));
  if (rangSweat < 2) {
    echecs++;
    console.error('  RATE le temoin ne reproduit plus le defaut : ce cas ne prouve rien.');
  }
}

/* ---------- 2. le cas reel, corrige ---------- */
{
  const out = engine.suggest(INFORMER, BIB, { limit: 5, arc: 'up', dna: {} });
  const noms = out.map(r => r.track.artist);
  verifier('2. le ragga passe devant', noms[0] === 'Inner Circle', noms.join(' | '));
  verifier('2bis. et le monde du soleil suit', noms[1] === 'Kassav',
           'deuxieme : ' + noms[1]);
  verifier('2ter. la chanson francaise ferme la marche',
           ['Benabar', 'Bon Entendeur'].includes(noms[noms.length - 1]),
           'dernier : ' + noms[noms.length - 1]);
  verifier('2quater. et Liaison le dit au DJ',
           out.some(r => r.parenteDit === 'autre style'),
           out.map(r => r.parente).join(', '));
  /* La liste reste PLEINE : c'est une note, pas un filtre. */
  verifier('3. les cinq morceaux sont toujours proposes', out.length === 5,
           out.length + ' propositions');
}

/* ---------- 4. la table de voisinage se tient ---------- */
{
  const g = (genre) => t({ title: 'x', artist: 'x', genre: genre, bpm: 120 });
  const p = (a, b) => parente.score(g(a), g(b));
  const cas = [
    ['meme famille vaut le maximum',      p('Ragga', 'Ragga') === 100,         p('Ragga', 'Ragga')],
    ['variete et chanson, meme famille',  p('Variete Francaise', 'Chanson francaise') === 100, 100],
    ['disco et funk, la porte a cote',    p('Disco', 'Funk') >= 92,            p('Disco', 'Funk')],
    ['house et tech house aussi',         p('House', 'Tech House') >= 92,      p('House', 'Tech House')],
    ['ragga et reggaeton se tiennent',    p('Ragga', 'Reggaeton') >= 88,       p('Ragga', 'Reggaeton')],
    ['edm et tech house : meme maison',   p('EDM', 'Tech House') >= 80,        p('EDM', 'Tech House')],
    ['disco et techno : ca s\'entend',     p('Disco', 'Techno') <= 55,          p('Disco', 'Techno')],
    ['ragga et chanson : un autre monde', p('Ragga', 'Chanson francaise') <= 32, p('Ragga', 'Chanson francaise')]
  ];
  for (const [quoi, ok, v] of cas) verifier('4. ' + quoi, ok, 'note ' + v);

  /* ------------------------------------------------------------
     LA REGLE DE LA COURBE, et pourquoi elle est ici.

     Premiere version : note = proximite x 100, lineaire. Elle a
     casse un cas deja corrige — l'axe des epoques — et le cas
     avait raison : derriere un EDM, un EDM de 2012 repassait
     devant une tech house de 2025, parce que « meme famille »
     valait 100 contre 62 et effacait quatorze ans de retard.

     La parente empeche de changer de MONDE. Elle ne departage pas
     deux pieces de la meme maison — la, ce sont les autres axes
     qui doivent parler. On fige donc les deux ecarts.
     ------------------------------------------------------------ */
  const memeFamille = p('EDM', 'EDM');
  const voisin = p('EDM', 'Tech House');
  const etranger = p('EDM', 'Chanson francaise');
  verifier('4bis. entre voisins, la parente se tait presque',
           memeFamille - voisin <= 20, memeFamille + ' contre ' + voisin +
           ' — ' + (memeFamille - voisin) + ' points d\'ecart');
  verifier('4ter. mais l\'etranger tombe de haut',
           memeFamille - etranger >= 60, memeFamille + ' contre ' + etranger +
           ' — ' + (memeFamille - etranger) + ' points d\'ecart');
  verifier('4quater. la table est symetrique',
           ['Disco:House', 'Ragga:Zouk', 'Pop:Rock', 'Afro House:Dancehall']
             .every(x => { const [a, b] = x.split(':'); return p(a, b) === p(b, a); }));
}

/* ---------- 5. un tag inconnu ne coute RIEN ---------- */
{
  const g = (genre) => t({ title: 'x', artist: 'x', genre: genre, bpm: 120 });
  verifier('5. genre libre d\'un cote : note neutre',
           parente.score(g('Ragga'), g('Mes tubes a moi')) === 50);
  verifier('5bis. aucun genre du tout : note neutre',
           parente.score(t({ title: 'a', artist: 'a', bpm: 120 }),
                         t({ title: 'b', artist: 'b', bpm: 120 })) === 50);
  /* Et sur une bibliotheque entiere sans genre, l'axe ne classe
     personne : le comportement d'avant, exactement. */
  const sans = [];
  for (let i = 0; i < 8; i++)
    sans.push(t({ title: 'T' + i, artist: 'A' + i, bpm: 120 + i, key: '8A', year: 2020 }));
  const out = engine.suggest(sans[0], sans.slice(1), { limit: 5, arc: 'up', dna: {} });
  verifier('5ter. et toutes les notes de parente valent 50',
           out.every(r => r.parente === 50), out.map(r => r.parente).join(', '));
  verifier('5quater. la liste est pleine', out.length === 5, out.length + ' propositions');
}

/* ---------- 6. pas de prison : la soiree peut changer de monde ---------- */
{
  /* Une vraie bibliotheque de mariage : cinq familles, et rien du
     meme monde que ce qui tourne. La liste doit rester pleine, et
     proposer ce qui se tient le mieux — pas se vider. */
  /* Tous calables sur 100 BPM — sinon on ne mesurerait pas la
     parente mais le crible de tempo, qui ecarte a plus ou moins
     douze pour cent et n'a rien a voir avec ce cas-ci. */
  const zouk = t({ title: 'Zouk', artist: 'K', genre: 'Zouk', bpm: 100, key: '8A', year: 1985, energy: 6 });
  const ailleurs = [
    t({ title: 'D', artist: 'D1', genre: 'Disco', bpm: 104, key: '8A', year: 1978, energy: 8 }),
    t({ title: 'R', artist: 'R1', genre: 'Rock', bpm: 108, key: '9A', year: 1985, energy: 8 }),
    t({ title: 'H', artist: 'H1', genre: 'Tech House', bpm: 106, key: '8A', year: 2023, energy: 9 }),
    t({ title: 'J', artist: 'J1', genre: 'Jazz', bpm: 102, key: '8A', year: 1960, energy: 3 }),
    t({ title: 'C', artist: 'C1', genre: 'Country', bpm: 98, key: '8A', year: 1995, energy: 5 })
  ];
  const out = engine.suggest(zouk, ailleurs, { limit: 5, arc: 'up', dna: {} });
  verifier('6. aucune famille proche : la liste reste pleine',
           out.length === 5, out.map(r => r.track.genre).join(' | '));
  verifier('6bis. et le moteur classe quand meme',
           new Set(out.map(r => r.total)).size > 1,
           'notes : ' + out.map(r => r.total).join(', '));
}

/* ---------- 7. l'axe est appris, pas impose ---------- */
{
  const { Gout } = require('../src/gout.js');
  const g = new Gout(null);
  verifier('7. la parente fait partie des axes appris',
           Object.prototype.hasOwnProperty.call(g.d.ema, 'pa'));
  g.d.n = 60;
  const p = g.reglages().poids;
  verifier('7bis. et aucun poids appris n\'est NaN',
           Object.keys(p).every(k => typeof p[k] === 'number' && isFinite(p[k])),
           JSON.stringify(p));
}

if (echecs) {
  console.error('\n' + echecs + ' cas de parente en echec.');
  process.exit(1);
}
console.log('\nparente : on reste dans le monde ou on est, sans s\'y enfermer.');
