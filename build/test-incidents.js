'use strict';
/* ============================================================
   CE QUI PART DE LA MACHINE — ET CE QUI N'EN PART PAS.

   Un rapport de panne est la seule chose que Liaison envoie
   spontanement. Tout l'argument du produit est que rien ne quitte
   l'ordinateur du DJ : si une seule de ces regles casse, ce n'est
   pas un bug d'affichage, c'est la promesse qui tombe.

   Ce fichier eprouve donc l'anonymisation comme on eprouve une
   serrure : avec les cas qui la forcent, pas avec ceux qui
   l'arrangent. Les traces ci-dessous sont copiees de vraies
   piles d'appel — chemins macOS, chemins Windows, bases de
   rekordbox, noms de fichiers avec espaces et accents.
   ============================================================ */
const os = require('os');
const I = require('../src/incidents.js');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(56) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}
/* Le nom ne doit apparaitre NULLE PART dans le resultat. */
function sans(texte, interdit) { return String(texte).indexOf(interdit) < 0; }

console.log('ce qui part de la machine\n');

/* ---------- le dossier personnel ---------- */
{
  const vrai = os.homedir;
  os.homedir = () => '/Users/marie-claire';
  const t = I.anonymiser('at Object.<anonymous> (/Users/marie-claire/Projets/x.js:12:9)');
  os.homedir = vrai;
  verifier('le dossier personnel disparait', sans(t, 'marie-claire'), t);
  verifier('et il reste quelque chose d\'utile', /x\.js/.test(t), t);
}

/* Meme sans homedir() — une trace peut venir d'un autre compte
   ou d'un processus fils qui n'a pas le meme environnement. */
{
  const vrai = os.homedir;
  os.homedir = () => '';
  verifier('prenom macOS retire meme sans homedir',
           sans(I.anonymiser('/Users/aarondmy/Music/base.db'), 'aarondmy'));
  verifier('prenom Linux retire meme sans homedir',
           sans(I.anonymiser('/home/sofia/.config/liaison'), 'sofia'));
  verifier('prenom Windows retire meme sans homedir',
           sans(I.anonymiser('C:\\Users\\Jean-Luc\\AppData\\x'), 'Jean-Luc'));
  os.homedir = vrai;
}

/* ---------- la bibliotheque du DJ ---------- */
{
  const cas = [
    ['/Volumes/USB/Sets/Bella Ciao - Hugel.mp3', 'Bella Ciao'],
    ['D:\\Musique\\Aya Nakamura - Djadja.flac', 'Djadja'],
    ['/Users/x/Music/rekordbox/master.db', 'master.db'],
    ['~/Music/Serato/database V2', 'database V2']
  ];
  for (const [entree, secret] of cas) {
    const t = I.anonymiser(entree);
    verifier('« ' + secret + ' » ne sort pas', sans(t, secret), t);
  }
}

/* ---------- ce qui identifie ---------- */
{
  verifier('une adresse e-mail est masquee',
           sans(I.anonymiser('echec pour aaron@exemple.fr'), 'aaron@exemple.fr'));
  verifier('une cle de licence est masquee',
           sans(I.anonymiser('cle LSN-4F2A-9C1B-77DE refusee'), 'LSN-4F2A-9C1B-77DE'));
  verifier('une adresse IP est masquee',
           sans(I.anonymiser('connexion a 192.168.1.42 perdue'), '192.168.1.42'));
}

/* ---------- ce qu'on GARDE : sans ca le rapport ne sert a rien ---------- */
{
  const t = I.anonymiser('TypeError: x is not a function\n    at lireBase (/app/src/library.js:88:5)');
  verifier('le module de Liaison reste lisible', /library\.js/.test(t), t);
  verifier('le message d\'erreur reste lisible', /TypeError/.test(t), t);
}

/* ---------- la ceinture apres les bretelles ---------- */
{
  verifier('propre() refuse un chemin personnel restant',
           I.propre('/Users/marie/x') === false);
  verifier('propre() refuse un fichier audio restant',
           I.propre('lecture de truc.mp3') === false);
  verifier('propre() accepte une trace nettoyee',
           I.propre('at lireBase (~/app/src/library.js)') === true);
}

/* ------------------------------------------------------------
   LA PROPRIETE QUI COMPTE VRAIMENT.

   batir() est le SEUL chemin par lequel un rapport est fabrique.
   Sa garantie : quoi qu'on lui donne, il rend soit `null`, soit
   un rapport dont la trace ne contient aucun des secrets et
   passe propre(). Pas « il rend null sur tel cas » — cette
   formulation-la testait un bug plutot qu'une regle, et elle est
   devenue fausse le jour ou l'anonymisation s'est mise a bien
   marcher.

   On lui jette donc une brassee de piles hostiles et on verifie
   l'invariant sur chacune.
   ------------------------------------------------------------ */
{
  const HOSTILES = [
    ['au secours /Users/ghost/secret.mp3',                         ['ghost', 'secret']],
    ['ENOENT: /Volumes/Disque de Léa/Sets/Petit Biscuit - Sunset Lover.aiff', ['Léa', 'Sunset Lover']],
    ['C:\\Users\\Jean Dupont\\Musique\\Stromae - Alors On Danse.flac', ['Jean Dupont', 'Alors On Danse']],
    ['at lire (/home/tatiana/.config/liaison/license.json:4:1)',   ['tatiana']],
    ['echec pour contact@djlea.fr avec LSN-9A8B-7C6D-5E4F',        ['contact@djlea.fr', 'LSN-9A8B']],
    ['socket vers 10.0.0.7 fermee',                                ['10.0.0.7']]
  ];
  const vrai = os.homedir;
  os.homedir = () => '';          /* on neutralise le premier filet, expres */
  let tousOk = true, faute = '';
  for (const [pile, secrets] of HOSTILES) {
    const r = I.batir('exception non attrapee', { stack: pile }, '1.5.0', 'darwin');
    if (r === null) continue;                       /* refuser est une reponse valable */
    if (!I.propre(r.trace)) { tousOk = false; faute = 'propre() faux : ' + r.trace; break; }
    for (const sec of secrets) {
      if (!sans(r.trace, sec)) { tousOk = false; faute = '« ' + sec +' » dans : ' + r.trace; break; }
    }
    if (!tousOk) break;
  }
  os.homedir = vrai;
  verifier('batir() : soit null, soit un rapport sans aucun secret', tousOk, faute);
}

/* ---------- la signature : reconnaitre la meme panne ---------- */
{
  const a = I.signature('exception', 'Error: x\n  at f (a.js:10:2)\n  at g (b.js:20:1)');
  const b = I.signature('exception', 'Error: x\n  at f (a.js:14:9)\n  at g (b.js:22:3)');
  const c = I.signature('exception', 'Error: AUTRE\n  at h (z.js:1:1)');
  verifier('deux lignes decalees = la meme panne', a === b, a + ' / ' + b);
  verifier('une autre panne = une autre signature', a !== c, a + ' / ' + c);
}

/* ---------- la file ---------- */
{
  const fs = require('fs'); const path = require('path');
  const ecrire = require('../src/ecrire.js');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-inc-'));
  const un = I.batir('exception non attrapee', new Error('boum'), '1.5.0', 'darwin');
  I.empiler(ecrire, d, un);
  I.empiler(ecrire, d, un);
  I.empiler(ecrire, d, un);
  const f = I.lire(ecrire, d);
  verifier('la meme panne trois fois = une entree', f.length === 1, String(f.length));
  verifier('et elle dit « trois fois »', f[0] && f[0].n === 3, f[0] && String(f[0].n));

  for (let i = 0; i < 40; i++) {
    I.empiler(ecrire, d, I.batir('panne ' + i, new Error('e' + i), '1.5.0', 'darwin'));
  }
  verifier('la file est plafonnee', I.lire(ecrire, d).length <= I.FILE_MAX,
           String(I.lire(ecrire, d).length));
  I.vider(ecrire, d);
  verifier('et elle se vide', I.lire(ecrire, d).length === 0);
  fs.rmSync(d, { recursive: true, force: true });
}

/* ---------- aucun identifiant de machine, jamais ---------- */
{
  const r = I.batir('exception non attrapee', new Error('boum'), '1.5.0', 'darwin');
  const champs = Object.keys(r).sort().join(',');
  verifier('le rapport ne porte que les champs prevus',
           champs === 'n,os,quoi,sig,trace,v,vu', champs);
}

console.log(ko ? '\n' + ko + ' cas en echec — NE PAS PUBLIER.'
               : '\nincidents : rien qui designe quelqu\'un ne sort de la machine.');
process.exit(ko ? 1 : 0);
