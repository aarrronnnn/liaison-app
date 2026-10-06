'use strict';
/* Serato DJ Pro — le fichier de session de l'historique est ecrit en direct.
   On lit la fin du fichier et on extrait les chaines UTF-16BE :
   le rapprochement avec la bibliotheque fait le reste. */
const fs = require('fs');
const path = require('path');
const os = require('os');

function sessionsDir(custom) {
  if (custom) return custom;
  /* Musique peut etre redirige (OneDrive, autre disque) : on prend
     le premier dossier ou Serato a vraiment ecrit son historique. */
  const cands = require('../volumes').dossiersMusique().map(m => path.join(m, '_Serato_', 'History', 'Sessions'));
  return cands.find(d => { try { return fs.existsSync(d); } catch (e) { return false; } })
      || path.join(os.homedir(), 'Music', '_Serato_', 'History', 'Sessions');
}

/* ------------------------------------------------------------
   Chercher le fichier le plus recent, sans balayer le dossier
   toutes les secondes et demie.

   newest() faisait un readdirSync PLUS un statSync par fichier, a
   chaque tour de boucle, toute la nuit, sur le fil du widget. Un
   resident accumule des centaines de tracklists ou de sessions en
   deux ans : plusieurs centaines de statSync toutes les 1,5 s.

   La date du DOSSIER change des qu'un fichier y est cree ou
   renomme. On ne relit donc la liste que dans ce cas ; le reste du
   temps, un seul statSync sur le dossier suffit.
   ------------------------------------------------------------ */
let _cacheDossier = { dir: null, mtime: 0, best: null, a: 0 };

function newest(dir) {
  try {
    const d = fs.statSync(dir);
    const memeDossier = _cacheDossier.dir === dir;
    /* Rien n'a bouge et on a regarde il y a moins de 30 s : on garde. */
    if (memeDossier && d.mtimeMs === _cacheDossier.mtime && Date.now() - _cacheDossier.a < 30000)
      return _cacheDossier.best;
    _cacheDossier = { dir: dir, mtime: d.mtimeMs, best: null, a: Date.now() };
  } catch (e) { return null; }

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
  /* Sans cette ligne, le cache rendait null pendant les 30 s qui
     suivent chaque relecture du dossier : le tour de boucle
     s'arretait net, et le morceau pose sur la platine n'etait lu
     qu'au releve suivant — jusqu'a une demi-minute de retard
     (audit du 6 octobre 2026). virtualdj.js le faisait deja. */
  _cacheDossier.best = best;
  return best;
}

/* ============================================================
   LES TEXTES DE L'HISTORIQUE.

   Une session Serato est faite de blocs « oent » qui contiennent un
   bloc « adat » ; dans celui-ci, chaque champ s'ecrit identifiant
   (4 octets) + longueur (4 octets) + valeur, les textes en UTF-16
   gros-boutiste, les dates et les numeros en entiers de 4 octets,
   certains drapeaux sur UN octet.

   La lecture d'origine balayait le tampon deux octets par deux
   octets et gardait les suites de caracteres LATINS. Audit du
   5 octobre 2026, trois defauts :

     — un titre cyrillique, arabe, grec, coreen ou japonais etait
       coupe a la premiere lettre : il n'arrivait jamais au moteur ;
     — l'octet bas de la LONGUEUR du champ, quand il tombe sur une
       lettre (titre de 33 a 61 caracteres), se collait devant le
       premier mot : « hMr. Brightside… » ;
     — un drapeau d'un octet decale tout ce qui suit d'un octet, et
       un balayage par paires lit alors des caracteres faux.

   On lit donc la STRUCTURE quand elle est la : on cherche les blocs
   « oent » octet par octet (le decalage ne gene plus), on suit les
   longueurs, et on garde les champs qui se lisent comme du texte.
   Le sens des identifiants n'est pas utilise : l'ordre et le choix
   des textes restent ceux d'avant, seulement entiers et justes.
   Si la structure n'est pas reconnue (format futur), l'ancien
   balayage reprend, elargi aux autres ecritures.
   ============================================================ */
function lettre(c) {
  return c === 32 || (c >= 0x21 && c <= 0x24f) || (c >= 0x2018 && c <= 0x201d) ||
         (c >= 0x370 && c <= 0x52f) ||                   /* grec, cyrillique */
         (c >= 0x590 && c <= 0x5ff) ||                   /* hebreu */
         (c >= 0x600 && c <= 0x6ff) || (c >= 0x750 && c <= 0x77f) ||   /* arabe */
         (c >= 0xe00 && c <= 0xe7f) ||                   /* thai */
         (c >= 0x1e00 && c <= 0x1eff) ||                 /* latin etendu (vietnamien) */
         (c >= 0x3040 && c <= 0x30ff) ||                 /* kana */
         (c >= 0x4e00 && c <= 0x9fff) ||                 /* han */
         (c >= 0xac00 && c <= 0xd7a3);                   /* hangul */
}

/* Un champ qui se lit comme du texte UTF-16BE, ou null. */
function texteDe(buf, debut, fin) {
  if ((fin - debut) % 2 || fin <= debut) return null;
  let s = '';
  for (let i = debut; i + 1 < fin; i += 2) {
    const c = (buf[i] << 8) | buf[i + 1];
    if (c === 0) { if (i + 2 >= fin) break; return null; }   /* zero final toléré */
    if (c >= 0xd800 && c <= 0xdbff) {                        /* emoji : une paire complete */
      const d = i + 3 < fin ? (buf[i + 2] << 8) | buf[i + 3] : 0;
      if (d < 0xdc00 || d > 0xdfff) return null;
      s += String.fromCharCode(c, d); i += 2; continue;
    }
    if (c < 0x20 || (c >= 0x7f && c < 0xa0) || (c >= 0xdc00 && c <= 0xdfff) || c === 0xfffe || c === 0xffff) return null;
    s += String.fromCharCode(c);
  }
  return s;
}

/* Les champs texte des blocs « oent » > « adat ». coherent : au moins
   un bloc lu de bout en bout, champ apres champ — la preuve que la
   structure est bien celle qu'on croit. */
function champs(buf, min) {
  const out = [];
  let coherent = false;
  let i = buf.indexOf('oent', 0, 'latin1');
  while (i >= 0 && i + 16 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    const finE = Math.min(buf.length, i + 8 + len);
    const j = i + 8;
    if (buf.toString('latin1', j, j + 4) === 'adat') {
      const finA = Math.min(finE, j + 8 + buf.readUInt32BE(j + 4));
      let k = j + 8;
      const lus = [];
      while (k + 8 <= finA) {
        const l = buf.readUInt32BE(k + 4);
        if (l > finA - (k + 8)) break;                       /* champ tronque : bloc en cours d'ecriture */
        const t = texteDe(buf, k + 8, k + 8 + l);
        if (t != null && t.trim().length >= min) lus.push(t.trim());
        k += 8 + l;
      }
      if (k === finA && finA === j + 8 + buf.readUInt32BE(j + 4)) coherent = true;
      out.push(...lus);
    }
    i = buf.indexOf('oent', Math.max(i + 4, finE), 'latin1');
  }
  return { textes: out, coherent: coherent };
}

/* L'ancien balayage, par paires d'octets — le repli. */
function balayage(buf, min) {
  const out = [];
  let cur = '';
  const pousser = () => {
    let s = cur;
    /* l'octet bas d'une longueur colle devant le texte : il vaut
       exactement la longueur, en octets, de ce qui suit */
    if (s.length > 1) {
      const c = s.charCodeAt(0), reste = s.length - 1;
      if (c === reste * 2 || c === (reste + 1) * 2) s = s.slice(1);
    }
    if (s.trim().length >= min) out.push(s.trim());
    cur = '';
  };
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = (buf[i] << 8) | buf[i + 1];
    if (lettre(code)) cur += String.fromCharCode(code);
    else pousser();
  }
  pousser();
  return out;
}

/* Extrait les chaines UTF-16BE lisibles d'un buffer binaire. */
function strings(buf, min) {
  min = min || 4;
  const c = champs(buf, min);
  if (c.coherent && c.textes.length) return c.textes;
  return balayage(buf, min);
}

function start(opts, cb) {
  const dir = sessionsDir(opts.dir);
  let file = newest(dir);
  let lastSize = 0, lastText = '';
  if (!file) cb.onStatus({ ok: false, msg: 'Aucune session Serato trouvée dans ' + dir });
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

module.exports = { start, sessionsDir, strings, newest };
