'use strict';
/* ============================================================
   Les crates — les listes que le DJ a deja faites.

   Un DJ range ses morceaux bien avant d'arriver en cabine :
   « Mariage », « Chill 18h », « Bangers », « A tester ». Ces listes
   sont sa vraie hierarchie, pas les genres des tags. Quand il dit
   « ce soir, seulement ce dossier », c'est de ca qu'il parle.

   On lit ces listes la ou chaque logiciel les range :
     Serato    _Serato_/Subcrates/*.crate     (binaire, meme format
                                               que la base V2)
     rekordbox le noeud <PLAYLISTS> de l'export XML
     Traktor   les <PLAYLIST> de collection.nml
     iTunes    le bloc <key>Playlists</key> du plist
     dossiers  le premier niveau sous le dossier de musique

   Rien n'est importe : on relit les memes fichiers que la
   bibliotheque, au meme endroit.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');

const unesc = s => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d));

/* Un identifiant lisible et stable, derive du nom. */
function slug(s) {
  return String(s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'liste';
}

/* Une cle de chemin robuste : c'est le seul lien entre une liste et la
   bibliotheque quand le logiciel ne donne pas d'identifiant. Serato
   ecrit des chemins sans slash initial, rekordbox des URL encodees,
   Traktor des « /: » a la place des « / ». On compare donc sur les
   deux derniers segments, en minuscules. */
function pathKey(p) {
  if (!p) return '';
  let s = String(p).replace(/\\/g, '/');
  try { if (s.indexOf('file://') === 0) s = decodeURIComponent(s.replace(/^file:\/\/(localhost)?/, '')); } catch (e) {}
  s = s.replace(/\/:/g, '/');
  const parts = s.split('/').filter(Boolean);
  return parts.slice(-2).join('/').toLowerCase();
}

/* ---------- Serato : _Serato_/Subcrates/*.crate ---------- */
/* Meme grammaire que la base V2 : [tag 4o][longueur 4o BE][corps].
   Les pistes d'une crate sont des conteneurs « otrk » contenant un
   champ « ptrk » : le chemin, en UTF-16 big endian. */
function seratoCrateFiles() {
  const out = [];
  for (const b of [path.join(os.homedir(), 'Music'), path.join(os.homedir(), 'Musique'), path.join(os.homedir(), 'Musik')]) {
    const d = path.join(b, '_Serato_', 'Subcrates');
    let list = [];
    try { list = fs.readdirSync(d); } catch (e) { continue; }
    for (const f of list) if (/\.crate$/i.test(f)) out.push(path.join(d, f));
  }
  return out;
}

function readSeratoCrate(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  const paths = [];
  let i = 0;
  while (i + 8 <= buf.length) {
    const tag = buf.toString('ascii', i, i + 4);
    const len = buf.readUInt32BE(i + 4);
    const a = i + 8, b = a + len;
    if (len < 0 || b > buf.length) break;
    if (tag === 'otrk') {
      /* on descend d'un cran chercher le ptrk */
      let j = a;
      while (j + 8 <= b) {
        const t2 = buf.toString('ascii', j, j + 4);
        const l2 = buf.readUInt32BE(j + 4);
        const a2 = j + 8, b2 = a2 + l2;
        if (l2 < 0 || b2 > b) break;
        if (t2 === 'ptrk') {
          let s = '';
          for (let k = a2; k + 1 < b2; k += 2) {
            const c = (buf[k] << 8) | buf[k + 1];
            if (c) s += String.fromCharCode(c);
          }
          if (s) paths.push(s.trim());
        }
        j = b2;
      }
    }
    i = b;
  }
  /* « Soirees%%Mariage.crate » est la sous-crate Mariage de Soirees */
  const name = path.basename(file, '.crate').split('%%').join(' / ');
  return { name: name, source: 'Serato', paths: paths };
}

/* ---------- rekordbox : <PLAYLISTS> de l'export XML ---------- */
/* Les noeuds y sont imbriques ; chaque piste est une reference
   <TRACK Key="123"/> vers l'identifiant du <COLLECTION>. */
function readRekordboxPlaylists(file) {
  let xml;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const start = xml.indexOf('<PLAYLISTS>');
  if (start < 0) return [];
  const body = xml.slice(start, xml.indexOf('</PLAYLISTS>', start) + 12);

  const out = [];
  const stack = [];
  /* un seul balayage : on suit l'ouverture et la fermeture des noeuds
     pour reconstituer le chemin « Dossier / Sous-dossier / Liste » */
  const re = /<NODE\b([^>]*?)(\/?)>|<\/NODE>|<TRACK\s+Key="([^"]+)"/g;
  let m, cur = null;
  while ((m = re.exec(body))) {
    if (m[0] === '</NODE>') { stack.pop(); cur = null; continue; }
    if (m[3]) { if (cur) cur.rbIds.push(m[3]); continue; }
    const at = m[1] || '';
    const nm = unesc((at.match(/Name="([^"]*)"/) || [])[1] || '');
    const type = (at.match(/Type="(\d)"/) || [])[1];
    const selfClosed = m[2] === '/';
    if (type === '1') {                       /* 1 = liste de morceaux */
      /* le noeud racine s'appelle toujours ROOT : ce n'est pas un dossier
         du DJ, on ne le montre pas dans le nom de la liste */
      const chemin = stack.filter(x => x && x !== 'ROOT').concat(nm).filter(Boolean);
      cur = { name: chemin.join(' / '), source: 'rekordbox', rbIds: [], paths: [] };
      out.push(cur);
      if (selfClosed) cur = null;
    } else {                                  /* 0 = dossier */
      if (!selfClosed) stack.push(nm);
      cur = null;
    }
  }
  return out.filter(c => c.rbIds.length);
}

/* ---------- Traktor : <PLAYLIST> de collection.nml ---------- */
function readTraktorPlaylists(file) {
  let xml;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const start = xml.indexOf('<PLAYLISTS>');
  if (start < 0) return [];
  const body = xml.slice(start);
  const out = [];
  const re = /<NODE\s+TYPE="PLAYLIST"\s+NAME="([^"]*)"[\s\S]*?<\/NODE>/g;
  let m;
  while ((m = re.exec(body))) {
    const paths = [];
    const pr = /PRIMARYKEY\s+TYPE="TRACK"\s+KEY="([^"]*)"/g;
    let p;
    while ((p = pr.exec(m[0]))) paths.push(unesc(p[1]).replace(/\/:/g, '/'));
    if (paths.length) out.push({ name: unesc(m[1]), source: 'Traktor', paths: paths });
  }
  return out;
}

/* ---------- iTunes : le bloc Playlists du plist ---------- */
function readITunesPlaylists(file) {
  let xml;
  try { xml = fs.readFileSync(file, 'utf8'); } catch (e) { return []; }
  const start = xml.indexOf('<key>Playlists</key>');
  if (start < 0) return [];
  const body = xml.slice(start);
  const out = [];
  /* chaque playlist est un <dict> de premier niveau du tableau */
  const re = /<dict>([\s\S]*?)<\/dict>\s*(?=<dict>|<\/array>)/g;
  let m;
  while ((m = re.exec(body))) {
    const d = m[1];
    if (/<key>Distinguished Kind<\/key>/.test(d)) continue;   /* listes systeme */
    if (/<key>Master<\/key>\s*<true/.test(d)) continue;
    const nm = (d.match(/<key>Name<\/key>\s*<string>([^<]*)<\/string>/) || [])[1];
    if (!nm) continue;
    const ids = [];
    const ir = /<key>Track ID<\/key><integer>(\d+)<\/integer>/g;
    let x;
    while ((x = ir.exec(d))) ids.push(x[1]);
    if (ids.length) out.push({ name: unesc(nm), source: 'iTunes', itIds: ids, paths: [] });
  }
  return out;
}

/* ---------- dossiers ---------- */
/* Quand la bibliotheque vient d'un dossier scanne, les sous-dossiers
   du premier niveau font office de crates : c'est exactement ainsi
   que rangent les DJs qui n'utilisent pas les listes du logiciel. */
function fromFolders(library) {
  const byDir = new Map();
  for (const t of library) {
    if (!t.path) continue;
    const dir = path.dirname(t.path);
    const nm = path.basename(dir);
    if (!nm || nm === '.') continue;
    if (!byDir.has(nm)) byDir.set(nm, []);
    byDir.get(nm).push(t.id);
  }
  const out = [];
  for (const [nm, ids] of byDir) if (ids.length >= 5) out.push({ name: nm, source: 'Dossier', ids: ids });
  return out;
}

/**
 * Lit toutes les listes disponibles et les rattache a la bibliotheque.
 * @param {Array} sources les sources retenues (meme objets que autolibrary.detect)
 * @param {Array} library les morceaux finalises (avec id)
 * @returns {Array} [{ id, name, source, ids:number[], n }]
 */
function readAll(sources, library) {
  const brut = [];
  const kinds = new Set((sources || []).map(s => s.kind));

  if (kinds.has('serato')) for (const f of seratoCrateFiles()) {
    const c = readSeratoCrate(f);
    if (c && c.paths.length) brut.push(c);
  }
  for (const s of sources || []) {
    if (s.kind === 'rekordbox') brut.push.apply(brut, readRekordboxPlaylists(s.path));
    else if (s.kind === 'traktor') brut.push.apply(brut, readTraktorPlaylists(s.path));
    else if (s.kind === 'itunes') brut.push.apply(brut, readITunesPlaylists(s.path));
  }

  /* index de la bibliotheque : par chemin, par identifiant rekordbox,
     par identifiant iTunes */
  const byPath = new Map(), byRb = new Map(), byIt = new Map();
  for (const t of library) {
    const k = pathKey(t.path);
    if (k && !byPath.has(k)) byPath.set(k, t.id);
    if (t.rbId != null) byRb.set(String(t.rbId), t.id);
    if (t.itId != null) byIt.set(String(t.itId), t.id);
  }

  const out = [];
  for (const c of brut) {
    const ids = [];
    const seen = new Set();
    const push = id => { if (id != null && !seen.has(id)) { seen.add(id); ids.push(id); } };
    for (const p of c.paths || []) push(byPath.get(pathKey(p)));
    for (const r of c.rbIds || []) push(byRb.get(String(r)));
    for (const i of c.itIds || []) push(byIt.get(String(i)));
    /* Une liste dont on ne retrouve presque rien pointe une bibliotheque
       qu'on ne lit pas : l'afficher donnerait un filtre qui vide le
       widget. On juge sur la proportion retrouvee, pas sur le nombre —
       sinon une crate de deux titres, parfaitement valide, disparait
       tandis qu'une crate de cinq cents dont on retrouve trois reste. */
    const total = (c.paths || []).length + (c.rbIds || []).length + (c.itIds || []).length;
    if (ids.length >= 2 && ids.length / Math.max(1, total) >= 0.25)
      out.push({ name: c.name, source: c.source, ids: ids });
  }

  if (!out.length) for (const f of fromFolders(library)) out.push({ name: f.name, source: f.source, ids: f.ids });

  /* L'identifiant doit survivre a une relecture : le DJ choisit sa liste
     dans les reglages, puis Serato reecrit ses fichiers et l'ordre change.
     Un numero de rang designerait alors une autre liste, en silence. On le
     derive donc du nom et de la source, qui ne bougent pas. */
  const vus = new Set();
  return out
    .sort((a, b) => b.ids.length - a.ids.length)
    .slice(0, 60)
    .map(c => {
      let id = 'c_' + slug(c.source + '_' + c.name);
      let n = 2;
      while (vus.has(id)) id = 'c_' + slug(c.source + '_' + c.name) + '_' + (n++);
      vus.add(id);
      return { id: id, name: c.name, source: c.source, ids: c.ids, n: c.ids.length };
    });
}

module.exports = { readAll, pathKey, readSeratoCrate, readRekordboxPlaylists,
                   readTraktorPlaylists, readITunesPlaylists, fromFolders, seratoCrateFiles };
