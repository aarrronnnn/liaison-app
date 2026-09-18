'use strict';
/* ============================================================
   Banc — le repertoire du DJ, et ce qui n'en fait pas partie.

   « Certains DJ ont des sons bizarres d'autres pays dans la
     bibliotheque. Ceux-la on va eviter de les proposer. »

   Trois choses a prouver, et la troisieme compte autant que les
   deux premieres :

     1. le corps etranger ne remonte pas quand il y a mieux ;
     2. il remonte quand il n'y a rien d'autre — on relegue, on
        n'ecarte pas ;
     3. la mesure est faite sur SA bibliotheque. Le meme morceau
        doit etre normal chez un DJ et etranger chez un autre,
        sans qu'aucune liste de pays n'existe nulle part.
   ============================================================ */
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const rep = require('../src/repertoire.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(58),
              detail ? '  — ' + detail : '');
}

let n = 0;
const t = (o) => lib.finalize([Object.assign({
  path: '/m/' + (++n) + '.mp3', duration: 220, pop: 60, genre: 'House',
  key: '8A', energy: 6, timbre: [5, 5, 5], analyzed: true, bpm: 128
}, o)])[0];

const nom = x => x.title;

/* ---------- les deux bibliotheques ---------- */
function biblioFrancaise() {
  const out = [];
  for (let i = 0; i < 500; i++)
    out.push(t({ title: 'Titre francais ' + i, artist: 'Artiste ' + i, genre: 'Variete francaise' }));
  return out;
}
const CYRILLIQUE = () => [
  t({ title: 'Дорога сна', artist: 'Мельница', genre: 'Variete francaise' }),
  t({ title: 'Звезда по имени Солнце', artist: 'Кино', genre: 'Variete francaise' })
];

/* ============================================================
   1. L'ECRITURE, reconnue sans liste de langues.
   ============================================================ */
{
  verifier('1. un titre latin est lu comme latin',
           rep.ecritureDe1({ title: 'Alexandrie Alexandra', artist: 'Claude Francois' }) === 'latin');
  verifier('1bis. un titre cyrillique aussi',
           rep.ecritureDe1({ title: 'Дорога сна', artist: 'Мельница' }) === 'cyrillique');
  verifier('1ter. un titre arabe aussi',
           rep.ecritureDe1({ title: 'حبيبي', artist: 'عمرو دياب' }) === 'arabe');
  /* La translitteration entre parentheses ne doit pas faire passer
     un titre russe pour un titre latin. */
  verifier('1quater. la translitteration ne trompe pas',
           rep.ecritureDe1({ title: 'Дорога сна (Doroga sna)', artist: 'Мельница' }) === 'cyrillique',
           rep.ecritureDe1({ title: 'Дорога сна (Doroga sna)', artist: 'Мельница' }));
  /* Et surtout : un titre qu'on ne sait pas lire ne coute RIEN. */
  verifier('1quinquies. sans lettres, on ne conclut rien',
           rep.ecritureDe1({ title: '7', artist: '' }) === null);
}

/* ============================================================
   2. LE CORPS ETRANGER NE REMONTE PAS QUAND IL Y A MIEUX.
   ============================================================ */
{
  const bib = biblioFrancaise().concat(CYRILLIQUE());
  const c = rep.centre(bib);
  const cur = t({ title: 'joue', artist: 'Quelqu un', genre: 'Variete francaise' });
  const R = { centre: c, ouvertes: new Set() };

  verifier('2. le centre de gravite est mesure',
           c.ecritures.get('latin') === 500 && c.ecritures.get('cyrillique') === 2,
           'latin ' + c.ecritures.get('latin') + ', cyrillique ' + c.ecritures.get('cyrillique'));

  const r = engine.suggest(cur, bib, { limit: 5, arc: 'hold', repertoire: R });
  const noms = r.map(x => nom(x.track));
  verifier('2bis. aucun titre cyrillique dans les propositions',
           !noms.some(x => /Дорога|Звезда/.test(x)), noms.slice(0, 3).join(', ') + '…');

  const notes = bib.slice(500).map(x => rep.score(x, c, new Set()));
  verifier('2ter. et leur note de repertoire est basse',
           notes.every(v => v < 40), 'notes : ' + notes.join(', '));
}

/* ============================================================
   3. MAIS ON RELEGUE, ON N'ECARTE PAS.

   C'est la contrepartie obligatoire. A 4 h du matin, quand tout a
   ete joue, une proposition inattendue vaut mieux qu'une liste
   vide — et le DJ lit sur la ligne pourquoi elle est la.
   ============================================================ */
{
  const cyr = CYRILLIQUE();
  const bib = biblioFrancaise();
  const c = rep.centre(bib.concat(cyr));
  const cur = t({ title: 'joue2', artist: 'Quelqu un', genre: 'Variete francaise' });
  const R = { centre: c, ouvertes: new Set() };

  const r = engine.suggest(cur, cyr, { limit: 3, arc: 'hold', repertoire: R });
  verifier('3. seul candidat possible : il sort quand meme',
           r.length === 2, r.map(x => nom(x.track)).join(', '));
  verifier('3bis. et la ligne dit pourquoi il est la',
           r.every(x => x.repertoireDit), r[0] && r[0].repertoireDit);
}

/* ============================================================
   4. LA PORTE S'OUVRE DES QU'IL EN JOUE UN.

   Un DJ qui attaque son bloc oriental a minuit n'a aucun reglage
   a toucher : il lance le premier titre, et Liaison suit.
   ============================================================ */
{
  const cyr = CYRILLIQUE();
  const c = rep.centre(biblioFrancaise().concat(cyr));
  const avant = rep.score(cyr[1], c, new Set());
  const ouvertes = rep.ouvrir(cyr[0], new Set());
  const apres = rep.score(cyr[1], c, ouvertes);
  verifier('4. avant d\'en avoir joue un, il est etranger', avant < 40, 'note ' + avant);
  verifier('4bis. apres, il vaut n\'importe quel autre titre', apres === 100, 'note ' + apres);
}

/* ============================================================
   5. AUCUNE LISTE DE PAYS — LA PREUVE PAR LE MIROIR.

   Le meme morceau, dans une bibliotheque russe, doit etre parfaitement
   normal. Si ce cas passe, c'est qu'il n'y a nulle part de jugement
   sur ce qu'est un morceau « bizarre ».
   ============================================================ */
{
  const russe = [];
  for (let i = 0; i < 500; i++)
    russe.push(t({ title: 'Песня ' + i, artist: 'Исполнитель ' + i, genre: 'Pop' }));
  const intrus = t({ title: 'Alexandrie Alexandra', artist: 'Claude Francois', genre: 'Pop' });
  const c = rep.centre(russe.concat([intrus]));

  verifier('5. chez un DJ russe, le cyrillique est le repertoire',
           rep.score(russe[0], c, new Set()) === 100);
  verifier('5bis. et c\'est la chanson francaise qui est etrangere',
           rep.score(intrus, c, new Set()) < 40, 'note ' + rep.score(intrus, c, new Set()));
}

/* ============================================================
   6. UNE PETITE BIBLIOTHEQUE N'A PAS DE CENTRE DE GRAVITE.

   Sur trente morceaux, deux titres en cyrillique ne sont pas une
   poche oubliee : c'est peut-etre la moitie de ce que le DJ joue.
   L'axe doit se taire plutot que de trancher sur trop peu.
   ============================================================ */
{
  const petite = [];
  for (let i = 0; i < 30; i++) petite.push(t({ title: 'Titre ' + i, artist: 'A' + i }));
  const cyr = CYRILLIQUE();
  const c = rep.centre(petite.concat(cyr));
  verifier('6. sous 300 titres, l\'axe ne juge personne',
           rep.score(cyr[0], c, new Set()) === 100 && rep.raison(cyr[0], c) === null);
}

/* ============================================================
   7. UNE FAMILLE DE GENRE RARE COMPTE AUSSI — moins fort.
   ============================================================ */
{
  const bib = biblioFrancaise();
  const schlager = t({ title: 'Ein Prosit', artist: 'Kapelle', genre: 'Schlager' });
  const c = rep.centre(bib.concat([schlager]));
  const note = rep.score(schlager, c, new Set());
  verifier('7. un genre isole est relegue, plus doucement',
           note < 100 && note > 40, 'note ' + note);
  verifier('7bis. et la raison le nomme',
           /rare chez toi/.test(String(rep.raison(schlager, c))), rep.raison(schlager, c));
}

if (echecs) {
  console.error('\n' + echecs + ' cas de repertoire en echec.');
  process.exit(1);
}
console.log('\nrepertoire : mesure sur SA bibliotheque, relegue sans jamais ecarter.');
