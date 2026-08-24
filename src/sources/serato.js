'use strict';
/* Serato DJ Pro — le fichier de session de l'historique est ecrit en direct.
   On lit la fin du fichier et on extrait les chaines UTF-16BE :
   le rapprochement avec la bibliotheque fait le reste. */
const fs = require('fs');
const path = require('path');
const os = require('os');

function sessionsDir(custom) {
  if (custom) return custom;
  const music = path.join(os.homedir(), 'Music', '_Serato_', 'History', 'Sessions');
  const alt = path.join(os.homedir(), 'Musique', '_Serato_', 'History', 'Sessions');
  return fs.existsSync(music) ? music : alt;
}

function newest(dir) {
  let best = null, bestT = 0;
  let list = [];
  try { list = fs.readdirSync(dir); } catch (e) { return null; }
  for (const f of list) {
    if (!f.endsWith('.session')) continue;
    const p = path.join(dir, f);
    try {
      const s = fs.statSync(p);
      if (s.mtimeMs > bestT) { bestT = s.mtimeMs; best = p; }
    } catch (e) {}
  }
  return best;
}

/* Extrait les chaines UTF-16BE lisibles d'un buffer binaire. */
function strings(buf, min) {
  min = min || 4;
  const out = [];
  let cur = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const hi = buf[i], lo = buf[i + 1];
    const code = (hi << 8) | lo;
    const ok = code === 32 || (code >= 0x21 && code <= 0x24f) || (code >= 0x2018 && code <= 0x201d);
    if (ok) cur += String.fromCharCode(code);
    else { if (cur.trim().length >= min) out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim().length >= min) out.push(cur.trim());
  return out;
}

function start(opts, cb) {
  const dir = sessionsDir(opts.dir);
  let file = newest(dir);
  let lastSize = 0, lastText = '';
  if (!file) cb.onStatus({ ok: false, msg: 'Aucune session Serato trouvee dans ' + dir });
  else cb.onStatus({ ok: true, msg: 'Serato : ' + path.basename(file) });

  const tick = () => {
    const f = newest(dir);
    if (!f) return;
    if (f !== file) { file = f; lastSize = 0; cb.onStatus({ ok: true, msg: 'Serato : ' + path.basename(f) }); }
    let st;
    try { st = fs.statSync(file); } catch (e) { return; }
    if (st.size === lastSize) return;
    lastSize = st.size;
    const len = Math.min(st.size, 65536);
    const buf = Buffer.alloc(len);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, buf, 0, len, st.size - len);
    } catch (e) { return; } finally { if (fd) try { fs.closeSync(fd); } catch (e) {} }
    const found = strings(buf).filter(s => !/^[\/~]|\.(mp3|wav|aiff?|flac|m4a)$/i.test(s));
    const tail = found.slice(-8).reverse();
    const text = tail.slice(0, 3).join(' ');
    if (text && text !== lastText) { lastText = text; cb.onText(text, { candidates: tail }); }
  };

  const iv = setInterval(tick, 1500);
  tick();
  return { stop: () => clearInterval(iv) };
}

module.exports = { start, sessionsDir, strings };
