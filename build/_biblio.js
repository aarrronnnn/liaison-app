'use strict';
/* ============================================================
   Charger la bibliotheque du DJ, comme l'app la charge.

   Pourquoi ce fichier existe : diagnostic.js et pourquoi.js
   relisaient tous les deux le cache de scan avec la meme ligne,

       Object.assign({ path: cle }, cache[cle])

   et cette ligne est fausse. Une entree du cache de scan n'est pas
   un objet : c'est un TABLEAU compact — [taille, date, titre,
   artiste, genre, tempo, tonalite, duree, annee] — parce que sur
   vingt-deux mille morceaux les noms de champs repetes pesaient
   plus lourd que les valeurs.

   Resultat : les deux outils rendaient des morceaux { path, 0, 1,
   2, ... } sans titre ni tempo. Le diagnostic annoncait alors
   « ta bibliotheque n'a presque aucun tempo » a un DJ dont la
   bibliotheque allait tres bien — soit exactement le contraire de
   ce qu'un outil de diagnostic doit faire.

   Un seul endroit, donc, pour cette lecture.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../src/library.js');

function dossier() {
  if (process.env.LIAISON_DIR) return process.env.LIAISON_DIR;
  const h = os.homedir();
  if (process.platform === 'darwin') return path.join(h, 'Library', 'Application Support', 'Liaison');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || h, 'Liaison');
  return path.join(h, '.config', 'Liaison');
}

function lireJSON(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; }
}

/* L'ordre des champs est fixe par scanFolder() dans library.js.
   Si l'un bouge la-bas, il bouge ici. */
function depuisCache(cle, e) {
  if (!Array.isArray(e)) return Object.assign({ path: cle }, e || {});
  return {
    path: cle,
    title: e[2] || path.basename(cle),
    artist: e[3] || '',
    genre: e[4] || '',
    bpm: e[5] || 0,
    key: e[6] || null,
    duration: e[7] || 0,
    year: e[8] || null,
    anneeIncertaine: e[9] == null ? lib.estReedition({ title: e[2] }) : !!e[9],
    pop: 40
  };
}

/**
 * @returns {{DIR:string, cfg:object|null, tracks:Array, source:string}}
 */
function charger() {
  const DIR = dossier();
  const cfg = lireJSON(path.join(DIR, 'config.json'));
  let bruts = [], source = '(aucune)';
  try {
    if (cfg && cfg.libraryMode === 'rekordbox' && cfg.libraryPath) {
      bruts = lib.parseRekordboxXML(cfg.libraryPath);
      source = 'export rekordbox : ' + cfg.libraryPath;
    } else if (cfg && cfg.libraryPath) {
      const c = lib.chargerScanCache(path.join(DIR, 'scan-cache.json')).e;
      bruts = Object.keys(c).map(k => depuisCache(k, c[k]));
      source = 'dossier scanne : ' + cfg.libraryPath;
    }
  } catch (e) {
    return { DIR: DIR, cfg: cfg, tracks: [], source: source, erreur: e.message };
  }
  return { DIR: DIR, cfg: cfg, tracks: lib.finalize(bruts), source: source };
}

module.exports = { charger, dossier, lireJSON, depuisCache };
