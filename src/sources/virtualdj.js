'use strict';
/* VirtualDJ — la tracklist du jour est ecrite en direct dans
   Documents/VirtualDJ/Tracklists/AAAA-MM-JJ.txt */
const fs = require('fs');
const path = require('path');
const os = require('os');

function dirFor(custom) {
  if (custom) return custom;
  const docs = path.join(os.homedir(), 'Documents', 'VirtualDJ', 'Tracklists');
  return docs;
}
/* ------------------------------------------------------------
   Chercher le fichier le plus recent, sans balayer le dossier
   toutes les secondes et demie.

   newest() faisait un readdirSync PLUS un statSync par fichier, a
   chaque tour de boucle, toute la nuit, sur le fil du widget. Un
   resident accumule des centaines de tracklists ou de sessions en
   deux ans : plusieurs centaines de statSync toutes les 1,5 s.

   La date du DOSSIER change des qu'un fichier y est cree ou
   renomme. On ne relit donc la liste que dans ce cas ; le reste du
   temps, un seul statSync sur le dossier suffit.
   ------------------------------------------------------------ */
let _cacheDossier = { dir: null, mtime: 0, best: null, a: 0 };

function newest(dir) {
  try {
    const d = fs.statSync(dir);
    const memeDossier = _cacheDossier.dir === dir;
    /* Rien n'a bouge et on a regarde il y a moins de 30 s : on garde. */
    if (memeDossier && d.mtimeMs === _cacheDossier.mtime && Date.now() - _cacheDossier.a < 30000)
      return _cacheDossier.best;
    _cacheDossier = { dir: dir, mtime: d.mtimeMs, best: null, a: Date.now() };
  } catch (e) { return null; }

  let best = null, bestT = 0;
  let list = [];
  try { list = fs.readdirSync(dir); } catch (e) { return null; }
  for (const f of list) {
    const p = path.join(dir, f);
    try { const s = fs.statSync(p); if (s.isFile() && s.mtimeMs > bestT) { bestT = s.mtimeMs; best = p; } } catch (e) {}
  }
  _cacheDossier.best = best;
  return best;
}
function start(opts, cb) {
  const dir = dirFor(opts.dir);
  let last = '', dejaDit = false;
  const tick = () => {
    const f = newest(dir);
    /* Ce message partait a CHAQUE tour, soit quarante messages IPC
       par minute vers le widget, indefiniment, quand le dossier
       n'existe pas. On ne le dit qu'une fois. */
    if (!f) {
      if (!dejaDit) { dejaDit = true; cb.onStatus({ ok: false, msg: 'Aucune tracklist VirtualDJ dans ' + dir }); }
      return;
    }
    dejaDit = false;
    let txt = '';
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return; }
    const lines = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) return;
    const line = lines[lines.length - 1].replace(/^\d{1,2}:\d{2}(:\d{2})?\s*[:\-]?\s*/, '');
    if (line && line !== last) { last = line; cb.onText(line, {}); }
  };
  cb.onStatus({ ok: true, msg: 'VirtualDJ : ' + dir });
  const iv = setInterval(tick, 1500);
  tick();
  return { stop: () => clearInterval(iv) };
}
module.exports = { start };
