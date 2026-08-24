'use strict';
/* ============================================================
   Lecture de la base Serato (_Serato_/database V2).
   Format public : suite de chunks [tag 4o][longueur 4o BE][corps].
   Le type du champ est donne par la premiere lettre du tag :
     o,r = conteneur | t,p = texte UTF-16BE | s = int16 | u = uint32 | b = octet
   ============================================================ */
const fs = require('fs');

function readChunks(buf, start, end) {
  const out = [];
  let i = start;
  while (i + 8 <= end) {
    const tag = buf.toString('ascii', i, i + 4);
    const len = buf.readUInt32BE(i + 4);
    const bodyStart = i + 8;
    const bodyEnd = bodyStart + len;
    if (len < 0 || bodyEnd > end) break;
    out.push({ tag: tag, start: bodyStart, end: bodyEnd });
    i = bodyEnd;
  }
  return out;
}

/* Serato ecrit ses chaines en UTF-16 big endian */
function readText(buf, a, b) {
  let s = '';
  for (let i = a; i + 1 < b; i += 2) {
    const code = (buf[i] << 8) | buf[i + 1];
    if (code === 0) continue;            // remplissage
    s += String.fromCharCode(code);
  }
  return s.trim();
}

function parseTrack(buf, start, end) {
  const t = {};
  for (const f of readChunks(buf, start, end)) {
    const k = f.tag, c = k[0];
    if (c === 't' || c === 'p') t[k] = readText(buf, f.start, f.end);
    else if (c === 'u' && f.end - f.start >= 4) t[k] = buf.readUInt32BE(f.start);
    else if (c === 's' && f.end - f.start >= 2) t[k] = buf.readUInt16BE(f.start);
    else if (c === 'b') t[k] = buf[f.start] === 1;
  }
  return t;
}

function parseLen(s) {
  if (!s) return 0;
  const p = String(s).split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return Number(s) || 0;
}

/** @returns {Array} morceaux de la bibliotheque Serato */
function parseDatabase(file) {
  const buf = fs.readFileSync(file);
  const out = [];
  for (const c of readChunks(buf, 0, buf.length)) {
    if (c.tag !== 'otrk') continue;
    const t = parseTrack(buf, c.start, c.end);
    const p = t.pfil || '';
    if (!p) continue;
    out.push({
      path: process.platform === 'win32' ? p : (p.startsWith('/') ? p : '/' + p),
      title: t.tsng || '',
      artist: t.tart || '',
      genre: t.tgen || '',
      bpm: parseFloat(String(t.tbpm || '0').replace(',', '.')) || 0,
      key: t.tkey || null,
      duration: parseLen(t.tlen),
      pop: 40
    });
  }
  return out;
}

/* ---------- generation d'un fichier de test ---------- */
function encodeText(s) {
  const b = Buffer.alloc(s.length * 2);
  for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2);
  return b;
}
function chunk(tag, body) {
  const h = Buffer.alloc(8);
  h.write(tag, 0, 4, 'ascii');
  h.writeUInt32BE(body.length, 4);
  return Buffer.concat([h, body]);
}
function buildTestDatabase(tracks) {
  const parts = [chunk('vrsn', encodeText('2.0/Serato Scratch LIVE Database'))];
  for (const t of tracks) {
    const fields = Buffer.concat([
      chunk('ttyp', encodeText('mp3')),
      chunk('pfil', encodeText(t.path.replace(/^\//, ''))),
      chunk('tsng', encodeText(t.title)),
      chunk('tart', encodeText(t.artist)),
      chunk('tgen', encodeText(t.genre || '')),
      chunk('tbpm', encodeText(String(t.bpm))),
      chunk('tkey', encodeText(t.key || '')),
      chunk('tlen', encodeText(t.len || '05:20'))
    ]);
    parts.push(chunk('otrk', fields));
  }
  return Buffer.concat(parts);
}

module.exports = { parseDatabase, buildTestDatabase, readChunks, readText };
