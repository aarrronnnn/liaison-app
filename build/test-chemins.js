'use strict';
/* ============================================================
   Le meme fichier, ecrit de six facons.

   Pour savoir que « le fichier que rekordbox tient ouvert » est
   « ce morceau de la bibliotheque », Liaison compare des chemins.
   Chaque logiciel les ecrit a sa maniere, et une seule difference
   suffit a rendre un morceau invisible — sans message, sans
   erreur : le widget reste « en attente » pour toujours.

   Le piege le plus couteux, et celui qui a motive ce fichier :
   LES ACCENTS. macOS ecrit les noms de fichiers en Unicode
   decompose — le « é » de « Café » y est un « e » suivi d'un
   accent combinant. rekordbox et iTunes stockent la forme
   composee, un seul caractere. Les deux s'affichent « Café » et
   sont differents octet pour octet.

   Sur une bibliotheque francaise, ou rangee par iTunes — qui
   construit ses dossiers a partir des noms d'artistes — ca rend
   une grosse part du catalogue introuvable.
   ============================================================ */
const lib = require('../src/library.js');

const REF = '/Users/dj/Music/Music/Media/Music/Café Bleu/Éte 96.mp3';

/* Les ecritures rencontrees pour de vrai, toutes censees designer
   le meme fichier que REF. */
const memeFichier = [
  ['forme decomposee, telle que macOS l\'ecrit sur le disque',
   REF.normalize('NFD')],
  ['forme composee, telle que rekordbox et iTunes la stockent',
   REF.normalize('NFC')],
  ['majuscules et minuscules melangees',
   REF.toUpperCase()],
  ['adresse file:// avec caracteres encodes',
   'file://' + encodeURI(REF)],
  ['separateur « /: » de rekordbox',
   REF.replace(/\//g, '/:')],
  ['volume systeme, tel que le rapporte macOS depuis Catalina',
   '/System/Volumes/Data' + REF],
  ['double barre oblique',
   REF.replace('/Music/', '//Music//')],
];

/* Et ceux qui ne doivent surtout PAS etre confondus. */
const autresFichiers = [
  ['un autre morceau du meme dossier', '/Users/dj/Music/Music/Media/Music/Café Bleu/Éte 97.mp3'],
  ['le meme nom dans un autre dossier', '/Users/dj/Desktop/Éte 96.mp3'],
  ['un dossier different malgre l\'accent', '/Users/dj/Music/Music/Media/Music/Cafe Bleu/Éte 96.mp3'],
];

let echecs = 0;
const cle = lib.cleChemin(REF);
console.log('reference : ' + REF + '\n');

for (const [quoi, variante] of memeFichier) {
  const ok = lib.cleChemin(variante) === cle;
  if (!ok) echecs++;
  console.log('  %s %s', ok ? 'ok  ' : 'RATE', quoi);
}
console.log('');
for (const [quoi, autre] of autresFichiers) {
  const ok = lib.cleChemin(autre) !== cle;
  if (!ok) echecs++;
  console.log('  %s %s : bien distingue', ok ? 'ok  ' : 'RATE', quoi);
}

/* ---------- le temoin ----------
   Sans la mise en forme composee, les deux premieres ecritures
   divergent. On le verifie, sinon ce test ne prouverait rien. */
const sansNormalisation = p => String(p).replace(/\/:/g, '/').replace(/\/+/g, '/').toLowerCase();
const divergeAvant = sansNormalisation(REF.normalize('NFD')) !== sansNormalisation(REF.normalize('NFC'));
console.log('\n  temoin — sans la correction, decompose et compose divergent : %s',
            divergeAvant ? 'oui (le defaut est bien reproduit)' : 'NON');
if (!divergeAvant) echecs++;

if (echecs) {
  console.error('\n' + echecs + ' cas de chemin en echec.');
  process.exit(1);
}
console.log('\nchemins : les six ecritures d\'un meme fichier se rejoignent.');
