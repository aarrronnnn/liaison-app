'use strict';
/* ============================================================
   Ecrire un fichier sans jamais pouvoir le perdre.

   fs.writeFileSync tronque le fichier a zero AVANT d'ecrire le
   nouveau contenu. Entre les deux, le fichier existe et il est
   vide. Une coupure de courant, une batterie a plat ou un kill -9
   pendant ces quelques millisecondes, et il ne reste rien.

   Ce n'est pas theorique ici : sets.json est reecrit a chaque
   morceau joue, soit une quinzaine de fois par heure toute la
   nuit ; config.json contient les listes du client saisies a la
   main ; license.json contient la licence achetee. Les trois
   partaient en fumee de la meme facon — et pire : au relancement,
   le chargement echoue silencieusement, rend un objet vide, puis
   la premiere ecriture suivante ecrase definitivement ce qui
   restait.

   On ecrit donc a cote, on force sur le disque, puis on renomme.
   Le renommage est atomique sur les systemes de fichiers qu'on
   vise : a tout instant, le fichier final est soit l'ancien
   complet, soit le nouveau complet. Jamais un fichier vide.
   ============================================================ */
const fs = require('fs');
const path = require('path');

/**
 * @param {string} file    le chemin final
 * @param {string} contenu le texte a ecrire
 * @returns {boolean}      vrai si le fichier est en place
 */
function ecrireSur(file, contenu) {
  const tmp = file + '.tmp';
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    /* Une copie de la version precedente, avant de la remplacer.
       Le renommage protege de la coupure de courant ; il ne protege
       de rien si le fichier a ete abime autrement — secteur illisible,
       disque plein a moitie d'une ecriture d'un autre programme, ou
       simplement quelqu'un qui l'ouvre dans un editeur. Dans ces cas,
       la lecture echoue, l'appelant repart d'un objet vide, et la
       premiere ecriture suivante detruit ce qui restait. Une copie
       coute une milliseconde et rattrape toute cette famille. */
    try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch (e) {}
    /* fsync avant le renommage : sans lui, le systeme peut avoir
       renomme un fichier dont le contenu n'a pas encore touche le
       disque — on aurait echange un fichier vide contre un autre. */
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, contenu);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    return true;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) {}
    return false;
  }
}

/** Meme chose, pour un objet a serialiser. */
function ecrireJSON(file, objet, indent) {
  let texte;
  try { texte = JSON.stringify(objet, null, indent == null ? 1 : indent); }
  catch (e) { return false; }          /* cycle, BigInt : on n'ecrase rien */
  return ecrireSur(file, texte);
}

/**
 * Relit un JSON ecrit par ecrireJSON. Si le fichier principal est
 * illisible, la copie de secours prend le relais — et elle est
 * aussitot remise en place, pour que la prochaine ecriture ne
 * reparte pas de rien.
 *
 * @param {string} file    le chemin
 * @param {*}      defaut  ce qu'on rend si tout a echoue
 */
function lireJSON(file, defaut) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  try {
    const sauve = JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
    try { fs.copyFileSync(file + '.bak', file); } catch (e) {}
    return sauve;
  } catch (e) {}
  return defaut;
}

module.exports = { ecrireSur, ecrireJSON, lireJSON };
