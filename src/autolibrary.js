'use strict';
/* ============================================================
   Decouverte automatique de la bibliotheque.
   Aucun import manuel : on lit la base du logiciel installe.
     Serato    _Serato_/database V2         (binaire)
     Traktor   collection.nml               (XML)
     VirtualDJ database.xml                 (XML)
     rekordbox un export .xml s'il existe   (XML)
     sinon     scan des dossiers de musique
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const seratoDb = require('./serato-db');
const lib = require('./library');

const HOME = os.homedir();
const win = process.platform === 'win32';
const exists = p => { try { return fs.existsSync(p); } catch (e) { return false; } };

/* ---------- emplacements connus ---------- */
function seratoPaths() {
  const bases = [path.join(HOME, 'Music'), path.join(HOME, 'Musique'), path.join(HOME, 'Musik')];
  return bases.map(b => path.join(b, '_Serato_', 'database V2'));
}
function traktorPaths() {
  const root = path.join(HOME, 'Documents', 'Native Instruments');
  const out = [];
  try {
    for (const d of fs.readdirSync(root)) {
      if (!/^Traktor/i.test(d)) continue;
      const p = path.join(root, d, 'collection.nml');
      if (exists(p)) out.push(p);
    }
  } catch (e) {}
  return out;
}
function virtualdjPaths() {
  return [
    path.join(HOME, 'Documents', 'VirtualDJ', 'database.xml'),
    path.join(HOME, 'Library', 'Application Support', 'VirtualDJ', 'database.xml'),
    win ? path.join(process.env.LOCALAPPDATA || '', 'VirtualDJ', 'database.xml') : ''
  ].filter(Boolean);
}
function rekordboxXmlPaths() {
  const dirs = [
    path.join(HOME, 'Library', 'Pioneer', 'rekordbox'),
    path.join(HOME, 'AppData', 'Roaming', 'Pioneer', 'rekordbox'),
    path.join(HOME, 'Documents'), path.join(HOME, 'Desktop'),
    path.join(HOME, 'Music', 'PioneerDJ'), path.join(HOME, 'Music')
  ];
  const out = [];
  for (const d of dirs) {
    let list = [];
    try { list = fs.readdirSync(d); } catch (e) { continue; }
    for (const f of list) {
      if (!/\.xml$/i.test(f)) continue;
      const p = path.join(d, f);
      try {
        const fd = fs.openSync(p, 'r');
        const head = Buffer.alloc(2048);
        fs.readSync(fd, head, 0, 2048, 0);
        fs.closeSync(fd);
        if (head.toString('utf8').includes('DJ_PLAYLISTS')) out.push(p);
      } catch (e) {}
    }
  }
  return out;
}
function musicFolders() {
  return [path.join(HOME, 'Music'), path.join(HOME, 'Musique'), path.join(HOME, 'Downloads'), path.join(HOME, 'Téléchargements')]
    .filter(exists);
}

/* ---------- Traktor collection.nml ---------- */
const TRAKTOR_KEY = ['8B','3B','10B','5B','12B','7B','2B','9B','4B','11B','6B','1B',
                     '5A','12A','7A','2A','9A','4A','11A','6A','1A','8A','3A','10A'];
const attr = (s, name) => { const m = s.match(new RegExp(name + '="([^"]*)"')); return m ? m[1] : ''; };
const unesc = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

function parseTraktor(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<ENTRY\b([\s\S]*?)<\/ENTRY>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[0], head = m[1].slice(0, m[1].indexOf('>') + 1);
    const dir = unesc(attr(e, 'DIR')).replace(/\/:/g, '/').replace(/^\/+/, '/');
    const f = unesc(attr(e, 'FILE'));
    if (!f) continue;
    const kv = attr(e, 'VALUE');
    const bpm = parseFloat(attr(e, 'BPM')) || 0;
    out.push({
      path: (dir || '/') + f,
      title: unesc(attr(head, 'TITLE')) || f,
      artist: unesc(attr(head, 'ARTIST')),
      genre: unesc(attr(e, 'GENRE')),
      bpm: Math.round(bpm * 10) / 10,
      key: TRAKTOR_KEY[Number(kv)] || lib.toCamelot(unesc(attr(e, 'KEY'))) || null,
      duration: parseFloat(attr(e, 'PLAYTIME')) || 0,
      pop: 40 + Math.min(40, (parseInt(attr(e, 'PLAYCOUNT'), 10) || 0) * 5)
    });
  }
  return out;
}

/* ---------- VirtualDJ database.xml ---------- */
function parseVirtualDJ(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<Song\b[^>]*>[\s\S]*?<\/Song>|<Song\b[^>]*\/>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[0];
    const p = unesc(attr(e, 'FilePath'));
    if (!p) continue;
    let bpm = parseFloat(attr(e, 'Bpm')) || 0;
    if (bpm > 0 && bpm < 10) bpm = 60 / bpm;          // VirtualDJ stocke la periode
    out.push({
      path: p,
      title: unesc(attr(e, 'Title')) || path.basename(p, path.extname(p)),
      artist: unesc(attr(e, 'Author')),
      genre: unesc(attr(e, 'Genre')),
      bpm: Math.round(bpm * 10) / 10,
      key: lib.toCamelot(unesc(attr(e, 'Key'))),
      duration: parseFloat(attr(e, 'SongLength')) || 0,
      pop: 40
    });
  }
  return out;
}

/* ---------- detection ---------- */
function detect() {
  const found = [];
  for (const p of seratoPaths()) if (exists(p)) found.push({ kind: 'serato', path: p, label: 'Serato — base de morceaux' });
  for (const p of traktorPaths()) found.push({ kind: 'traktor', path: p, label: 'Traktor — collection.nml' });
  for (const p of virtualdjPaths()) if (exists(p)) found.push({ kind: 'virtualdj', path: p, label: 'VirtualDJ — database.xml' });
  for (const p of rekordboxXmlPaths()) found.push({ kind: 'rekordbox', path: p, label: 'rekordbox — export XML' });
  if (!found.length) for (const d of musicFolders()) found.push({ kind: 'folder', path: d, label: 'Dossier de musique — ' + path.basename(d) });
  return found;
}

async function readSource(src, onProgress) {
  if (src.kind === 'serato') return seratoDb.parseDatabase(src.path);
  if (src.kind === 'traktor') return parseTraktor(src.path);
  if (src.kind === 'virtualdj') return parseVirtualDJ(src.path);
  if (src.kind === 'rekordbox') return lib.parseRekordboxXML(src.path);
  return lib.scanFolder(src.path, onProgress);
}

/** Fusionne plusieurs sources en dedoublonnant par chemin de fichier. */
function merge(lists) {
  const byPath = new Map();
  for (const list of lists) {
    for (const t of list) {
      const k = String(t.path).toLowerCase();
      const prev = byPath.get(k);
      if (!prev) { byPath.set(k, t); continue; }
      if (!prev.bpm && t.bpm) prev.bpm = t.bpm;
      if (!prev.key && t.key) prev.key = t.key;
      if (!prev.genre && t.genre) prev.genre = t.genre;
    }
  }
  return Array.from(byPath.values());
}

/** Surveille les fichiers de base : rappelle quand le DJ modifie sa bibliotheque. */
function watch(sources, onChange) {
  const watchers = [];
  let timer = null;
  for (const s of sources) {
    if (s.kind === 'folder') continue;
    try {
      const w = fs.watch(s.path, () => {
        clearTimeout(timer);
        timer = setTimeout(() => onChange(s), 4000);   // on laisse le logiciel finir d'ecrire
      });
      watchers.push(w);
    } catch (e) {}
  }
  return { stop: () => watchers.forEach(w => { try { w.close(); } catch (e) {} }) };
}

module.exports = { detect, readSource, merge, watch, parseTraktor, parseVirtualDJ,
                   seratoPaths, traktorPaths, virtualdjPaths, rekordboxXmlPaths, musicFolders };
