'use strict';
/* ============================================================
   Le morceau affiche avec un train de retard.

   Signale en cabine : « des que je passe au morceau suivant, le
   widget me donne celui d'avant, et me propose des enchainements
   pour un titre qui ne tourne plus ».

   Ce n'etait pas un hasard, c'etait la regle de selection.

   Sur Mac sans materiel, Liaison deduit le morceau charge des
   FICHIERS que rekordbox tient ouverts. Plusieurs peuvent l'etre
   en meme temps : rekordbox ne referme pas immediatement celui du
   morceau precedent. Il fallait donc departager, et la regle
   disait « le plus stable gagne » — celui vu le plus grand nombre
   de fois. Or le morceau precedent est ouvert depuis des minutes,
   le nouveau depuis trois secondes. L'ancien gagnait toujours.

   La stabilite doit servir de PORTE — ecarter les apercus de
   navigation, qui ne durent pas deux relevés — et non de
   classement. Une fois la porte franchie, c'est le dernier arrive
   qui tourne.

   Ce fichier rejoue la sequence sans rekordbox : on simule les
   listes de fichiers ouverts, relevé par relevé.
   ============================================================ */

const CONFIRMATIONS = 2;

/* La regle corrigee, isolee pour pouvoir la jouer seule.
   Elle reproduit exactement ce que fait sources/rekordbox.js. */
function lecteur() {
  const vus = new Map(), apparu = new Map();
  let horloge = 0, courant = null;
  return function relevé(ouverts) {
    const presents = new Set(ouverts);
    for (const k of Array.from(vus.keys()))
      if (!presents.has(k)) { vus.delete(k); apparu.delete(k); }
    for (const p of ouverts) {
      vus.set(p, (vus.get(p) || 0) + 1);
      if (!apparu.has(p)) apparu.set(p, ++horloge);
    }
    let best = null, bv = -1;
    for (const p of ouverts) {
      if ((vus.get(p) || 0) < CONFIRMATIONS) continue;
      const ne = apparu.get(p) || 0;
      if (ne > bv) { bv = ne; best = p; }
    }
    if (best && best !== courant) courant = best;
    return courant;
  };
}

let echecs = 0;
function verifier(quoi, obtenu, attendu) {
  const ok = obtenu === attendu;
  if (!ok) echecs++;
  console.log('  %s %s  affiche : %s', ok ? 'ok  ' : 'RATE',
              quoi.padEnd(50), obtenu === null ? '(rien)' : obtenu);
}

/* ---------- la sequence d'une vraie soiree ---------- */
const lire = lecteur();

/* Le premier morceau est charge. Un seul relevé ne suffit pas :
   c'est voulu, un apercu de navigation ne doit pas passer. */
verifier('1er relevé : un seul passage, on attend', lire(['A.mp3']), null);
verifier('2e relevé : confirme, A s\'affiche', lire(['A.mp3']), 'A.mp3');

/* Il navigue dans sa bibliotheque : rekordbox ouvre brievement un
   fichier pour l'apercu. Il ne doit pas voler l'affichage. */
verifier('apercu fugace pendant la navigation', lire(['A.mp3', 'apercu.mp3']), 'A.mp3');
verifier('l\'apercu se referme, rien ne bouge', lire(['A.mp3']), 'A.mp3');

/* Il charge B sur l'autre deck. rekordbox garde A ouvert : c'est
   la situation exacte qui produisait le decalage. */
verifier('B charge, A encore ouvert : on attend', lire(['A.mp3', 'B.mp3']), 'A.mp3');
verifier('B confirme : c\'est B qui tourne', lire(['A.mp3', 'B.mp3']), 'B.mp3');

/* A finit par se refermer : rien ne doit sauter en arriere. */
verifier('A se referme, B reste', lire(['B.mp3']), 'B.mp3');

/* Morceau suivant, meme scenario. */
verifier('C charge, B encore ouvert', lire(['B.mp3', 'C.mp3']), 'B.mp3');
verifier('C confirme : c\'est C', lire(['B.mp3', 'C.mp3']), 'C.mp3');

/* ---------- l'ancienne regle, pour memoire ----------
   « le plus stable gagne » : on verifie qu'elle echouait bien,
   sinon ce test ne prouverait rien. */
function ancienLecteur() {
  const vus = new Map();
  let courant = null;
  return function (ouverts) {
    const presents = new Set(ouverts);
    for (const k of Array.from(vus.keys())) if (!presents.has(k)) vus.delete(k);
    for (const p of ouverts) vus.set(p, (vus.get(p) || 0) + 1);
    let best = null, bs = -1;
    for (const p of ouverts) {
      const n = vus.get(p) || 0;
      if (n >= CONFIRMATIONS && n > bs) { bs = n; best = p; }
    }
    if (best && best !== courant) courant = best;
    return courant;
  };
}
const vieux = ancienLecteur();
['A.mp3'], vieux(['A.mp3']); vieux(['A.mp3']);
vieux(['A.mp3', 'B.mp3']);
const bloque = vieux(['A.mp3', 'B.mp3']);
console.log('\n  temoin — ancienne regle, apres avoir charge B : %s', bloque);
if (bloque !== 'A.mp3') {
  echecs++;
  console.error('  RATE le temoin ne reproduit plus le defaut : ce test ne prouve rien.');
}

if (echecs) {
  console.error('\n' + echecs + ' cas en echec.');
  process.exit(1);
}
console.log('\nrekordbox : le morceau affiche est celui qui vient d\'etre charge.');
