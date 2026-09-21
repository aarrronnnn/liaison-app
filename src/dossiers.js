'use strict';
/* ============================================================
   LES DOSSIERS QUE LE DJ AJOUTE LUI-MEME.

   La detection automatique couvre les rangements previsibles :
   la base du logiciel de mix, ~/Music, la racine d'un disque
   externe quand elle porte un nom reconnaissable. Quinze noms
   testes, un seul niveau de profondeur.

   Ca ne couvrira jamais tout le monde. « D:\\Mes sons 2024 »,
   « /Volumes/Boulot/Prod/Tracks », un NAS monte a la main : rien
   de tout cela ne ressemble a ce qu'on cherche, et aucune liste
   de noms ne rattrapera ca. A un moment il faut laisser le DJ
   montrer du doigt.

   ------------------------------------------------------------
   CE MODULE AJOUTE, IL NE REMPLACE PAS.

   Il existait deja un « library:pick » dans le cote principal,
   branche sur rien : l'interface ne l'appelait jamais. Et tel
   quel il etait dangereux — il REMPLACAIT toute la bibliotheque
   par le dossier choisi. Un DJ a deux disques qui ajoute le
   second aurait perdu le premier, et sa base rekordbox avec.

   Un dossier ajoute ici devient donc une SOURCE DE PLUS, au meme
   titre qu'une base detectee. Le reste de la chaine — fusion,
   doublons, elagage, surveillance — fonctionne deja sur une
   liste de sources et n'a rien a apprendre.
   ============================================================ */
const path = require('path');

/* Windows ne distingue pas la casse, et un slash final ne change
   rien a un dossier. On compare des formes, pas des chaines. */
function normaliser(p) {
  let x = String(p || '').trim().replace(/\\/g, '/');
  x = x.replace(/\/+$/, '');
  if (!x) return '';
  try { x = x.normalize('NFC'); } catch (e) {}
  return x;
}

function cle(p) {
  const n = normaliser(p);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

/** a contient-il b ? (b est-il dedans, ou le meme dossier ?) */
function contient(a, b) {
  const A = cle(a), B = cle(b);
  return A === B || B.startsWith(A + '/');
}

/**
 * Ajoute un dossier a la liste.
 *
 * Trois cas, et ils ne se valent pas :
 *   — deja present, ou DANS un dossier deja present : on ne fait
 *     rien, et on le DIT. Scanner deux fois le meme disque ne
 *     doublerait pas la bibliotheque, ca doublerait l'attente.
 *   — parent d'un dossier deja present : il l'englobe, donc on
 *     remplace l'enfant plutot que de lire deux fois la meme
 *     musique.
 *   — nouveau : on l'ajoute.
 *
 * @returns {{liste:string[], ajoute:boolean, raison:string, retires:string[]}}
 */
function ajouter(liste, p) {
  const l = (liste || []).map(normaliser).filter(Boolean);
  const n = normaliser(p);
  if (!n) return { liste: l, ajoute: false, raison: 'vide', retires: [] };

  for (const d of l) {
    if (cle(d) === cle(n)) return { liste: l, ajoute: false, raison: 'deja', retires: [] };
    if (contient(d, n)) return { liste: l, ajoute: false, raison: 'inclus', retires: [] };
  }
  const avales = l.filter(d => contient(n, d));
  const reste = l.filter(d => !contient(n, d));
  return { liste: reste.concat([n]), ajoute: true,
           raison: avales.length ? 'englobe' : 'ajoute', retires: avales };
}

/** Retire un dossier. Le retrait est toujours possible. */
function retirer(liste, p) {
  const l = (liste || []).map(normaliser).filter(Boolean);
  const n = cle(p);
  return { liste: l.filter(d => cle(d) !== n), retire: l.some(d => cle(d) === n) };
}

/**
 * Les dossiers, en sources lisibles par le reste de la chaine.
 *
 * Un dossier absent n'est PAS retire : un SSD debranche revient le
 * lendemain, et effacer le reglage de quelqu'un parce qu'il a
 * enleve sa cle USB serait une trahison. On le marque, on le garde,
 * et on ne tente pas de le lire ce soir.
 *
 * @param {Function} existe verifie qu'un dossier est la (injectable)
 */
function sources(liste, existe) {
  const voir = existe || (d => {
    try { return require('fs').statSync(d).isDirectory(); } catch (e) { return false; }
  });
  return (liste || []).map(normaliser).filter(Boolean).map(d => ({
    kind: 'folder', path: d, manuel: true, present: voir(d),
    label: 'Dossier ajoute — ' + (path.basename(d) || d)
  }));
}

/** Celles qu'on peut reellement lire maintenant. */
function lisibles(liste, existe) {
  return sources(liste, existe).filter(s => s.present);
}

module.exports = { normaliser, cle, contient, ajouter, retirer, sources, lisibles };
