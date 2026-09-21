'use strict';
/* ============================================================
   SERATO : LE CHEMIN DU FICHIER, ET POURQUOI IL ETAIT FAUX.

   Rapport d'un DJ, capture a l'appui : « 0 titres prets », avec
   DEUX bases Serato correctement detectees juste en dessous —
   C:\Users\...\Music\_Serato_ et D:\_Serato_. Detection bonne,
   lecture vide.

   Serato ecrit ses chemins sans la racine du volume : la base de
   D:\_Serato_ contient « Music/x.mp3 ». Le module rendait donc,
   sur Windows, un chemin RELATIF — aucun fichier ne repondait,
   l'elagage « fichier introuvable » faisait son travail, et la
   bibliotheque tombait a zero.

   Deuxieme consequence, plus sournoise : sans bibliotheque, chaque
   morceau pose sur le deck est annonce « hors bibliotheque ». Le
   DJ croit que la detection du deck est cassee alors que c'est la
   lecture du disque.

   Ce test ne verifie donc pas « le parseur lit des octets » — il
   verifie que le chemin rendu DESIGNE LE FICHIER, sur les quatre
   configurations reelles : Windows disque systeme, Windows second
   disque, macOS disque de demarrage, macOS volume externe.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/serato-db');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(58) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}

console.log('\n- La base Serato -\n');

const MORCEAUX = [
  { path: '/Music/Tracks/one-more-time.mp3', title: 'One More Time', artist: 'Daft Punk',
    genre: 'French Touch', bpm: 123, key: 'Am', len: '05:20', year: 2000 },
  { path: '/Music/Tracks/freed.mp3', title: 'Freed from Desire', artist: 'Gala',
    genre: 'Eurodance', bpm: 126, key: 'Am', len: '04:02', year: 1996 }
];

/* ------------------------------------------------------------
   1. LA RACINE DU VOLUME, DEDUITE DU CHEMIN DE LA BASE.
   ------------------------------------------------------------ */
verifier('Windows, second disque : la racine est D:\\',
  S.racineDuVolume('D:\\_Serato_\\database V2', 'win32') === 'D:\\',
  S.racineDuVolume('D:\\_Serato_\\database V2', 'win32'));
verifier('Windows, disque systeme : la racine est C:\\',
  S.racineDuVolume('C:\\Users\\MARCHAL\\Music\\_Serato_\\database V2', 'win32') === 'C:\\');
verifier('macOS, volume externe : la racine est le point de montage',
  S.racineDuVolume('/Volumes/SSD DJ/_Serato_/database V2', 'darwin') === '/Volumes/SSD DJ');
verifier('macOS, disque de demarrage : pas de racine, donc « / »',
  S.racineDuVolume('/Users/aaron/Music/_Serato_/database V2', 'darwin') === '');

/* ------------------------------------------------------------
   2. LE CHEMIN RENDU, SUR LES QUATRE CONFIGURATIONS.

   On injecte la plateforme et l'existence : ce test doit tomber
   sur la panne de Windows meme en tournant sur Linux, sinon il ne
   sert a rien la ou elle se produit.
   ------------------------------------------------------------ */
const surDisque = new Set([
  'D:\\Music\\Tracks\\one-more-time.mp3',
  'C:\\Users\\MARCHAL\\Music\\Tracks\\one-more-time.mp3',
  '/Volumes/SSD DJ/Music/Tracks/one-more-time.mp3',
  '/Users/aaron/Music/Tracks/one-more-time.mp3'
]);
const existe = x => surDisque.has(x);

const winD = S.resoudre('Music/Tracks/one-more-time.mp3', 'D:\\', { plateforme: 'win32', existe });
verifier('Windows, second disque : le chemin porte la lettre du disque',
  winD === 'D:\\Music\\Tracks\\one-more-time.mp3', winD);

const winC = S.resoudre('Users/MARCHAL/Music/Tracks/one-more-time.mp3', 'C:\\',
                        { plateforme: 'win32', existe });
verifier('Windows, disque systeme : idem',
  winC === 'C:\\Users\\MARCHAL\\Music\\Tracks\\one-more-time.mp3', winC);

const macExt = S.resoudre('Music/Tracks/one-more-time.mp3', '/Volumes/SSD DJ',
                          { plateforme: 'darwin', existe });
verifier('macOS, volume externe : le chemin passe par le point de montage',
  macExt === '/Volumes/SSD DJ/Music/Tracks/one-more-time.mp3', macExt);

const macHome = S.resoudre('Users/aaron/Music/Tracks/one-more-time.mp3', '',
                           { plateforme: 'darwin', existe });
verifier('macOS, disque de demarrage : le chemin repart de la racine',
  macHome === '/Users/aaron/Music/Tracks/one-more-time.mp3', macHome);

/* Un chemin deja absolu ne doit pas etre prefixe une deuxieme fois. */
verifier('un chemin deja absolu reste intact (Windows)',
  S.resoudre('E:\\Sons\\x.mp3', 'D:\\', { plateforme: 'win32', existe }) === 'E:\\Sons\\x.mp3');
verifier('un chemin deja absolu reste intact (macOS)',
  S.resoudre('/Users/aaron/x.mp3', '/Volumes/SSD', { plateforme: 'darwin', existe })
    === '/Users/aaron/x.mp3');

/* Quand DEUX interpretations sont possibles, c'est le disque qui
   tranche — pas une preference ecrite en dur. */
const ambigu = S.resoudre('Users/aaron/Music/Tracks/one-more-time.mp3', '/Volumes/SSD DJ',
                          { plateforme: 'darwin', existe });
verifier('entre deux lectures possibles, on garde celle qui existe',
  ambigu === '/Users/aaron/Music/Tracks/one-more-time.mp3', ambigu);

/* Disque debranche : aucune ne repond. On rend la plus probable
   pour que l'elagage distingue « efface » de « hors ligne ». */
const absent = S.resoudre('Music/Tracks/inconnu.mp3', '/Volumes/SSD DJ',
                          { plateforme: 'darwin', existe });
verifier('disque muet : on rend le chemin du volume, pas un chemin nu',
  absent === '/Volumes/SSD DJ/Music/Tracks/inconnu.mp3', absent);

/* ------------------------------------------------------------
   3. DE BOUT EN BOUT, SUR UN VRAI FICHIER DE BASE.
   ------------------------------------------------------------ */
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-serato-'));
const musique = path.join(racine, 'Music', 'Tracks');
fs.mkdirSync(musique, { recursive: true });
for (const m of MORCEAUX) fs.writeFileSync(path.join(racine, m.path.replace(/^\//, '')), 'x');
const dossierBase = path.join(racine, '_Serato_');
fs.mkdirSync(dossierBase, { recursive: true });
const fichierBase = path.join(dossierBase, 'database V2');
fs.writeFileSync(fichierBase, S.buildTestDatabase(MORCEAUX));

/* On passe la racine a la main : le dossier temporaire n'est pas un
   volume monte, et c'est bien le comportement « volume » qu'on veut
   eprouver. */
const lus = S.parseDatabase(fichierBase, { base: racine });
verifier('la base rend ses deux morceaux', lus.length === 2, String(lus.length));
verifier('et chaque chemin designe un fichier qui existe vraiment',
  lus.every(t => fs.existsSync(t.path)),
  lus.map(t => t.path).join(' | '));
verifier('titre, artiste et tempo sont lus',
  lus[0].title === 'One More Time' && lus[0].artist === 'Daft Punk' && lus[0].bpm === 123,
  JSON.stringify([lus[0].title, lus[0].artist, lus[0].bpm]));
verifier('la tonalite est convertie en Camelot',
  !!lus[0].key && /^\d{1,2}[AB]$/.test(lus[0].key), String(lus[0].key));
verifier('l\'annee est relue', Number(lus[0].year) === 2000, String(lus[0].year));
verifier('la duree est en secondes', lus[0].duration === 320, String(lus[0].duration));

try { fs.rmSync(racine, { recursive: true, force: true }); } catch (e) {}

console.log(ko ? '\n' + ko + ' cas en echec.\n'
               : '\nserato : les chemins designent les fichiers, sur les quatre configurations.\n');
process.exit(ko ? 1 : 0);
