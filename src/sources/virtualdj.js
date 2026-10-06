'use strict';
/* ============================================================
   VIRTUALDJ — L'HISTORIQUE, LA OU VIRTUALDJ L'ECRIT VRAIMENT.

   L'ancienne version lisait Documents/VirtualDJ/Tracklists, un
   dossier que VirtualDJ 8 et suivants n'ecrivent pas. VirtualDJ
   tient son historique dans le dossier « History » de son dossier
   personnel : un fichier .m3u par session, ou chaque morceau joue
   s'ajoute sous la forme

       #EXTVDJ:<time>…</time><filesize>…</filesize><artist>…</artist><title>…</title>
       /chemin/complet/du/morceau.mp3

   (l'option « writeHistory » de VirtualDJ doit etre sur Yes). Le
   dossier personnel de VirtualDJ est Documents/VirtualDJ, ou
   ~/Library/Application Support/VirtualDJ sur les Mac recents, ou
   %LOCALAPPDATA%\VirtualDJ sur Windows. C'est ainsi que le lisent
   les outils qui marchent (Now Playing). Resultat avant le
   6 octobre 2026 : aucun titre, jamais.

   On cherche donc History dans les trois, on garde le fichier le
   plus recent, et on lit sa derniere entree : artiste et titre
   quand ils sont la, et le CHEMIN du fichier, qui designe le
   morceau sans aucune ambiguite (main.js le cherche d'abord dans
   la bibliotheque). La tracklist en texte (« 21:04 : Artiste -
   Titre ») reste comprise, pour les anciennes versions.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');

function dossiers(custom) {
  if (custom) return [custom];
  const out = [];
  for (const d of require('../volumes').dossiersDocuments()) {
    out.push(path.join(d, 'VirtualDJ', 'History'));
    out.push(path.join(d, 'VirtualDJ', 'Tracklists'));
  }
  out.push(path.join(os.homedir(), 'Library', 'Application Support', 'VirtualDJ', 'History'));
  if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'VirtualDJ', 'History'));
  return Array.from(new Set(out));
}

/* ------------------------------------------------------------
   Chercher le fichier le plus recent, sans balayer le dossier
   toutes les secondes et demie.

   La date du DOSSIER change des qu'un fichier y est cree ou
   renomme. On ne relit donc la liste que dans ce cas (ou toutes les
   30 s) ; le reste du temps, un seul statSync par dossier suffit.
   ------------------------------------------------------------ */
const _caches = new Map();

function plusRecentDans(dir) {
  let d;
  try { d = fs.statSync(dir); } catch (e) { _caches.delete(dir); return null; }
  const c = _caches.get(dir);
  if (c && d.mtimeMs === c.mtime && Date.now() - c.a < 30000) return c.best;
  const neuf = { mtime: d.mtimeMs, best: null, a: Date.now() };
  let liste = [];
  try { liste = fs.readdirSync(dir); } catch (e) { return null; }
  let bestT = 0;
  for (const f of liste) {
    if (!/\.(m3u8?|txt)$/i.test(f)) continue;
    const p = path.join(dir, f);
    try {
      const s = fs.statSync(p);
      if (s.isFile() && s.mtimeMs > bestT) { bestT = s.mtimeMs; neuf.best = p; }
    } catch (e) {}
  }
  _caches.set(dir, neuf);
  return neuf.best;
}

/* Le plus recent de tous les dossiers : on recompare les dates des
   fichiers a chaque tour, puisqu'un fichier qui grossit ne change
   pas la date de son dossier. */
function newest(dirs) {
  let best = null, bestT = 0;
  for (const dir of [].concat(dirs)) {
    const f = plusRecentDans(dir);
    if (!f) continue;
    try { const s = fs.statSync(f); if (s.mtimeMs > bestT) { bestT = s.mtimeMs; best = f; } } catch (e) {}
  }
  return best ? { fichier: best, mtime: bestT } : null;
}

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decoder(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch (x) { return m; }
    }
    return ENTITES[e.toLowerCase()] || m;
  });
}
function balise(ligne, nom) {
  const m = new RegExp('<' + nom + '>([\\s\\S]*?)</' + nom + '>', 'i').exec(ligne);
  return m ? decoder(m[1]).trim() : '';
}

/* ------------------------------------------------------------
   La derniere entree d'un historique.
   Rend { texte, chemin } ou null.
   ------------------------------------------------------------ */
function derniereEntree(contenu, nomFichier) {
  const lignes = String(contenu || '').replace(/^﻿/, '').split(/\r?\n/)
    .map(s => s.trim()).filter(Boolean);
  if (!lignes.length) return null;

  if (/\.txt$/i.test(nomFichier || '')) {
    /* Tracklist en texte : « 21:04 : Artiste - Titre ». */
    const texte = lignes[lignes.length - 1].replace(/^\d{1,2}:\d{2}(:\d{2})?\s*[:\-]?\s*/, '');
    return texte ? { texte: texte, chemin: '' } : null;
  }

  /* .m3u : la derniere ligne de chemin, et l'#EXTVDJ qui la precede. */
  let i = lignes.length - 1;
  while (i >= 0 && lignes[i][0] === '#') i--;
  if (i < 0) return null;
  const chemin = lignes[i];
  let artiste = '', titre = '';
  for (let k = i - 1; k >= 0 && lignes[k][0] === '#'; k--) {
    if (/^#EXTVDJ:/i.test(lignes[k])) {
      artiste = balise(lignes[k], 'artist');
      titre = balise(lignes[k], 'title');
      break;
    }
    if (/^#EXTINF:/i.test(lignes[k]) && !titre) {
      /* #EXTINF:duree,Artiste - Titre */
      const v = lignes[k].replace(/^#EXTINF:[^,]*,/i, '').trim();
      if (v) titre = v;
    }
  }
  let texte = titre ? (artiste ? artiste + ' - ' + titre : titre) : '';
  if (!texte) texte = path.basename(chemin.replace(/\\/g, '/')).replace(/\.[a-z0-9]{2,5}$/i, '');
  return texte ? { texte: texte, chemin: chemin } : null;
}

/* Un historique plus vieux que ca, au demarrage, est celui d'une
   AUTRE soiree : on ne l'annonce pas comme « en cours ». */
const VIEUX_AU_DEMARRAGE = 10 * 60 * 1000;

function start(opts, cb) {
  const dirs = dossiers(opts.dir);
  const affiche = () => {
    const vu = dirs.find(d => { try { return fs.existsSync(d); } catch (e) { return false; } });
    return vu || dirs[0];
  };
  let dernier = '', dejaDit = false, premierTour = true;
  let ignore = null;           /* { fichier, taille } a ne pas annoncer */

  const tick = () => {
    const n = newest(dirs);
    /* Le message d'absence ne part qu'une fois : quarante messages
       par minute vers le widget, c'etait l'ancien comportement. */
    if (!n) {
      if (!dejaDit) {
        dejaDit = true;
        cb.onStatus({ ok: false, msg: 'Aucun historique VirtualDJ dans ' + affiche() +
          ' — dans VirtualDJ : Réglages › Options, writeHistory sur Yes' });
      }
      premierTour = false;
      return;
    }
    if (dejaDit) { dejaDit = false; cb.onStatus({ ok: true, msg: 'VirtualDJ : ' + path.dirname(n.fichier) }); }

    let st;
    try { st = fs.statSync(n.fichier); } catch (e) { return; }
    if (premierTour) {
      premierTour = false;
      if (Date.now() - n.mtime > VIEUX_AU_DEMARRAGE) { ignore = { fichier: n.fichier, taille: st.size }; return; }
    }
    if (ignore && ignore.fichier === n.fichier && ignore.taille === st.size) return;
    ignore = null;

    /* La fin du fichier suffit : une soiree, c'est quelques
       centaines de lignes, mais un historique peut garder des mois. */
    let contenu = '';
    try {
      const len = Math.min(st.size, 65536);
      const buf = Buffer.alloc(len);
      const fd = fs.openSync(n.fichier, 'r');
      try { fs.readSync(fd, buf, 0, len, st.size - len); } finally { fs.closeSync(fd); }
      contenu = buf.toString('utf8');
      if (len < st.size) contenu = contenu.slice(contenu.indexOf('\n') + 1);
    } catch (e) { return; }
    const e = derniereEntree(contenu, n.fichier);
    if (!e) return;
    const cle = e.texte + '|' + e.chemin;
    if (cle === dernier) return;
    dernier = cle;
    cb.onText(e.texte, e.chemin ? { chemin: e.chemin } : {});
  };

  cb.onStatus({ ok: true, msg: 'VirtualDJ : ' + affiche() });
  const iv = setInterval(tick, 1500);
  tick();
  return { stop: () => clearInterval(iv) };
}

module.exports = { start, dossiers, newest, derniereEntree };
