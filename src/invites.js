'use strict';
/* ============================================================
   Les demandes des invites — ce que l'application publie.

   Deux choses partent vers les telephones, et rien d'autre :

   1. L'INDEX : titres et artistes de la bibliotheque, sans un seul
      chemin de fichier, sans tempo ni tonalite. Il est charge une
      fois par le telephone, qui cherche dedans lui-meme — la
      recherche ne fait plus travailler l'ordinateur du DJ pendant
      qu'il mixe (elle tournait sur le fil du widget).

   2. L'ETAT DE LA SOIREE : son nom, si elle est ouverte, le morceau
      en cours (si le DJ l'accepte), les plus demandes, et quelles
      demandes sont passees. Les plus demandes ne portent QUE des
      titres de la bibliotheque, a l'orthographe du DJ : un texte
      libre tape par un invite n'est jamais montre aux autres.

   La meme mise a plat que la page (invites.html) : c'est elle qui
   relie « ma demande » a « passe ✓ » sur le telephone.
   ============================================================ */
const crypto = require('crypto');

function plat(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[œ]/g, 'oe').replace(/[æ]/g, 'ae').replace(/[^a-z0-9]+/g, ' ').trim();
}
function cle(t, a) { return plat(t) + '|' + plat(a); }

/* Morceaux de 600 Ko au plus : le relais stocke chaque morceau dans
   une entree, et son fournisseur refuse les requetes d'un Mo. */
const TAILLE_MORCEAU = 600 * 1024;

function construireIndex(library) {
  const artistes = [], parArtiste = new Map(), lignes = [], vus = new Set();
  for (const t of library || []) {
    const titre = String(t && t.title || '').trim();
    if (!titre) continue;
    const artiste = String(t.artist || '').trim();
    const k = cle(titre, artiste);
    if (vus.has(k)) continue;
    vus.add(k);
    let ai = parArtiste.get(artiste);
    if (ai === undefined) { ai = artistes.length; artistes.push(artiste); parArtiste.set(artiste, ai); }
    lignes.push([titre.slice(0, 160), ai]);
  }
  const json = JSON.stringify({ a: artistes.map(a => a.slice(0, 120)), t: lignes });
  const v = crypto.createHash('sha1').update(json).digest('hex').slice(0, 12);
  const parts = [];
  for (let i = 0; i < json.length; i += TAILLE_MORCEAU) parts.push(json.slice(i, i + TAILLE_MORCEAU));
  if (!parts.length) parts.push(json);
  return { v, n: parts.length, parts, titres: lignes.length };
}

/* Un code de soiree lisible a voix haute : pas de 0/o, 1/l/i. */
const ALPHA = '23456789abcdefghjkmnpqrstuvwxyz';
function nouveauCode(n) {
  const b = crypto.randomBytes(n || 8);
  let s = '';
  for (let i = 0; i < b.length; i++) s += ALPHA[b[i] % ALPHA.length];
  return s;
}
function codeValide(c) { return typeof c === 'string' && /^[2-9a-hjkmnp-z]{6,16}$/.test(c); }

module.exports = { plat, cle, construireIndex, nouveauCode, codeValide, TAILLE_MORCEAU };
