'use strict';
/* ============================================================
   Decouverte automatique de la bibliotheque.
   Aucun import manuel : on lit la base du logiciel installe.
     Serato    _Serato_/database V2         (binaire)
     Traktor   collection.nml               (XML)
     VirtualDJ database.xml                 (XML)
     rekordbox un export .xml s'il existe   (XML)
     iTunes    iTunes Music Library.xml      (plist)
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
/* ---------- iTunes / Musique ----------
   Beaucoup de DJs tiennent tout dans iTunes et laissent rekordbox se
   synchroniser dessus. Le XML n'existe que si « Partager la bibliotheque
   XML avec d'autres applications » est coche — mais c'est justement la
   case que rekordbox oblige a cocher, donc ces DJs l'ont deja. */
function itunesPaths() {
  const names = ['iTunes Music Library.xml', 'iTunes Library.xml', 'Music Library.xml'];
  const dirs = [
    path.join(HOME, 'Music', 'iTunes'),
    path.join(HOME, 'Music', 'Music'),
    path.join(HOME, 'Musique', 'iTunes'),
    path.join(HOME, 'Musik', 'iTunes'),
    win ? path.join(HOME, 'Music', 'iTunes') : '',
    win ? path.join(process.env.USERPROFILE || '', 'Music', 'iTunes') : ''
  ].filter(Boolean);
  const out = [];
  for (const d of dirs) for (const n of names) {
    const f = path.join(d, n);
    if (exists(f) && out.indexOf(f) < 0) out.push(f);
  }
  return out;
}

/* ---------- disques externes ----------
   Beaucoup de DJs tiennent leur bibliotheque sur un SSD externe :
   c'est le disque qu'on emporte en soiree, pas le portable. Un
   dossier de musique qui ne cherche que dans le HOME ne trouve
   donc rien chez eux.

   On liste les volumes montes — /Volumes sur macOS, /media et
   /mnt sur Linux, les lettres de lecteur sur Windows — et on y
   cherche les dossiers de musique evidents, sans jamais descendre
   dans tout le disque : un SSD de 2 To parcouru en entier prend
   des minutes pour trouver ce qui est toujours a la racine. */
function externalVolumes() {
  const out = [];
  if (win) {
    for (const l of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      const r = l + ':\\';
      if (exists(r)) out.push(r);
    }
    return out;
  }
  for (const base of ['/Volumes', '/media/' + (process.env.USER || ''), '/media', '/mnt']) {
    let list = [];
    try { list = fs.readdirSync(base); } catch (e) { continue; }
    for (const d of list) {
      if (d.startsWith('.')) continue;
      const p = path.join(base, d);
      /* le disque de demarrage est deja couvert par le HOME */
      try { if (fs.realpathSync(p) === '/') continue; } catch (e) {}
      out.push(p);
    }
  }
  return out;
}

/* Les noms sous lesquels un DJ range sa musique, a la racine d'un
   disque externe. On teste, on ne devine pas. */
const NOMS_MUSIQUE = ['Music', 'Musique', 'Musik', 'Musica', 'DJ', 'DJ Music', 'Tracks',
                      'Morceaux', 'Sons', 'Serato', 'rekordbox', 'Traktor', 'USB', 'Contents'];

function musicFolders() {
  const out = [path.join(HOME, 'Music'), path.join(HOME, 'Musique'),
               path.join(HOME, 'Downloads'), path.join(HOME, 'Téléchargements')].filter(exists);

  for (const v of externalVolumes()) {
    let trouve = false;
    for (const n of NOMS_MUSIQUE) {
      const p = path.join(v, n);
      if (exists(p)) { out.push(p); trouve = true; }
    }
    /* Rien de reconnaissable a la racine : on prend le volume
       lui-meme, mais seulement s'il contient deja des fichiers
       audio au premier niveau — sinon on ne fouille pas le disque
       de sauvegarde de quelqu'un. */
    if (!trouve) {
      try {
        const racine = fs.readdirSync(v);
        if (racine.some(f => /\.(mp3|wav|aiff?|flac|m4a|aac|ogg)$/i.test(f))) out.push(v);
      } catch (e) {}
    }
  }
  return out;
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
  for (const p of itunesPaths()) found.push({ kind: 'itunes', path: p, label: 'iTunes / Musique — bibliothèque XML' });
  if (!found.length) for (const d of musicFolders()) {
    const externe = /^\/Volumes\/|^\/media\/|^\/mnt\/|^[D-Z]:/i.test(d);
    found.push({ kind: 'folder', path: d, externe: externe,
      label: (externe ? 'Disque externe — ' : 'Dossier de musique — ') + path.basename(d) });
  }
  return found;
}

async function readSource(src, onProgress) {
  if (src.kind === 'serato') return seratoDb.parseDatabase(src.path);
  if (src.kind === 'traktor') return parseTraktor(src.path);
  if (src.kind === 'virtualdj') return parseVirtualDJ(src.path);
  if (src.kind === 'rekordbox') return lib.parseRekordboxXML(src.path);
  if (src.kind === 'itunes') return parseITunes(src.path);
  return lib.scanFolder(src.path, onProgress);
}

/* ---------- lecture du plist iTunes ----------
   Le fichier est un plist XML : une suite de <key> suivies de leur
   valeur. On ne charge pas un analyseur complet — on parcourt le bloc
   « Tracks » et on lit les cles qui nous interessent. Un plist iTunes
   de 20 000 titres fait 30 Mo et se lit en moins d'une seconde ainsi. */
function plistUnesc(s) {
  return String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));
}

/** file:///Users/... -> /Users/... , avec les %20 decodes. */
function fromFileURL(u) {
  if (!u) return '';
  if (u.indexOf('file://') !== 0) return u;
  let p = u.replace(/^file:\/\/(localhost)?/, '');
  try { p = decodeURIComponent(p); } catch (e) {}
  if (win) p = p.replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\');
  return p;
}

function parseITunes(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const start = xml.indexOf('<key>Tracks</key>');
  if (start < 0) return [];
  const end = xml.indexOf('<key>Playlists</key>', start);
  const body = xml.slice(start, end > 0 ? end : xml.length);

  const out = [];
  /* chaque piste est un <dict> a l'interieur du dictionnaire Tracks */
  const re = /<dict>([\s\S]*?)<\/dict>/g;
  let m;
  while ((m = re.exec(body))) {
    const d = m[1];
    const val = key => {
      const r = new RegExp('<key>' + key + '</key>\\s*<(string|integer|real|date|true|false)\\s*\\/?>([^<]*)', 'i');
      const x = d.match(r);
      if (!x) return '';
      if (x[1] === 'true' || x[1] === 'false') return x[1];
      return plistUnesc(x[2]);
    };
    const loc = val('Location');
    const name = val('Name');
    if (!name && !loc) continue;
    /* on ecarte ce qui n'est pas de la musique jouable */
    if (val('Podcast') === 'true' || val('Movie') === 'true' || val('TV Show') === 'true') continue;
    const kind = val('Kind');
    if (kind && /video|film|movie/i.test(kind)) continue;

    const p = fromFileURL(loc);
    const bpm = parseFloat(val('BPM')) || 0;
    const plays = parseInt(val('Play Count'), 10) || 0;
    const rating = parseInt(val('Rating'), 10) || 0;      /* 0..100 */
    out.push({
      path: p || ('itunes:' + val('Track ID')),
      /* garde pour retrouver ce morceau dans les playlists du plist,
         qui ne referencent que des identifiants */
      itId: val('Track ID') || null,
      /* iTunes est la seule source qui porte vraiment cette etiquette */
      explicit: val('Explicit') === 'true' ? 1 : 0,
      title: name || path.basename(p, path.extname(p)),
      artist: val('Artist') || val('Album Artist') || '',
      genre: val('Genre') || '',
      bpm: bpm > 0 ? Math.round(bpm * 10) / 10 : 0,
      key: null,
      duration: (parseInt(val('Total Time'), 10) || 0) / 1000,
      /* iTunes sait deux choses que les logiciels DJ ignorent :
         combien de fois le morceau a ete joue, et la note du DJ. */
      pop: Math.max(20, Math.min(95, 35 + Math.min(35, plays * 3) + Math.round(rating / 100 * 25)))
    });
  }
  return out;
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
      /* les identifiants servent a rattacher les crates : un morceau vu
         par deux sources doit garder les deux etiquettes */
      if (prev.rbId == null && t.rbId != null) prev.rbId = t.rbId;
      if (prev.itId == null && t.itId != null) prev.itId = t.itId;
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

module.exports = { detect, readSource, merge, watch, parseTraktor, parseVirtualDJ, parseITunes,
                   seratoPaths, traktorPaths, virtualdjPaths, rekordboxXmlPaths, itunesPaths,
                   musicFolders, externalVolumes, fromFileURL };
