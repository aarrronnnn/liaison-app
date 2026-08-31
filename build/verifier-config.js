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
    console.log('Configuration electron-builder valide.');
    process.exit(0);
  } catch (e) {
    console.log('CONFIGURATION REFUSEE PAR ELECTRON-BUILDER :\n');
    console.log(String(e.message).split('\n').slice(0, 10).join('\n'));
    process.exit(1);
  }
})();
