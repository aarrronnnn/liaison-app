'use strict';
/* ============================================================
   Lecture de la base Serato (_Serato_/database V2).
   Format public : suite de chunks [tag 4o][longueur 4o BE][corps].
   Le type du champ est donne par la premiere lettre du tag :
     o,r = conteneur | t,p = texte UTF-16BE | s = int16 | u = uint32 | b = octet
   ============================================================ */
const fs = require('fs');
/* La tonalite doit etre convertie en notation Camelot, comme pour
   rekordbox, Traktor et VirtualDJ. Sans ca, un DJ qui affiche ses
   tonalites en notation classique (« Am », « F#m ») donne au moteur
   des valeurs qu'il ne sait pas comparer : le critere d'harmonie —
   le plus lourd des six, 0,27 — rend alors 50 pour TOUTES les paires,
   c'est-a-dire « je ne sais pas ». Le classement perd son premier
   critere sans que rien ne le signale. */
const { toCamelot } = require('./library');

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

/* ============================================================
   OU VIT REELLEMENT LE FICHIER QUE SERATO DESIGNE.

   Serato ecrit ses chemins SANS la racine du volume : la base de
   D:\_Serato_ contient « Music/x.mp3 », pas « D:\Music\x.mp3 ».
   buildTestDatabase ci-dessous le montre, il retire le premier
   slash — c'est bien la convention du format.

   Ce module rendait donc, sur Windows, un chemin RELATIF. Aucun
   fichier ne repondait, l'elagage « fichier introuvable » faisait
   son travail, et la bibliotheque tombait a zero. Symptome cote
   DJ : « 0 titres prets » avec deux bases Serato correctement
   detectees juste en dessous — et, dans la foulee, chaque morceau
   pose sur le deck annonce comme hors bibliotheque, puisqu'il n'y
   a plus de bibliotheque a laquelle le rapprocher.

   Sur macOS, « / » + chemin tombait juste par chance tant que la
   base etait celle du disque de demarrage. Pour une base posee sur
   un SSD externe — c'est-a-dire le cas normal en soiree — elle
   designait /Music/x.mp3 au lieu de /Volumes/SSD/Music/x.mp3, et
   se trompait exactement de la meme facon.

   La regle est une et la meme partout : le chemin est relatif a la
   RACINE DU VOLUME QUI PORTE LA BASE.
   ============================================================ */
const path = require('path');

/** La racine du volume qui porte ce fichier de base. */
function racineDuVolume(fichier, plateforme) {
  const win = (plateforme || process.platform) === 'win32';
  const f = String(fichier || '');
  if (win) {
    const m = /^([A-Za-z]:)[\\/]/.exec(f);
    return m ? m[1] + '\\' : '';
  }
  /* Un volume monte : /Volumes/<nom>, /media/<user>/<nom>, /mnt/<nom> */
  let m = /^(\/Volumes\/[^/]+)(?=\/)/.exec(f)
       || /^(\/media\/[^/]+\/[^/]+)(?=\/)/.exec(f)
       || /^(\/mnt\/[^/]+)(?=\/)/.exec(f);
  return m ? m[1] : '';
}

/* Un chemin deja absolu — certaines versions en ecrivent — se
   reconnait et ne se touche pas. */
function estAbsolu(p, win) {
  return win ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/');
}

/**
 * Le chemin reel du morceau.
 *
 * On ne DEVINE pas : on propose les interpretations possibles et on
 * garde celle qui designe un fichier existant. Si aucune ne repond
 * — disque debranche, par exemple — on rend la plus probable, pour
 * que l'elagage puisse faire la difference entre « efface » et
 * « hors ligne » comme il sait le faire.
 *
 * @param {string} p chemin tel que Serato l'ecrit
 * @param {string} base racine du volume portant la base
 * @param {{plateforme?:string, existe?:Function}} opt injection pour les essais
 */
function resoudre(p, base, opt) {
  opt = opt || {};
  const plateforme = opt.plateforme || process.platform;
  const win = plateforme === 'win32';
  const existe = opt.existe || (x => { try { return fs.statSync(x).isFile(); } catch (e) { return false; } });
  if (estAbsolu(p, win)) return p;

  const sep = win ? '\\' : '/';
  const nu = p.replace(/^[\\/]+/, '');
  const candidats = [];
  if (base) candidats.push(base.replace(/[\\/]+$/, '') + sep + nu.replace(/\//g, sep));
  if (!win) candidats.push('/' + nu);              /* le disque de demarrage */
  for (const c of candidats) if (existe(c)) return c;
  return candidats[0] || p;
}

/** @returns {Array} morceaux de la bibliotheque Serato */
function parseDatabase(file, opt) {
  const buf = fs.readFileSync(file);
  const base = (opt && opt.base !== undefined) ? opt.base : racineDuVolume(file, opt && opt.plateforme);
  const out = [];
  for (const c of readChunks(buf, 0, buf.length)) {
    if (c.tag !== 'otrk') continue;
    const t = parseTrack(buf, c.start, c.end);
    const p = t.pfil || '';
    if (!p) continue;
    out.push({
      path: resoudre(p, base, opt),
      title: t.tsng || '',
      artist: t.tart || '',
      genre: t.tgen || '',
      bpm: parseFloat(String(t.tbpm || '0').replace(',', '.')) || 0,
      key: toCamelot(t.tkey) || null,
      /* Serato analyse le fichier a l'import : grille de temps et
         tonalite viennent d'un vrai calcul, pas d'une saisie. */
      bpmSrc: 'serato', keySrc: 'serato',
      duration: parseLen(t.tlen),
      /* Serato la stocke depuis toujours, sous « ttyr ». Elle n'etait
         pas relue : un DJ Serato perdait l'axe des epoques — donc le
         mode bulle — sur toute sa bibliotheque. finalize() se charge
         de refuser les valeurs aberrantes. */
      year: t.ttyr || null,
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
      chunk('tlen', encodeText(t.len || '05:20')),
      chunk('ttyr', encodeText(t.year ? String(t.year) : ''))
    ]);
    parts.push(chunk('otrk', fields));
  }
  return Buffer.concat(parts);
}

module.exports = { parseDatabase, buildTestDatabase, readChunks, readText,
                   racineDuVolume, resoudre };
