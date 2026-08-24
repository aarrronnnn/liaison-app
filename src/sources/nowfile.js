'use strict';
/* Source universelle : n'importe quel fichier texte que ton logiciel
   met a jour avec le morceau en cours (Rekordbox via un script,
   OBS, Mixxx, une passerelle maison...). */
const fs = require('fs');
function start(opts, cb) {
  const file = opts.file;
  if (!file) { cb.onStatus({ ok: false, msg: 'Aucun fichier configure' }); return { stop() {} }; }
  let last = '';
  const tick = () => {
    let txt = '';
    try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
    const line = txt.split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || '';
    if (line && line !== last) { last = line; cb.onText(line, {}); }
  };
  cb.onStatus({ ok: true, msg: 'Fichier surveille : ' + file });
  const iv = setInterval(tick, 1000);
  tick();
  return { stop: () => clearInterval(iv) };
}
module.exports = { start };
