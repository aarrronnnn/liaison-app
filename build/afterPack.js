'use strict';
/* ============================================================
   Ce qui se passe juste apres l'empaquetage.

   Deux choses, dans cet ordre : on verrouille le binaire
   Electron, puis on signe l'application sur macOS.

   ------------------------------------------------------------
   Le verrouillage — pourquoi il compte

   Une application Electron non verrouillee peut etre relancee en
   simple interpreteur Node par une variable d'environnement :

       ELECTRON_RUN_AS_NODE=1 ./Liaison

   A partir de la, n'importe qui lit le code source, extrait
   l'archive, contourne la verification de licence et repackage
   le tout. Ce n'est pas theorique : c'est la premiere chose que
   fait quelqu'un qui veut copier une application Electron, et ca
   tient en une ligne de terminal.

   Les « fuses » d'Electron sont des interrupteurs graves DANS le
   binaire, apres compilation. Une fois coupes, ils ne peuvent pas
   etre rallumes par une variable d'environnement ni par un
   argument de ligne de commande — il faudrait modifier le binaire,
   ce qui casse sa signature.

   On coupe les quatre qui ouvrent la porte :
     RunAsNode                          — le mode interpreteur
     EnableNodeOptionsEnvironmentVariable — l'injection de code au demarrage
     EnableNodeCliInspectArguments      — le debogueur a distance
   et on impose :
     OnlyLoadAppFromAsar                — l'app ne peut plus etre
                                          remplacee par un dossier
                                          de fichiers a cote

   Ce n'est pas de l'inviolable : rien ne l'est cote client, et
   pretendre le contraire serait mentir. C'est le passage de
   « une ligne de commande » a « il faut savoir ce qu'on fait,
   patcher un binaire et casser sa signature ». Ca suffit a
   ecarter la copie opportuniste, qui est l'essentiel du risque.
   ============================================================ */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function afterPack(context) {
  const nom = context.packager.appInfo.productFilename;
  const plat = context.electronPlatformName;

  /* ---------- 1. les fusibles ---------- */
  try {
    const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
    /* Le nom du binaire n'est pas le meme partout : « Liaison.app »
       sur macOS, « Liaison.exe » sur Windows, et sur Linux c'est
       le nom du paquet en minuscules. On essaie donc plusieurs
       candidats plutot que d'en supposer un — la premiere version
       de ce fichier ne trouvait rien sous Linux et se contentait
       de le murmurer. */
    const bas = require('../package.json').name;
    const candidats = plat === 'darwin' ? [nom + '.app']
      : plat === 'win32' ? [nom + '.exe', bas + '.exe']
      : [nom, bas, nom.toLowerCase()];
    const cible = candidats.map(c => path.join(context.appOutDir, c)).find(p => fs.existsSync(p));
    if (cible) {
      await flipFuses(cible, {
        version: FuseVersion.V1,
        resetAdHocDarwinSignature: plat === 'darwin',
        [FuseV1Options.RunAsNode]: false,
        [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
        [FuseV1Options.EnableNodeCliInspectArguments]: false,
        [FuseV1Options.OnlyLoadAppFromAsar]: true
      });
      console.log('afterPack : fusibles coupes sur ' + cible);
    } else {
      console.warn('afterPack : binaire introuvable pour les fusibles — essaye ' + candidats.join(', '));
    }
  } catch (e) {
    /* Un empaquetage qui reussit sans verrouillage vaut mieux
       qu'un empaquetage qui echoue : on le signale, fort. */
    console.warn('afterPack : FUSIBLES NON APPLIQUES — ' + e.message);
  }

  /* ---------- 2. la signature ad hoc, sur macOS ----------
     Sur Apple Silicon, un binaire non signe du tout est refuse par
     le systeme. Une signature locale suffit a le rendre lancable.
     Elle vient APRES les fusibles, qui modifient le binaire et
     invalideraient une signature posee avant. */
  if (plat !== 'darwin') return;
  const app = path.join(context.appOutDir, nom + '.app');
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    console.log('afterPack : signature ad hoc appliquee a ' + app);
  } catch (e) {
    console.warn('afterPack : signature ad hoc impossible (' + e.message + ')');
  }
};
