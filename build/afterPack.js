'use strict';
/* Signature ad hoc : sur Apple Silicon, un binaire non signe du tout est
   refuse par le systeme. Une signature locale suffit a le rendre lancable
   (l'utilisateur devra quand meme confirmer la premiere ouverture). */
const { execFileSync } = require('child_process');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    console.log('afterPack : signature ad hoc appliquee a ' + app);
  } catch (e) {
    console.warn('afterPack : signature ad hoc impossible (' + e.message + ')');
  }
};
