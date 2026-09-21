'use strict';
/* ============================================================
   Valider la configuration d'electron-builder SANS construire.

   Cout de l'oubli, mesure : une clef de commentaire ajoutee dans
   « build.mac » a fait echouer les TROIS jobs — mac arm64, mac x64
   et Windows — au bout de deux minutes de runner chacun, pour une
   erreur que la meme validation attrape ici en trente
   millisecondes, hors ligne.

   electron-builder refuse toute propriete inconnue. C'est une
   bonne chose : ca evite qu'une option mal orthographiee soit
   ignoree en silence. Mais ca veut dire qu'une configuration
   invalide ne se voit qu'a la construction — sauf si on la
   verifie, ce que fait ce fichier.

       node build/verifier-config.js
   ============================================================ */
const path = require('path');

(async () => {
  let validateConfig;
  try {
    ({ validateConfig } = require('app-builder-lib/out/util/config.js'));
  } catch (e) {
    console.log('app-builder-lib introuvable — controle ignore (npm ci pas encore passe ?)');
    process.exit(0);
  }
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  if (!pkg.build) { console.log('aucun champ "build" dans package.json'); process.exit(1); }

  const journal = { log: () => {}, info: () => {}, debug: () => {},
                    warn: m => console.log('  avertissement : ' + m),
                    error: m => console.log('  erreur : ' + m) };
  try {
    await validateConfig(JSON.parse(JSON.stringify(pkg.build)), journal);
  } catch (e) {
    console.log('CONFIGURATION REFUSEE PAR ELECTRON-BUILDER :\n');
    console.log(String(e.message).split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }

  /* ------------------------------------------------------------
     La configuration peut etre valide ET avoir perdu le garde-fou
     qui compte. electron-builder ne dira rien si « include » pointe
     un fichier absent : il se contentera de ne pas l'inclure, et
     l'installateur Windows repartira sans fermer l'application en
     cours — la panne exacte du premier acheteur. On verifie donc
     que le fichier existe, et qu'il contient encore la fermeture.
     ------------------------------------------------------------ */
  const fs = require('fs');
  const nsis = pkg.build.nsis || {};
  const nom = nsis.include || 'installer.nsh';
  const chemin = fs.existsSync(path.join(__dirname, nom))
    ? path.join(__dirname, nom)
    : path.join(__dirname, '..', nom);
  const manques = [];
  if (!fs.existsSync(chemin)) {
    manques.push('build.nsis.include pointe « ' + nom + ' » — fichier introuvable');
  } else {
    const nsh = fs.readFileSync(chemin, 'utf8');
    if (!/!macro\s+customInit/.test(nsh)) manques.push('customInit absent de ' + nom);
    if (!/taskkill[^\n]*Liaison\.exe/i.test(nsh)) {
      manques.push('la fermeture de Liaison.exe avant installation a disparu de ' + nom);
    }
  }
  if (nsis.oneClick !== true) manques.push('build.nsis.oneClick devrait rester true');
  if (nsis.deleteAppDataOnUninstall === true) {
    manques.push('deleteAppDataOnUninstall effacerait les reglages et le journal de soirees');
  }

  if (manques.length) {
    console.log('INSTALLATEUR WINDOWS : garde-fou manquant\n');
    for (const m of manques) console.log('  — ' + m);
    process.exit(1);
  }

  try {
    console.log('Configuration electron-builder valide, installateur Windows arme.');
    process.exit(0);
  } catch (e) {
    console.log('CONFIGURATION REFUSEE PAR ELECTRON-BUILDER :\n');
    console.log(String(e.message).split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }
})();
