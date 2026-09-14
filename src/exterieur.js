'use strict';
/* ============================================================
   Le morceau qui joue et que Liaison ne connait pas.

   « J'ai des sons qui, quand je les passe, ne sont pas du tout
     reconnus : rien ne s'affiche alors qu'ils tournent. »

   Ce n'est pas une panne de detection. La detection marchait :
   rekordbox tenait bien le fichier ouvert, Liaison le voyait, il
   lisait meme son chemin complet. Puis il le jetait.

   Trois endroits jetaient, tous les trois en silence :

     1. les fichiers ouverts par rekordbox passaient par
        `resoudre(chemin)`, qui cherche le chemin dans la
        bibliotheque et rend `null` quand il n'y est pas. Et
        `null`, plus haut, ne declenchait rien du tout ;
     2. le texte annonce par Serato, Traktor ou VirtualDJ passait
        par `engine.match`, dont le seuil est a 0,58. En dessous,
        `null`, et la meme fin ;
     3. Pro DJ Link annonce un identifiant rekordbox : sans export
        XML importe, aucun morceau ne porte cet identifiant.

   Un morceau manque a la bibliotheque pour des raisons banales et
   frequentes : il a ete achete apres le dernier import, il vit sur
   une cle USB, il a ete renomme, il est dans un dossier que le DJ
   n'a pas ajoute, ou son nom de fichier ne ressemble pas a ses
   tags. Aucune de ces raisons ne justifie un widget muet.

   Ce module fabrique un morceau a partir de ce qu'on a sous la
   main. Avec un chemin, c'est presque aussi bien qu'une entree de
   bibliotheque : on lit ses tags, et l'analyse de Liaison fera le
   reste — c'est elle qui fait foi de toute facon. Avec seulement
   un texte, c'est maigre, mais un titre affiche et une explication
   valent infiniment mieux qu'un ecran vide.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { probe, toCamelot, cleChemin, hash53, anneeTag } = require('./library');

/* Les numeros de piste en tete de nom de fichier : « 03 », « 03 - »,
   « 03. », « A1 ». On les retire, ils ne sont jamais le titre. */
const NUMERO = /^\s*(?:[A-Ea-e]?\d{1,3})\s*[-._)\]]\s*/;

/* Ce que les DJs et les boutiques collent dans les noms de fichiers
   et qui n'appartient ni au titre ni a l'artiste. */
const BRUIT = /\s*[\[(](?:www\.[^\])]*|[^\])]*\.(?:com|net|org|fr)[^\])]*)[\])]\s*/gi;

function nettoyer(s) {
  return String(s || '').replace(BRUIT, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * « Artiste - Titre » depuis un nom de fichier ou une ligne de texte.
 * On ne coupe que sur un tiret ENTOURE d'espaces : sans cette regle,
 * « Jean-Jacques Goldman » devient « Jean » et « Jacques Goldman ».
 */
function couper(brut) {
  const s = nettoyer(String(brut || '').replace(NUMERO, ''));
  const i = s.indexOf(' - ');
  if (i > 0) {
    const artist = s.slice(0, i).trim();
    const title = s.slice(i + 3).trim();
    if (artist && title) return { artist: artist, title: title };
  }
  return { artist: '', title: s };
}

/** Un identifiant stable, qui ne peut pas percuter ceux de la bibliotheque. */
function idDe(cle, pris) {
  let id = hash53('hors:' + cle);
  if (pris) while (pris.has(id)) id = id + 1 <= Number.MAX_SAFE_INTEGER ? id + 1 : 1;
  return id;
}

function base(t) {
  t.horsBiblio = true;
  t.pop = 40;
  t.tags = String(t.genre || '').toLowerCase()
    .split(/[\/,;|]+/).map(s => s.trim()).filter(Boolean);
  return t;
}

/**
 * Un morceau construit a partir d'un fichier present sur le disque.
 * Les tags servent de point de depart ; l'analyse de Liaison les
 * confirmera ou les corrigera, exactement comme pour la bibliotheque.
 *
 * @param {string} chemin
 * @param {Set<number>} [pris]  les identifiants deja utilises
 * @returns {Promise<object|null>}
 */
async function depuisFichier(chemin, pris) {
  if (!chemin) return null;
  let info = {};
  try { info = await probe(chemin); } catch (e) { info = {}; }
  const tags = (info && info.tags) || {};
  const nom = couper(path.basename(chemin, path.extname(chemin)));

  /* Un tempo de tag aberrant est un tag faux, pas une raison de
     refuser le morceau : on le laisse a null et l'analyse tranchera. */
  const bpmTag = Number(tags.tbpm || tags.bpm || 0);
  const bpm = (bpmTag > 40 && bpmTag < 220) ? bpmTag : null;

  return base({
    id: idDe(cleChemin(chemin), pris),
    path: chemin,
    title: nettoyer(tags.title) || nom.title || path.basename(chemin),
    artist: nettoyer(tags.artist || tags.album_artist) || nom.artist || '',
    genre: tags.genre || '',
    bpm: bpm,
    aMesurer: bpm == null,
    key: toCamelot(tags.initial_key || tags.tkey || tags.key) || null,
    duration: (info && info.duration) || 0,
    year: anneeTag(tags.date || tags.year || tags.originalyear || tags.tyer || tags.tdrc)
  });
}

/**
 * Un morceau construit a partir d'un simple texte — tout ce que
 * Serato, Traktor ou VirtualDJ annoncent quand le rapprochement
 * avec la bibliotheque a echoue.
 *
 * Il n'a pas de fichier, donc il ne sera jamais analyse : c'est un
 * en-tete honnete, pas une entree de bibliotheque. Le moteur sait
 * deja travailler sans tempo et sans tonalite, et raisonDuVide()
 * dira pourquoi les propositions sont maigres.
 */
function depuisTexte(texte, pris) {
  const s = nettoyer(texte);
  if (s.length < 2) return null;
  const c = couper(s);
  return base({
    id: idDe('texte:' + s.toLowerCase(), pris),
    path: null,
    sansFichier: true,
    title: c.title || s,
    artist: c.artist || '',
    genre: '',
    bpm: null,
    aMesurer: false,          /* rien a mesurer : on n'a pas le fichier */
    key: null,
    duration: 0,
    year: null
  });
}

/** Le fichier est-il toujours la ? Un morceau sur une cle debranchee
    ne doit pas rester affiche comme s'il jouait. */
function existe(chemin) {
  try { return !!chemin && fs.statSync(chemin).isFile(); } catch (e) { return false; }
}

module.exports = { depuisFichier, depuisTexte, couper, nettoyer, idDe, existe };
