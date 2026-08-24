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
function newest(dir) {
  let best = null, bestT = 0;
  let list = [];
  try { list = fs.readdirSync(dir); } catch (e) { return null; }
  for (const f of list) {
    const p = path.join(dir, f);
    try { const s = fs.statSync(p); if (s.isFile() && s.mtimeMs > bestT) { bestT = s.mtimeMs; best = p; } } catch (e) {}
  }
  return best;
}
function start(opts, cb) {
  const dir = dirFor(opts.dir);
  let last = '';
  const tick = () => {
    const f = newest(dir);
    if (!f) { cb.onStatus({ ok: false, msg: 'Aucune tracklist VirtualDJ dans ' + dir }); return; }
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
