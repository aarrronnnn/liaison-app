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

/* ------------------------------------------------------------
   UNE ECRITURE QUI RATE SE FAIT ENTENDRE.

   ecrireSur() ne jette jamais : il rend faux. Et presque personne
   ne regardait ce faux. Sur un dossier en lecture seule, un disque
   plein ou un fichier que OneDrive verrouille, rien n'etait garde de
   toute la nuit — journal, listes du client, apprentissage — sans
   un mot (audit du 5 octobre 2026).

   main.js s'abonne ici une fois, et dit la panne au DJ. Une seule
   fois par fichier tant que la panne dure : l'ecriture suivante qui
   reussit rearme le signal.
   ------------------------------------------------------------ */
let ecoute = null;
const signales = new Set();
function surEchec(fn) { ecoute = typeof fn === 'function' ? fn : null; }
function signaler(file, err) {
  if (signales.has(file)) return;
  signales.add(file);
  if (ecoute) { try { ecoute(file, err); } catch (e) {} }
}

/* ------------------------------------------------------------
   Le fichier en place est-il entier ? Seul un fichier entier merite
   de devenir la copie de secours.

   La copie se faisait sans regarder : un principal tronque ou
   rempli de zeros ecrasait la seule copie saine, juste avant que
   l'appelant — reparti d'un objet vide — ne reecrive par-dessus.
   Tout etait perdu en deux temps. On ne fait la copie que d'un
   fichier qui se relit.
   ------------------------------------------------------------ */
function entier(file, verifier) {
  if (typeof verifier !== 'function') return true;
  let texte;
  try { texte = fs.readFileSync(file, 'utf8'); } catch (e) { return false; }
  try { return !!verifier(texte); } catch (e) { return false; }
}
function jsonEntier(texte) {
  if (!texte || !texte.trim()) return false;
  JSON.parse(texte);
  return true;
}

/**
 * @param {string} file    le chemin final
 * @param {string} contenu le texte a ecrire
 * @param {{copie?:boolean, verifier?:Function}} [opt]
 *   copie : false pour un cache (pas de copie de secours) ;
 *   verifier : dit si le fichier en place est entier avant d'en
 *   faire la copie de secours.
 * @returns {boolean}      vrai si le fichier est en place
 */
function ecrireSur(file, contenu, opt) {
  const o = opt || {};
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
       coute une milliseconde et rattrape toute cette famille —
       pourvu qu'on ne copie que ce qui est entier. */
    if (o.copie !== false) {
      try { if (fs.existsSync(file) && entier(file, o.verifier)) fs.copyFileSync(file, file + '.bak'); } catch (e) {}
    }
    /* fsync avant le renommage : sans lui, le systeme peut avoir
       renomme un fichier dont le contenu n'a pas encore touche le
       disque — on aurait echange un fichier vide contre un autre. */
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, contenu);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
    signales.delete(file);
    return true;
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (e2) {}
    signaler(file, e);
    return false;
  }
}

/** Meme chose, pour un objet a serialiser. */
function ecrireJSON(file, objet, indent) {
  let texte;
  try { texte = JSON.stringify(objet, null, indent == null ? 1 : indent); }
  catch (e) { return false; }          /* cycle, BigInt : on n'ecrase rien */
  return ecrireSur(file, texte, { verifier: jsonEntier });
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

module.exports = { ecrireSur, ecrireJSON, lireJSON, surEchec };
