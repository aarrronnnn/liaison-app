'use strict';
/* ============================================================
   QU'EST-CE QUI COMPTE COMME UNE SOIREE ?

   Depuis que l'essai se compte en soirees, cette definition
   DECIDE quand un client se met a payer. Elle merite donc d'etre
   eprouvee comme une regle de facturation, pas comme un detail.

   Le defaut qu'elle corrige : on comptait le nombre de sessions
   OUVERTES. Or une session s'ouvre toute seule des qu'un morceau
   est detecte sur un deck. Brancher son controleur cinq minutes
   un mardi pour verifier que Liaison capte, c'etait une soiree.
   Le DJ de mariage arrivait au bout de son essai en ayant « joue
   trois soirees » sans avoir jamais ouvert l'app en cabine.

   Les deux seuils — 8 titres ET 45 minutes — sont le seul
   reglage de ce mecanisme. Ils sont volontairement genereux : en
   cas de doute, mieux vaut offrir une soiree de trop que fermer
   la porte a quelqu'un qui n'a pas encore pu juger.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { SetLog, SOIREE_TITRES, SOIREE_MINUTES } = require('../src/session.js');

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-soirees-'));
const FIC = path.join(racine, 'sets.json');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(54) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}

const MIN = 60000;

/* Fabrique une session de n titres etales sur `minutes`. On ecrit
   directement dans le journal plutot que de passer par play() :
   play() horodate avec Date.now(), et on veut choisir la duree. */
function poser(log, nom, n, minutes) {
  const t0 = Date.now() - 30 * 24 * 3600 * 1000;   /* il y a un mois */
  const pas = n > 1 ? (minutes * MIN) / (n - 1) : 0;
  const played = [];
  for (let i = 0; i < n; i++) {
    played.push({ id: 1000 + i, title: 'T' + i, artist: 'A', bpm: 128, key: '8A',
                  energy: 7, tags: [], at: Math.round(t0 + i * pas), transition: null });
  }
  log.sets.unshift({ id: Date.now() + Math.random(), name: nom, pack: null,
                     at: new Date(t0).toISOString(), played: played });
}

console.log('une vraie soiree : ' + SOIREE_TITRES + ' titres ET ' + SOIREE_MINUTES + ' minutes\n');

{
  const log = new SetLog(FIC);
  log.sets = [];
  verifier('journal vide : aucune soiree', log.soireesJouees() === 0, String(log.soireesJouees()));
}

/* ---------- ce qui NE compte pas ---------- */
{
  const log = new SetLog(FIC); log.sets = [];
  poser(log, 'branchement du mardi', 3, 5);
  verifier('3 titres en 5 min : ce n\'est pas une soiree',
           log.soireesJouees() === 0, String(log.soireesJouees()));

  log.sets = [];
  poser(log, 'playlist qui tourne', 4, 180);
  verifier('4 titres en 3 h : la duree seule ne suffit pas',
           log.soireesJouees() === 0, String(log.soireesJouees()));

  log.sets = [];
  poser(log, 'on charge pour ecouter', 12, 10);
  verifier('12 titres en 10 min : le nombre seul ne suffit pas',
           log.soireesJouees() === 0, String(log.soireesJouees()));
}

/* ---------- ce qui compte ---------- */
{
  const log = new SetLog(FIC); log.sets = [];
  poser(log, 'mariage', 40, 240);
  verifier('40 titres en 4 h : une soiree', log.soireesJouees() === 1, String(log.soireesJouees()));

  log.sets = [];
  poser(log, 'pile au seuil', SOIREE_TITRES, SOIREE_MINUTES);
  verifier('pile aux deux seuils : ca compte (le seuil est inclusif)',
           log.soireesJouees() === 1, String(log.soireesJouees()));

  log.sets = [];
  poser(log, 'juste en dessous', SOIREE_TITRES - 1, SOIREE_MINUTES + 30);
  verifier('un titre de moins : ca ne compte pas',
           log.soireesJouees() === 0, String(log.soireesJouees()));

  log.sets = [];
  poser(log, 'trop court d\'une minute', SOIREE_TITRES + 5, SOIREE_MINUTES - 1);
  verifier('une minute de moins : ca ne compte pas',
           log.soireesJouees() === 0, String(log.soireesJouees()));
}

/* ---------- le cas qui motive tout ---------- */
{
  const log = new SetLog(FIC); log.sets = [];
  poser(log, 'essai salon 1', 4, 12);
  poser(log, 'essai salon 2', 6, 20);
  poser(log, 'essai salon 3', 2, 3);
  verifier('trois essais a la maison ne valent pas une soiree',
           log.soireesJouees() === 0, log.soireesJouees() + ' compte(s) sur 3 sessions');

  poser(log, 'le vrai mariage', 35, 200);
  verifier('la vraie soiree, elle, compte',
           log.soireesJouees() === 1, String(log.soireesJouees()));
}

/* ---------- un journal abime ne doit pas jeter ---------- */
{
  const log = new SetLog(FIC);
  log.sets = [{ id: 1, name: 'casse', at: null, played: null }];
  let jete = false;
  try { log.soireesJouees(); } catch (e) { jete = true; }
  verifier('un set sans titres ne fait pas tomber le compte', !jete);
}

fs.rmSync(racine, { recursive: true, force: true });
console.log(ko ? '\n' + ko + ' cas en echec.' : '\nsoirees : la definition tient.');
process.exit(ko ? 1 : 0);
