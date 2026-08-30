'use strict';
/* ============================================================
   Liaison — les listes du client.

   Deux listes, deux effets opposes :
     a passer  — le titre est joue, et son genre tire l'ADN de la soiree
     a eviter  — le titre ne remonte jamais, quoi qu'en dise le moteur

   Trois facons de les remplir, de la plus simple a la plus complete :
     1. du texte colle           « Daft Punk - Get Lucky », une ligne par titre
     2. un CSV                   celui d'Exportify, ou n'importe quel export
     3. une playlist Spotify     si le DJ a colle ses identifiants d'app

   Les deux premieres marchent hors ligne et sans compte. La troisieme
   demande un identifiant gratuit chez Spotify : c'est le seul moyen
   honnete de lire une playlist, il n'existe pas d'acces anonyme.
   ============================================================ */
const https = require('https');

/* ---------- lecture d'une liste collee ---------- */

/* Sépare « Artiste - Titre » sans casser les titres qui contiennent
   eux-memes un tiret (« Sweet Dreams - Radio Edit »). On coupe au
   premier separateur entoure d'espaces, le seul qui soit fiable. */
function splitPair(line) {
  const m = line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!m) return { artist: '', title: line.trim() };
  return { artist: m[1].trim(), title: m[2].trim() };
}

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}

function fromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return null;
  const head = rows[0].map(h => h.trim().toLowerCase());
  const find = names => head.findIndex(h => names.some(n => h === n || h.includes(n)));
  const ti = find(['track name', 'titre', 'title', 'track', 'nom']);
  const ai = find(['artist name', 'artist name(s)', 'artiste', 'artist', 'artistes']);
  if (ti < 0) return null;
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const title = (rows[i][ti] || '').trim();
    if (!title) continue;
    const artist = ai >= 0 ? (rows[i][ai] || '').trim().split(/\s*,\s*/)[0] : '';
    out.push({ artist: artist, title: title });
  }
  return out.length ? out : null;
}

/** Transforme un collage quelconque en liste de morceaux. */
function parseList(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const csv = raw.includes(',') || raw.includes(';') || raw.includes('\t') ? fromCSV(raw) : null;
  if (csv) return dedupe(csv);

  const out = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (/^https?:\/\//i.test(line)) continue;              /* une adresse n'est pas un titre */
    line = line.replace(/^\s*\d+[\.\)]\s+/, '');           /* « 12. » en debut de ligne */
    const p = splitPair(line);
    if (p.title) out.push(p);
  }
  return dedupe(out);
}

function dedupe(list) {
  const seen = new Set(), out = [];
  for (const e of list) {
    const k = ((e.artist || '') + '|' + e.title).toLowerCase().replace(/\s+/g, ' ').trim();
    if (k === '|' || seen.has(k)) continue;
    seen.add(k);
    out.push({ artist: e.artist || '', title: e.title });
  }
  return out;
}

/* ---------- Spotify ---------- */
const playlistId = url => {
  const m = String(url || '').match(/playlist[/:]([A-Za-z0-9]+)/);
  return m ? m[1] : null;
};

function request(opt, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opt, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
        resolve({ code: res.statusCode, body: j });
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('Spotify ne repond pas')));
    if (body) req.write(body);
    req.end();
  });
}

async function spotifyToken(id, secret) {
  const body = 'grant_type=client_credentials';
  const r = await request({
    hostname: 'accounts.spotify.com', path: '/api/token', method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(body)
    }
  }, body);
  if (r.code !== 200 || !r.body.access_token)
    throw new Error(r.body.error_description || 'Identifiants Spotify refuses');
  return r.body.access_token;
}

/** Lit une playlist publique. Renvoie la liste des morceaux. */
async function fromSpotify(url, id, secret) {
  const pid = playlistId(url);
  if (!pid) throw new Error("Ce lien n'est pas une playlist Spotify");
  if (!id || !secret) throw new Error('Identifiants Spotify absents — voir les reglages');
  const token = await spotifyToken(id, secret);

  const out = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await request({
      hostname: 'api.spotify.com',
      path: '/v1/playlists/' + pid + '/tracks?limit=100&offset=' + offset +
            '&fields=items(track(name,artists(name))),next',
      method: 'GET', headers: { Authorization: 'Bearer ' + token }
    });
    if (r.code === 404) throw new Error('Playlist introuvable — est-elle publique ?');
    if (r.code !== 200) throw new Error('Spotify : erreur ' + r.code);
    for (const it of r.body.items || []) {
      const t = it && it.track;
      if (t && t.name) out.push({ artist: (t.artists && t.artists[0] && t.artists[0].name) || '', title: t.name });
    }
    if (!r.body.next) break;
  }
  return dedupe(out);
}

/* ---------- rapprochement avec la bibliotheque ---------- */

/**
 * Rapproche une liste de la bibliotheque du DJ.
 * @returns {{matched:Array, missing:Array}} — les titres trouves et ceux qui manquent
 */
function resolve(entries, library, match) {
  const matched = [], missing = [];
  for (const e of entries || []) {
    const q = (e.artist ? e.artist + ' ' : '') + e.title;
    const m = match(q, library, 0.56);
    if (m) matched.push({ entry: e, track: m.track, score: Math.round(m.score * 100) });
    else missing.push(e);
  }
  return { matched: matched, missing: missing };
}

/**
 * L'ADN que dessinent les morceaux voulus par le client.
 * On ne copie pas la playlist : on en tire les genres, ponderes par
 * le nombre de titres. C'est l'inspiration, pas le calque.
 */
function dnaOf(matchedTracks) {
  const count = {};
  let max = 0;
  for (const t of matchedTracks) {
    for (const tag of t.tags || []) {
      count[tag] = (count[tag] || 0) + 1;
      if (count[tag] > max) max = count[tag];
    }
  }
  const dna = {};
  for (const k of Object.keys(count)) dna[k] = Math.round(55 + (count[k] / (max || 1)) * 45);
  return dna;
}

module.exports = { parseList, fromSpotify, resolve, dnaOf, playlistId, splitPair, parseCSV };
