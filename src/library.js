'use strict';
/* ============================================================
   Liaison — import et analyse de bibliotheque.
   Deux sources : rekordbox.xml (BPM/tonalite deja calcules)
   ou un dossier de musique (tags lus par ffprobe + analyse locale).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { analyze } = require('./analyze');

const AUDIO = new Set(['.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a', '.aac', '.ogg', '.wma']);

/* ---------- tonalite musicale -> Camelot ---------- */
const CAMELOT = {
  'Abm':'1A','G#m':'1A','B':'1B',
  'Ebm':'2A','D#m':'2A','F#':'2B','Gb':'2B',
  'Bbm':'3A','A#m':'3A','Db':'3B','C#':'3B',
  'Fm':'4A','Ab':'4B','G#':'4B',
  'Cm':'5A','Eb':'5B','D#':'5B',
  'Gm':'6A','Bb':'6B','A#':'6B',
  'Dm':'7A','F':'7B',
  'Am':'8A','C':'8B',
  'Em':'9A','G':'9B',
  'Bm':'10A','D':'10B',
  'F#m':'11A','Gbm':'11A','A':'11B',
  'C#m':'12A','Dbm':'12A','E':'12B'
};
function toCamelot(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (/^\d{1,2}[ABab]$/.test(s)) return s.toUpperCase();          // deja Camelot
  s = s.replace(/\s*(min|minor)$/i, 'm').replace(/\s*(maj|major)$/i, '');
  s = s.replace(/^([A-Ga-g])/, c => c.toUpperCase());
  s = s.replace(/♯/g, '#').replace(/♭/g, 'b').replace(/\s+/g, '');
  return CAMELOT[s] || null;
}

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

/* ---------- rekordbox.xml ---------- */
function parseRekordboxXML(xmlPath) {
  const xml = fs.readFileSync(xmlPath, 'utf8');
  const out = [];
  const re = /<TRACK\s([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const attrs = {};
    const ar = /([A-Za-z_]+)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
    if (!attrs.Name && !attrs.Location) continue;
    if (!attrs.Location) continue;
    let loc = attrs.Location.replace(/^file:\/\/localhost/, '').replace(/^file:\/\//, '');
    try { loc = decodeURIComponent(loc); } catch (e) {}
    if (process.platform === 'win32') loc = loc.replace(/^\//, '');
    out.push({
      rbId: num(attrs.TrackID),
      path: loc,
      title: attrs.Name || path.basename(loc),
      artist: attrs.Artist || '',
      genre: attrs.Genre || '',
      bpm: num(attrs.AverageBpm),
      key: toCamelot(attrs.Tonality),
      duration: num(attrs.TotalTime),
      pop: Math.min(100, 30 + num(attrs.PlayCount) * 6 + num(attrs.Rating) / 51 * 20)
    });
  }
  return out;
}

/* ---------- scan de dossier ---------- */
function walk(dir, acc, depth) {
  depth = depth || 0;
  if (depth > 8) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, depth + 1);
    else if (AUDIO.has(path.extname(e.name).toLowerCase())) acc.push(p);
  }
  return acc;
}

function ffprobePath() {
  try {
    let p = require('ffprobe-static');
    if (p && p.path) p = p.path;
    if (p) return String(p).replace('app.asar', 'app.asar.unpacked');
  } catch (e) {}
  return 'ffprobe';
}

function probe(file) {
  return new Promise(resolve => {
    const p = spawn(ffprobePath(), ['-v', 'quiet', '-print_format', 'json',
      '-show_format', '-show_entries', 'format=duration:format_tags', file]);
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', () => resolve({}));
    p.on('close', () => {
      try {
        const j = JSON.parse(out);
        const t = {};
        for (const k of Object.keys((j.format && j.format.tags) || {})) t[k.toLowerCase()] = j.format.tags[k];
        resolve({ tags: t, duration: num(j.format && j.format.duration) * 1 });
      } catch (e) { resolve({}); }
    });
  });
}

async function scanFolder(dir, onProgress) {
  const files = walk(dir, []);
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const info = await probe(f);
    const t = info.tags || {};
    out.push({
      path: f,
      title: t.title || path.basename(f, path.extname(f)),
      artist: t.artist || t.album_artist || '',
      genre: t.genre || '',
      bpm: num(t.tbpm || t.bpm || 0),
      key: toCamelot(t.initial_key || t.tkey || t.key),
      duration: info.duration || 0,
      pop: 40
    });
    if (onProgress && i % 10 === 0) onProgress({ phase: 'scan', done: i + 1, total: files.length });
  }
  return out;
}

/* ---------- cache d'analyse ---------- */
function loadCache(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return {}; }
}
function saveCache(file, cache) {
  try { fs.writeFileSync(file, JSON.stringify(cache)); } catch (e) {}
}
function stamp(p) {
  try { const s = fs.statSync(p); return s.size + ':' + Math.round(s.mtimeMs); } catch (e) { return 'x'; }
}

/**
 * Complete les morceaux avec energie / timbre / tonalite manquante.
 * Pool de workers = nombre de coeurs - 1.
 */
async function analyzeAll(tracks, cacheFile, onProgress) {
  const cache = loadCache(cacheFile);
  const todo = [];
  for (const t of tracks) {
    const k = t.path + '|' + stamp(t.path);
    const c = cache[k];
    if (c) { Object.assign(t, c); t.analyzed = true; }
    else todo.push({ t, k });
  }
  let done = 0;
  const workers = Math.max(1, Math.min(os.cpus().length - 1, 4));
  let cursor = 0;
  async function runner() {
    while (cursor < todo.length) {
      const job = todo[cursor++];
      try {
        const r = await analyze(job.t.path, { seconds: 90 });
        const patch = {
          energy: r.energy,
          timbre: r.timbre,
          key: job.t.key || r.key,
          vocal: r.vocalish >= 5 ? 1 : 0
        };
        Object.assign(job.t, patch);
        job.t.analyzed = true;
        cache[job.k] = patch;
      } catch (e) {
        job.t.energy = job.t.energy || 5;
        job.t.timbre = job.t.timbre || [5, 5, 5];
        job.t.vocal = 0;
      }
      done++;
      if (onProgress && done % 5 === 0) onProgress({ phase: 'analyse', done, total: todo.length });
      if (done % 100 === 0) saveCache(cacheFile, cache);
    }
  }
  await Promise.all(Array.from({ length: workers }, runner));
  saveCache(cacheFile, cache);
  if (onProgress) onProgress({ phase: 'analyse', done: todo.length, total: todo.length });
  return tracks;
}

function finalize(tracks) {
  return tracks
    .filter(t => t.bpm > 40 && t.bpm < 220)
    .map((t, i) => {
      t.id = i + 1;
      t.tags = String(t.genre || '')
        .toLowerCase().split(/[\/,;|]+/).map(s => s.trim()).filter(Boolean);
      t.out = t.duration > 300 ? 64 : t.duration > 180 ? 32 : 16;
      if (t.energy == null) t.energy = 5;
      if (!t.timbre) t.timbre = [5, 5, 5];
      return t;
    });
}

module.exports = { parseRekordboxXML, scanFolder, analyzeAll, finalize, toCamelot, walk };
