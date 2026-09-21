'use strict';
/* ============================================================
   Liaison — import et analyse de bibliotheque.
   Deux sources : rekordbox.xml (BPM/tonalite deja calcules)
   ou un dossier de musique (tags lus par ffprobe + analyse locale).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const { analyze, ffmpegPath } = require('./analyze');

const AUDIO = new Set(['.mp3', '.wav', '.aiff', '.aif', '.flac', '.m4a', '.aac', '.ogg', '.wma']);

/* ============================================================
   D'OU VIENT CE CHIFFRE, ET COMBIEN IL VAUT.

   « Liaison me donne des donnees fausses sur les sons. Pour lui,
     Mamma Mia est a 105 BPM alors que c'est un son a 130. »

   Un 105 sur un morceau a 130 n'est ni un demi ni un double : ce
   n'est pas une erreur d'octave, c'est un chiffre faux. Et un
   chiffre faux, dans une bibliotheque de DJ, a presque toujours
   la meme origine : un champ BPM tape a la main ou devine par un
   logiciel qui n'a jamais analyse le fichier. iTunes en est plein
   — le champ existe depuis vingt ans, il se remplit a la main,
   personne ne le corrige. Les tags ID3 d'un MP3 achete en ligne
   aussi.

   Jusqu'ici Liaison ne faisait pas la difference : un BPM etait
   un BPM, et le dernier arrive gagnait. Or ces sources ne se
   valent pas du tout :

     FORT (3) — rekordbox, Serato, Traktor, VirtualDJ. Ces
       logiciels ont ANALYSE le fichier pour poser une grille de
       temps ; le DJ mixe sur cette grille, ses points de repere
       sont cales dessus. Les contredire serait lui mentir, meme
       si notre mesure etait meilleure.

     MESURE (2) — Liaison. Un calcul, pas une saisie. Il vaut
       mieux qu'un champ rempli a la main, moins qu'une grille sur
       laquelle un DJ a deja travaille.

     FAIBLE (1) — iTunes, tags ID3. Un champ de texte. Il comble
       un trou, il ne fait autorite sur rien.

   C'est cette echelle qui repond a Mamma Mia : le 105 vient d'un
   champ faible, notre mesure est forte de sa confiance, elle
   passe devant. Et si demain rekordbox annonce 130, c'est lui qui
   gagne, meme contre nous.
   ============================================================ */
const FIABILITE = { rekordbox: 3, serato: 3, traktor: 3, virtualdj: 3,
                    liaison: 2, 'liaison-incertain': 1, itunes: 1, tag: 1 };
const fiabilite = src => FIABILITE[src] || 1;

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
/* ============================================================
   TOUTES LES FACONS D'ECRIRE UNE TONALITE.

   « Il ne donne jamais et n'affiche jamais la cle des musiques. »

   Une partie des « ? » ne venait pas d'un tag manquant : elle
   venait d'un tag qu'on ne savait pas LIRE. La version precedente
   comprenait le Camelot et la notation anglo-saxonne collee
   (« Am », « F#m »), et rendait null pour tout le reste. Ce
   « reste » represente des bibliotheques entieres :

     — la NOTATION OUVERTE (Open Key) de Mixed In Key : « 1m »,
       « 12d ». Des dizaines de milliers de DJ l'utilisent, et
       c'est meme le reglage par defaut de MIK depuis des annees.
       Elle ne ressemble pas au Camelot et s'en decale de sept
       crans : 1m vaut 8A, 1d vaut 8B.
     — les suffixes d'energie que MIK colle au tag : « 8A - Energy 7 ».
     — les formes espacees et longues : « A min », « A minor »,
       « Db Major », « A-Flat Minor ».
     — le Camelot a zero devant : « 08A ».

   Chacune de ces formes coutait une tonalite par morceau, donc un
   axe harmonique muet sur toute la bibliotheque.

   Ce qu'on refuse toujours de faire : deviner. Une chaine qu'on ne
   reconnait pas rend null, et c'est l'analyse qui prendra le
   relais — pas une interpretation au hasard.
   ============================================================ */
/* Open Key -> Camelot : 1 devient 8, 6 devient 1, 12 devient 7. */
function ouverteVersCamelot(n, mode) {
  if (!(n >= 1 && n <= 12)) return null;
  return (((n + 6) % 12) + 1) + (mode === 'm' ? 'A' : 'B');
}

function toCamelot(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;

  /* Mixed In Key colle son niveau d'energie au tag : « 8A - Energy 7 ».
     On retire CE suffixe-la, nommement — couper au premier tiret
     rendait « A-Flat Minor » en « A », soit la mauvaise tonalite
     affichee avec assurance. */
  s = s.replace(/\s*[-–—|/]?\s*energy\s*:?\s*\d+\s*$/i, '')
       .replace(/\s*\([^)]*\)\s*$/, '')
       .trim();
  s = s.replace(/♯/g, '#').replace(/♭/g, 'b');

  /* deja Camelot, zero devant admis */
  let m = s.match(/^0?(\d{1,2})\s*([ABab])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 12) return n + m[2].toUpperCase();
    return null;
  }

  /* notation ouverte : « 1m » mineur, « 1d » majeur */
  m = s.match(/^0?(\d{1,2})\s*([dmDM])$/);
  if (m) return ouverteVersCamelot(parseInt(m[1], 10), m[2].toLowerCase() === 'm' ? 'm' : 'd');

  /* notation anglo-saxonne, sous toutes ses coutures */
  let x = s.toLowerCase()
    .replace(/\bflat\b/g, 'b').replace(/\bsharp\b/g, '#')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  /* Pas de \b devant le « m » : dans « Am » il n'y a pas de frontiere
     de mot entre la note et le mode, et c'est justement la forme la
     plus repandue. On teste donc les mots longs d'abord, puis le m
     colle. */
  let mineur = null;
  if (/(\s*(min|minor|moll|mineur)|m)$/.test(x)) { mineur = true; x = x.replace(/(\s*(min|minor|moll|mineur)|m)$/, ''); }
  else if (/(\s*(maj|major|dur|majeur))$/.test(x)) { mineur = false; x = x.replace(/(\s*(maj|major|dur|majeur))$/, ''); }
  x = x.replace(/\s+/g, '');
  if (!/^[a-g](#|b)?$/.test(x)) return null;
  const note = x.charAt(0).toUpperCase() + x.slice(1);
  return CAMELOT[note + (mineur ? 'm' : '')] || null;
}

const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

/* ---------- rekordbox.xml ---------- */
function parseRekordboxXML(xmlPath) {
  /* Le message brut d'ENOENT ne dit rien a un DJ. Celui-ci dit ce qui
     s'est passe et ce qu'il faut faire. */
  let xml;
  try { xml = fs.readFileSync(xmlPath, 'utf8'); }
  catch (e) {
    throw new Error('Impossible de lire ' + xmlPath +
      ' — le fichier a peut-etre ete deplace ou renomme. Reexporte ta collection depuis rekordbox, ' +
      'ou choisis le nouveau chemin dans les reglages.');
  }
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
      /* rekordbox a analyse le fichier pour poser sa grille : c'est
         la source la plus forte qui existe pour ces deux champs. */
      bpmSrc: 'rekordbox', keySrc: 'rekordbox',
      duration: num(attrs.TotalTime),
      /* L'annee etait dans l'export depuis toujours, on ne la lisait
         pas. C'est elle qui permet a une soiree annees 80 de rester
         dans les annees 80 — voir bulle.js. */
      year: anneeTag(attrs.Year),
      /* rekordbox n'a pas de champ « annee d'origine » : une
         reedition y porte l'annee de sa reedition. On ne peut pas la
         corriger, mais on peut refuser de s'y fier. */
      anneeIncertaine: estReedition({ title: attrs.Name, album: attrs.Album }),
      pop: Math.min(100, 30 + num(attrs.PlayCount) * 6 + num(attrs.Rating) / 51 * 20)
    });
  }
  return out;
}

/* ---------- scan de dossier ---------- */
/* On ne peut pas distinguer « dossier vide » de « dossier illisible »
   avec un tableau vide. Or la difference est enorme : dans le premier
   cas il faut oublier les fichiers disparus, dans le second il faut
   surtout ne rien toucher. walk() note donc ses echecs. */
function walk(dir, acc, depth, echecs) {
  depth = depth || 0;
  if (depth > 8) return acc;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { if (echecs) echecs.push(dir); return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc, depth + 1, echecs);
    else if (AUDIO.has(path.extname(e.name).toLowerCase())) acc.push(p);
  }
  return acc;
}

function ffprobePath() {
  if (process.env.LIAISON_FFPROBE) return process.env.LIAISON_FFPROBE;
  try {
    let p = require('ffprobe-static');
    if (p && p.path) p = p.path;
    if (p) return String(p).replace('app.asar', 'app.asar.unpacked');
  } catch (e) {}
  return 'ffprobe';
}

/* ============================================================
   FFPROBE PEUT ETRE LA SANS POUVOIR TOURNER.

   ffprobe-static 3.1.0 — la derniere version publiee — livre dans
   bin/darwin/arm64/ un binaire qui est en realite du x86_64.
   Verifie sur l'archive npm officielle, ce n'est donc pas une
   installation abimee : le paquet est faux.

   Sur un Mac Apple Silicon sans Rosetta, ce fichier existe, son
   chemin se resout, et il refuse de s'executer. spawn emettait
   alors « error », probe() rendait {} — et un morceau sans le
   moindre tag remontait comme si le fichier n'en avait pas. Pas
   d'erreur, pas de message : juste une bibliotheque qui perd ses
   titres, ses artistes, ses genres et ses tonalites.

   ffmpeg-static, lui, livre bien de l'arm64. On a donc toujours un
   lecteur valide sous la main ; il fallait seulement arreter de
   supposer que le premier marche.

   On essaie donc les candidats une fois, pour de vrai (-version),
   et on retient celui qui repond. Si aucun ffprobe ne tourne, on
   lit les tags avec ffmpeg, qui sait le faire.
   ============================================================ */
let _lecteur;                                  /* {mode, bin} decide une fois */

function utilisable(bin, args) {
  try {
    const r = spawnSync(bin, args, { timeout: 5000, stdio: 'ignore' });
    return !r.error && r.status === 0;
  } catch (e) { return false; }
}

/** Quel lecteur de tags marche sur CETTE machine. Decide une seule
    fois : le resultat ne change pas en cours de route. */
function lecteurDeTags() {
  if (_lecteur) return _lecteur;
  const candidats = [];
  if (process.env.LIAISON_FFPROBE) candidats.push(process.env.LIAISON_FFPROBE);
  try {
    let p = require('ffprobe-static');
    if (p && p.path) p = p.path;
    if (p) candidats.push(String(p).replace('app.asar', 'app.asar.unpacked'));
  } catch (e) {}
  candidats.push('ffprobe');                   /* celui du systeme, s'il y en a un */

  for (const bin of candidats) {
    if (utilisable(bin, ['-version'])) { _lecteur = { mode: 'ffprobe', bin: bin }; return _lecteur; }
  }
  /* Aucun ffprobe n'a repondu : ffmpeg sait lire les tags aussi. */
  _lecteur = { mode: 'ffmpeg', bin: ffmpegPath() };
  return _lecteur;
}

/** Pour le diagnostic : dire par quoi les tags sont lus, au lieu de
    laisser deviner devant une bibliotheque vide. */
function commentOnLitLesTags() {
  const l = lecteurDeTags();
  return l.mode === 'ffprobe' ? 'ffprobe (' + l.bin + ')'
                              : 'ffmpeg — aucun ffprobe utilisable sur cette machine';
}

/* La duree, telle que ffmpeg l'annonce sur sa sortie d'erreur. */
function dureeDeStderr(txt) {
  const m = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(txt || '');
  if (!m) return 0;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

/* Le format « ffmetadata » : des lignes cle=valeur, un point-virgule
   en tete de commentaire, et l'antislash qui protege le reste. */
function lireFfmetadata(txt) {
  const t = {};
  for (const ligne of String(txt || '').split(/\r?\n/)) {
    if (!ligne || ligne[0] === ';' || ligne[0] === '#') continue;
    const i = ligne.indexOf('=');
    if (i <= 0) continue;
    const k = ligne.slice(0, i).trim().toLowerCase();
    if (k) t[k] = ligne.slice(i + 1).replace(/\\([=;#\\\n])/g, '$1');
  }
  return t;
}

function probeViaFfmpeg(file) {
  return new Promise(resolve => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-i', file, '-f', 'ffmetadata', '-']);
    let out = '', err = '';
    p.stdout.on('data', d => (out += d));
    p.stderr.on('data', d => (err += d));
    p.on('error', () => resolve({}));
    p.on('close', () => {
      try { resolve({ tags: lireFfmetadata(out), duration: dureeDeStderr(err) }); }
      catch (e) { resolve({}); }
    });
  });
}

function probe(file) {
  const l = lecteurDeTags();
  if (l.mode === 'ffmpeg') return probeViaFfmpeg(file);
  return new Promise(resolve => {
    const p = spawn(l.bin, ['-v', 'quiet', '-print_format', 'json',
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

/* ------------------------------------------------------------
   Lecture des tags d'un dossier.

   Chaque fichier demande un ffprobe : quelques dizaines de
   millisecondes, dont l'essentiel est de l'attente de disque, pas
   du calcul. En serie, 22 000 fichiers font une demi-heure d'un
   processeur qui ne fait rien. En parallele par huit, quatre
   minutes — et sur un disque externe, la difference est bien plus
   grande encore.

   Huit et pas trente : au-dela, les processus se disputent la
   tete de lecture et le total remonte.

   ------------------------------------------------------------
   Le cache, et pourquoi il manquait cruellement.

   Le defaut n'etait pas la lenteur du premier scan : c'est qu'il
   n'etait garde nulle part. Fermer l'app, redemarrer la machine,
   ou simplement un scan interrompu au milieu — et les 22 000
   fichiers repartaient de zero. Rapporte par un vrai test : deux
   heures de lecture, un redemarrage, et le compteur repart a
   701 / 22 180. Le travail n'etait pas lent, il etait jete.

   On garde donc ce qu'on a lu, indexe par chemin, avec la taille
   et la date du fichier. Au relancement, un fichier inchange n'est
   pas relu — un stat au lieu d'un ffprobe, soit un rapport de
   l'ordre de mille. Un fichier modifie ou remplace est relu, lui,
   parce que ses tags ont pu changer.

   Et surtout : le cache est ecrit AU FIL DE L'EAU, toutes les 300
   lectures. Un scan interrompu a 40 % reprend a 40 %, jamais a
   zero. C'est la moitie du probleme, et c'est celle qui rendait la
   premiere soiree impossible.
   ------------------------------------------------------------ */

/* Une entree tient en tableau plutot qu'en objet : sur 22 000
   morceaux, les noms de champs repetes pesaient plus que les
   valeurs elles-memes. */
/* La version du cache de tags. A monter des qu'on lit les tags
   AUTREMENT — pas quand on lit d'autres fichiers.

     1 — jusqu'a 1.4.7
     2 — l'annee vient des tags d'origine (TORY, TDOR, originalyear)
         avant ceux de l'edition, et une reedition est marquee
         incertaine. Les entrees de la version 1 portent l'annee du
         pressage : les garder, c'est garder le defaut.
     3 — toCamelot lit la notation ouverte (Mixed In Key), les
         formes longues et espacees, et les suffixes d'energie. Les
         entrees des versions 1 et 2 portent une tonalite VIDE la ou
         le fichier en avait une : les garder, c'est garder les « ? »
         que cette version existe pour faire disparaitre.

   Le cout est une relecture des tags, pas une reanalyse audio :
   quelques minutes sur une grosse bibliotheque, contre plusieurs
   heures pour l'analyse. */
const VERSION_TAGS = 3;

function chargerScanCache(file) {
  if (!file) return { e: {}, sale: false };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && j.v === VERSION_TAGS && j.e) return { e: j.e, sale: false };
  } catch (e) {}
  return { e: {}, sale: false };
}

/* Ecriture atomique : un fichier temporaire puis un renommage.
   Une coupure de courant pendant l'ecriture laisse alors l'ancien
   cache intact au lieu d'un JSON tronque — qui serait jete au
   chargement suivant, et rendrait le cache inutile precisement le
   jour ou il sert. */
function ecrireScanCache(file, e) {
  if (!file) return;
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ v: VERSION_TAGS, e: e }));
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (e2) {}
  }
}

/* Les tags d'annee, tels qu'on les trouve vraiment : « 1983 »,
   « 1983-05-01 », « 2019-04-03T00:00:00Z », « 0 », et parfois une
   chaine vide. On prend les quatre premiers chiffres, et on refuse
   ce qui n'est pas une annee plausible plutot que d'inventer. */
function anneeTag(v) {
  if (v == null) return null;
  const m = String(v).match(/\d{4}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return (n >= 1900 && n <= 2100) ? n : null;
}

/* ============================================================
   L'ANNEE D'UN REMASTER N'EST PAS L'ANNEE DE LA CHANSON.

   « J'ai une version de Daddy Cool mixee en version originale.
     Quand je la mets, l'analyse me propose des morceaux vieillots.
     Si je prends la version remasterisee, ca me propose des
     morceaux actuels — et pourtant c'est la meme chanson. »

   Deux fichiers, une seule chanson, deux annees : 1976 pour le
   pressage d'origine, 2010 pour la reedition. Les tags ne mentent
   pas — ils repondent simplement a une autre question que la
   notre. Nous voulons savoir de quand DATE LA MUSIQUE ; le tag
   « date » dit de quand date CE FICHIER.

   Deux corrections :

     1. on lit d'abord les tags d'annee D'ORIGINE, qui existent
        exactement pour ca : TORY et TDOR en ID3, originaldate et
        originalyear en Vorbis. Quand ils sont la, la question est
        reglee.
     2. quand ils manquent et que le titre ou l'album annonce une
        reedition, on ne fait pas semblant : l'annee est marquee
        INCERTAINE. epoque.js et bulle.js la traitent alors comme
        une annee inconnue — neutre — au lieu de ranger avec
        assurance un disque de 1976 parmi les nouveautes.

   « Ca serait cool de ne pas l'utiliser s'il n'est pas implicite. »
   C'est exactement ce que fait le point 2.
   ============================================================ */
const REEDITION = new RegExp(
  '\\b(' +
  'remaster(ed|ing|ise|isee)?|' +
  'r[ée][ée]dition|reissue|' +
  'anniversary|deluxe|' +
  'version remasteris[ée]e|' +
  'digitally remastered|' +
  'expanded edition|special edition' +
  ')\\b', 'i');

function estReedition(tags) {
  const t = tags || {};
  return REEDITION.test(String(t.title || '') + ' ' + String(t.album || '') +
                        ' ' + String(t.comment || ''));
}

/**
 * L'annee de la MUSIQUE, et si on peut s'y fier.
 * @returns {{an:number|null, incertaine:boolean}}
 */
function anneeDeLaMusique(tags) {
  const t = tags || {};
  /* Les tags qui parlent de l'enregistrement d'origine. */
  const origine = anneeTag(t.originalyear) || anneeTag(t.original_year) ||
                  anneeTag(t.originaldate) || anneeTag(t.original_date) ||
                  anneeTag(t.tory) || anneeTag(t.tdor);
  if (origine) return { an: origine, incertaine: false };

  const edition = anneeTag(t.date) || anneeTag(t.year) ||
                  anneeTag(t.tyer) || anneeTag(t.tdrc);
  if (!edition) return { an: null, incertaine: false };
  return { an: edition, incertaine: estReedition(t) };
}

function empreinte(p) {
  try { const s = fs.statSync(p); return [s.size, Math.round(s.mtimeMs)]; }
  catch (e) { return null; }
}

/**
 * Lit les tags d'un dossier.
 * @param {string} dir
 * @param {function} onProgress  { phase, done, total, caches, neufs }
 * @param {object}   opt         opt.cache = chemin du fichier de cache
 */
async function scanFolder(dir, onProgress, opt) {
  opt = opt || {};
  const cacheFile = opt.cache || null;
  const cache = chargerScanCache(cacheFile).e;

  const echecs = [];
  const files = walk(dir, [], 0, echecs);
  /* Le dossier racine lui-meme est illisible : disque externe non
     branche, dossier renomme, volume demonte. On sort sans rien
     effacer. Le cas s'est deja produit — et l'elagage ci-dessous
     vidait alors le cache, ce qui relancait vingt-deux mille lectures
     ffprobe au rebranchement. Exactement l'accident de deux heures que
     ce cache existe pour eviter. */
  if (echecs.indexOf(dir) === 0 || (!files.length && echecs.length)) {
    if (onProgress) onProgress({ done: 0, total: 0, caches: 0, illisible: dir });
    return [];
  }
  const out = new Array(files.length);
  let curseur = 0, faits = 0, caches = 0, neufs = 0, depuisSauvegarde = 0;
  const PARALLELE = Math.min(8, Math.max(2, files.length));

  const ligne = (f, t, dur) => ({
    path: f,
    title: t.title || path.basename(f, path.extname(f)),
    artist: t.artist || t.album_artist || '',
    genre: t.genre || '',
    bpm: num(t.tbpm || t.bpm || 0),
    key: toCamelot(t.initial_key || t.tkey || t.key),
    /* Un tag ID3 : un champ de texte que personne n'a verifie. */
    bpmSrc: 'tag', keySrc: 'tag',
    duration: dur || 0,
    year: anneeDeLaMusique(t).an,
    anneeIncertaine: anneeDeLaMusique(t).incertaine,
    pop: 40
  });

  function rapporter() {
    if (onProgress) onProgress({ phase: 'lecture', done: faits, total: files.length,
                                 caches: caches, neufs: neufs });
  }

  async function coureur() {
    while (curseur < files.length) {
      const i = curseur++;
      const f = files[i];
      const cle = cleChemin(f);
      const emp = empreinte(f);
      const c = cache[cle];

      /* Deja lu, et le fichier n'a pas bouge : rien a faire. */
      if (c && emp && c[0] === emp[0] && c[1] === emp[1]) {
        /* La neuvieme case — l'annee — est ajoutee EN BOUT, et son
           absence vaut null. Un cache ecrit par la version
           precedente reste donc valide : sans ca, ajouter un champ
           relancait vingt-deux mille lectures ffprobe, soit les
           deux heures que ce cache existe pour eviter. Les fichiers
           relus au fil des modifications gagneront leur annee ;
           les autres s'en passent. */
        out[i] = { path: f, title: c[2], artist: c[3], genre: c[4],
                   bpm: c[5], key: c[6] || null, duration: c[7],
                   bpmSrc: 'tag', keySrc: 'tag',
                   year: c[8] == null ? null : c[8],
                   /* La dixieme case dit si cette annee est celle d'une
                      reedition. Absente, on la rededuit du titre : ca ne
                      coute rien et ca rattrape les caches anciens. */
                   anneeIncertaine: c[9] == null ? estReedition({ title: c[2] }) : !!c[9],
                   pop: 40 };
        caches++;
      } else {
        let info = {};
        try { info = await probe(f); } catch (e) { info = {}; }
        const r = ligne(f, info.tags || {}, info.duration);
        out[i] = r;
        neufs++;
        if (emp) {
          cache[cle] = [emp[0], emp[1], r.title, r.artist, r.genre, r.bpm, r.key, r.duration,
                        r.year, r.anneeIncertaine ? 1 : 0];
          depuisSauvegarde++;
        }
      }

      faits++;
      /* On sauvegarde par paquets : ecrire a chaque fichier
         couterait plus cher que la lecture elle-meme, ne jamais
         ecrire avant la fin ramene le probleme d'origine. */
      if (depuisSauvegarde >= 300) { depuisSauvegarde = 0; ecrireScanCache(cacheFile, cache); }
      if (faits % 25 === 0) rapporter();
    }
  }

  let complet = false;
  try {
    await Promise.all(Array.from({ length: PARALLELE }, coureur));
    complet = true;
  } finally {
    /* Meme si le scan est interrompu, ce qui a ete lu est garde. */
    if (neufs) ecrireScanCache(cacheFile, cache);
  }

  /* ---------- l'entretien du cache ----------
     Un cache qui ne fait que grandir finit par peser plus que ce
     qu'il fait gagner : les morceaux effaces, les cles USB
     debranchees et les dossiers renommes y restent pour toujours.

     On l'elague donc, mais a deux conditions strictes :
       — seulement si le parcours est alle jusqu'au bout, sinon on
         effacerait le travail d'un scan interrompu ;
       — seulement sous le dossier qu'on vient de lire, parce que
         le meme fichier de cache sert a plusieurs sources et
         qu'un disque externe debranche ne doit pas etre oublie
         pour autant. */
  /* Et meme quand la racine repond, on n'elague pas si un sous-dossier
     a echoue : les fichiers qu'il contenait seraient oublies pour rien. */
  if (complet && cacheFile && !echecs.length) {
    const prefixe = cleChemin(dir).replace(/\/+$/, '') + '/';
    const gardes = new Set(files.map(cleChemin));
    let retires = 0;
    for (const cle of Object.keys(cache)) {
      if (cle.indexOf(prefixe) === 0 && !gardes.has(cle)) { delete cache[cle]; retires++; }
    }
    if (retires) ecrireScanCache(cacheFile, cache);
  }

  faits = files.length;
  rapporter();
  return out.filter(Boolean);
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

/* ============================================================
   L'identifiant d'un morceau.

   Il etait le rang dans la liste : 1, 2, 3... Ca marche tant que
   la liste ne bouge pas. Or elle bouge tout le temps — le DJ
   achete un titre, et comme les bases sont triees, le nouveau
   venu s'insere au milieu et decale tous les suivants.

   Consequence, mesuree : un morceau joue mardi soir sous
   l'identifiant 3 devient un autre morceau mercredi. Le « tu l'as
   deja passe » designe le mauvais titre, la liste du client
   protege le mauvais titre, le crate choisi n'est plus le bon,
   et la cloture reservee bloque un morceau au hasard. En silence,
   sans erreur, sans rien dans les journaux.

   L'identifiant est donc calcule a partir du chemin du fichier :
   le meme fichier garde le meme numero d'une soiree a l'autre, et
   d'une version de l'app a la suivante.

   Deux hachages FNV-1a de 32 bits, avec des germes differents,
   combines en un entier de 53 bits — la limite de ce que
   JavaScript compte exactement. Sur 100 000 morceaux, la
   probabilite d'une collision est de l'ordre de 1 sur un
   milliard ; on la traite quand meme, plus bas.
   ============================================================ */
function hash53(s) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
    b ^= c; b = Math.imul(b, 0x85ebca6b) >>> 0;
  }
  /* 21 bits hauts + 32 bits bas = 53 bits, toujours positif */
  return (a % 2097152) * 4294967296 + b;
}

/* ============================================================
   Le chemin, mis a plat.

   Le meme fichier est nomme differemment par chaque logiciel. Pour
   savoir que « le fichier que rekordbox tient ouvert » est « ce
   morceau de la bibliotheque », il faut ramener les deux ecritures
   a une seule. Quatre pieges, tous rencontres pour de vrai :

   1. LES ACCENTS. C'est le plus grave, et le plus invisible.
      macOS ecrit les noms de fichiers en Unicode DECOMPOSE : le
      « é » de « Café » y est stocke comme « e » suivi d'un accent
      combinant. rekordbox et iTunes, eux, stockent la forme
      COMPOSEE, un seul caractere. Les deux s'affichent « Café » a
      l'ecran et sont differents octet pour octet.

      Consequence : tout morceau dont le chemin porte un accent
      etait introuvable. Sur une bibliotheque francaise — Café,
      Éric, Noël, Christine and the Queens — et plus encore sur une
      bibliotheque rangee par iTunes, qui construit les dossiers a
      partir des noms d'artistes, ca represente une part enorme du
      catalogue. Le widget restait « en chargement » sans jamais
      dire pourquoi.

      On ramene donc tout a la forme composee.

   2. LE VOLUME SYSTEME. Depuis Catalina, le disque de demarrage
      est coupe en deux et certains outils rapportent le chemin
      complet : /System/Volumes/Data/Users/... au lieu de /Users/...

   3. /private. /private/var et /var designent le meme dossier.

   4. file://, les antislashs, le « /: » de rekordbox, la casse.
      Ceux-la etaient deja traites.
   ============================================================ */
function cleChemin(p) {
  let x = String(p || '').replace(/\\/g, '/');
  try { if (x.indexOf('file://') === 0) x = decodeURIComponent(x.replace(/^file:\/\/(localhost)?/, '')); } catch (e) {}
  /* ------------------------------------------------------------
     LE SLASH DEVANT LA LETTRE DE LECTEUR.

     Une URL de fichier Windows s'ecrit « file://localhost/C:/... » :
     le slash est exige par la syntaxe des URL, il ne fait pas
     partie du chemin. En le gardant, on fabriquait la cle
     « /c:/users/... » pour une bibliotheque rangee sous
     « c:/users/... » — un seul caractere d'ecart, et le morceau
     annonce sur le deck n'etait jamais rapproche du sien.

     Trouve par le banc multi-plateforme des la premiere execution,
     sur les CINQ formats a la fois : le defaut n'etait pas dans les
     parseurs, il etait ici, dans la comparaison.
     ------------------------------------------------------------ */
  x = x.replace(/^\/([A-Za-z]:)/, '$1');
  x = x.replace(/\/:/g, '/').replace(/\/+/g, '/');
  /* La forme composee, avant la mise en minuscules : c'est ce qui
     reconcilie le disque et les bases des logiciels de mix. */
  try { x = x.normalize('NFC'); } catch (e) {}
  x = x.replace(/^\/System\/Volumes\/Data(?=\/)/i, '');
  x = x.replace(/^\/private(?=\/(var|tmp|etc)\/)/i, '');
  return x.toLowerCase();
}

/* ============================================================
   LE MORCEAU SUPPRIME, ET LES TROIS CHOSES QU'ON CONFONDAIT.

   « J'ai supprime des musiques de ma bibliotheque (iTunes,
     rekordbox, etc) et pourtant, Liaison me les propose toujours
     au mix. »

   Trois causes se cachaient derriere, et une seule reponse
   generale les aurait toutes ratees :

     1. LE FICHIER N'EST PLUS LA. Le DJ l'a mis a la corbeille. La
        base du logiciel, elle, garde souvent l'entree — un export
        rekordbox est une PHOTO, il ne se met pas a jour tout seul.
        Liaison lisait donc une ligne qui ne designe plus rien.

     2. LE VOLUME N'EST PAS LA. Le SSD est debranche. Le fichier
        existe, il est simplement hors de portee ce soir.

     3. LA SOURCE EST PERIMEE. L'export XML date d'avant la
        suppression. Rien ne le trahit, sauf sa date.

   Les cas 1 et 2 se distinguent en une ligne : on regarde si le
   VOLUME qui portait le fichier repond. S'il repond et que le
   fichier manque, il a ete efface — on le sort de la
   bibliotheque, definitivement. S'il ne repond pas, on garde
   tout et on marque « hors ligne » : le disque reviendra.

   Confondre les deux serait cher dans les deux sens. Effacer sur
   un disque debranche, c'est perdre 18 000 titres parce qu'on a
   mis le SSD dans l'autre poche. Garder sur un fichier efface,
   c'est proposer toute la nuit un morceau qui ne se chargera pas.
   ============================================================ */
function volumeDe(p) {
  const x = String(p || '');
  if (process.platform === 'win32') {
    const m = x.match(/^([A-Za-z]:)[\\/]/);
    return m ? m[1] + '\\' : null;
  }
  const m = x.match(/^(\/Volumes\/[^/]+)/) || x.match(/^(\/(?:media|mnt)\/[^/]+)/);
  return m ? m[1] : '/';
}

/**
 * Sort de la bibliotheque ce qui a vraiment disparu, marque ce qui
 * est seulement injoignable.
 * @param {Array} tracks
 * @returns {{gardes:Array, disparus:Array, horsLigne:number}}
 */
function elaguerDisparus(tracks) {
  const volumes = new Map();          /* un test par volume, pas par morceau */
  const volumeRepond = (p) => {
    const v = volumeDe(p);
    if (!v) return true;
    if (volumes.has(v)) return volumes.get(v);
    let ok = true;
    try { ok = fs.existsSync(v); } catch (e) { ok = true; }
    volumes.set(v, ok);
    return ok;
  };

  const gardes = [], disparus = [];
  let horsLigne = 0;
  for (const t of tracks) {
    /* Pas de chemin de fichier — une entree iTunes sans Location,
       par exemple. On ne peut rien verifier, on ne jette rien. */
    if (!t.path || /^[a-z]+:/i.test(t.path) && t.path.indexOf(':\\') < 0 && t.path.charAt(0) !== '/') {
      gardes.push(t); continue;
    }
    let existe = true;
    try { fs.statSync(t.path); }
    catch (e) {
      /* ENOENT seul veut dire « pas la ». Un refus de permission ou
         un disque qui bougonne n'est pas une suppression. */
      existe = e && e.code !== 'ENOENT';
    }
    if (existe) { t.disparu = false; gardes.push(t); continue; }
    if (volumeRepond(t.path)) { t.disparu = true; disparus.push(t); }
    else { t.offline = true; horsLigne++; gardes.push(t); }
  }
  return { gardes: gardes, disparus: disparus, horsLigne: horsLigne };
}

/* ============================================================
   LE MEME MORCEAU, DEUX FOIS DANS LA LISTE.

   « Si un son est a la fois dans la bibliotheque iTunes et dans la
     bibliotheque rekordbox, il faut pas le proposer deux fois. »

   La fusion des sources dedoublonne DEJA — mais par CHEMIN. Elle
   attrape donc le cas ou les deux logiciels pointent le meme
   fichier, ce qui est le cas le plus frequent et le plus facile.

   Elle ne peut rien contre l'autre : deux FICHIERS differents qui
   portent la meme chanson. Et celui-la est partout :

     — iTunes copie les morceaux dans son propre dossier media,
       pendant que rekordbox garde l'original dans Telechargements ;
     — le DJ a racheté un titre en meilleure qualite sans effacer
       l'ancien ;
     — un fichier vit sur le disque interne et sa copie sur le SSD.

   Deux chemins, deux entrees, et la meme chanson proposee deux
   fois de suite — ce qui, en cabine, ressemble a un bug et rien
   d'autre.

   On regroupe donc par ARTISTE + TITRE mis a plat ET par DUREE, la
   meme regle que l'ecran de sante. La duree est ce qui protege du
   faux positif : un radio edit et une version longue portent le
   meme nom et ne durent pas pareil, et ils doivent rester deux
   morceaux distincts.

   Dans chaque groupe on garde UN morceau, et on lui donne le
   meilleur de tous : la source la plus fiable pour le tempo et la
   tonalite, l'annee de qui en a une, le chemin du fichier qui
   existe vraiment. On note combien de copies ont ete repliees —
   l'ecran de sante s'en sert pour proposer le menage.
   ============================================================ */
function normaliserNom(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(feat|ft|featuring|avec)\b.*$/, ' ')
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* Ecart tolere : 4 secondes, ou 2 % pour les morceaux longs. Un meme
   enregistrement encode deux fois varie de quelques dixiemes ; un
   edit ou un remix, de bien plus. Meme regle que health.js. */
function memeDuree(a, b) {
  if (!(a > 0) || !(b > 0)) return false;   /* duree inconnue : on NE replie PAS */
  return Math.abs(a - b) <= Math.max(4, Math.min(a, b) * 0.02);
}

/**
 * Replie les copies d'un meme morceau en une seule entree.
 * @returns {{tracks:Array, replies:number}}
 */
function dedoublonner(tracks) {
  const parNom = new Map();
  const sansNom = [];
  for (const t of tracks || []) {
    const n = normaliserNom((t.artist || '') + ' ' + (t.title || ''));
    if (n.length < 4) { sansNom.push(t); continue; }
    if (!parNom.has(n)) parNom.set(n, []);
    parNom.get(n).push(t);
  }

  const out = [];
  let replies = 0;
  for (const [, memeNom] of parNom) {
    if (memeNom.length === 1) { out.push(memeNom[0]); continue; }
    /* Meme nom ne suffit pas : on redecoupe par duree. */
    const groupes = [];
    for (const t of memeNom) {
      const g = groupes.find(x => memeDuree(x[0].duration, t.duration));
      if (g) g.push(t); else groupes.push([t]);
    }
    for (const g of groupes) {
      if (g.length === 1) { out.push(g[0]); continue; }
      /* ------------------------------------------------------------
         Lequel on garde : celui dont le FICHIER EXISTE. Une entree
         iTunes qui pointe un fichier efface ne doit jamais l'emporter
         sur l'entree rekordbox du meme morceau, sinon on aurait
         dedoublonne pour ne garder que la copie morte.
         ------------------------------------------------------------ */
      const vivants = g.filter(t => t.path && !t.disparu);
      const candidats = vivants.length ? vivants : g;
      /* A egalite, la source la plus fiable pour le tempo. */
      let garde = candidats[0];
      for (const t of candidats) {
        if (fiabilite(t.bpmSrc) > fiabilite(garde.bpmSrc)) garde = t;
      }
      /* Et on ramasse le meilleur de tous les autres. */
      for (const t of g) {
        if (t === garde) continue;
        if (t.bpm > 0 && (!(garde.bpm > 0) || fiabilite(t.bpmSrc) > fiabilite(garde.bpmSrc))) {
          garde.bpm = t.bpm; garde.bpmSrc = t.bpmSrc;
        }
        if (t.key && (!garde.key || fiabilite(t.keySrc) > fiabilite(garde.keySrc))) {
          garde.key = t.key; garde.keySrc = t.keySrc;
        }
        if (!garde.genre && t.genre) garde.genre = t.genre;
        if (!anneeTag(garde.year) && anneeTag(t.year)) garde.year = t.year;
        if (garde.rbId == null && t.rbId != null) garde.rbId = t.rbId;
        if (garde.itId == null && t.itId != null) garde.itId = t.itId;
        /* La notoriete d'iTunes — nombre de lectures, note — est une
           information que les logiciels DJ n'ont pas : on prend la
           plus haute plutot que celle du hasard. */
        if ((t.pop || 0) > (garde.pop || 0)) garde.pop = t.pop;
      }
      garde.copies = g.length;
      replies += g.length - 1;
      out.push(garde);
    }
  }
  return { tracks: out.concat(sansNom), replies: replies };
}

/* Un morceau est utilisable des que le logiciel de mix nous a
   donne son titre, son artiste, son BPM et sa tonalite. L'energie
   et le timbre affinent le classement mais ne le conditionnent
   pas : on pose des valeurs neutres, l'analyse de fond les
   remplacera morceau par morceau. C'est ce qui permet d'ouvrir le
   widget en trois secondes au lieu d'une nuit. */
function finalize(tracks) {
  const pris = new Set();
  return tracks
    /* Un tempo aberrant (0, 1, 300) est un tag faux : on le remet a
       null plutot que d'ecarter le morceau. Le jeter ici, c'etait le
       rendre inaccessible a l'analyse de fond — qui sait pourtant
       deduire le tempo. Un DJ sans logiciel de mix, avec un dossier de
       MP3 achetes sans tag TBPM, voyait « 0 titre pret » sans la
       moindre explication. */
    .map(t => (t.bpm > 40 && t.bpm < 220) ? t
              : Object.assign({}, t, { bpm: null, aMesurer: true }))
    .map((t, i) => {
      /* Sans chemin — ca arrive avec une base incomplete — on se
         rabat sur artiste + titre, qui est stable lui aussi. */
      const base = t.path ? cleChemin(t.path)
                          : 'meta:' + String(t.artist || '').toLowerCase() + '|' + String(t.title || '').toLowerCase();
      let id = hash53(base);
      /* collision : on avance jusqu'a une place libre, de facon
         deterministe, pour que deux lancements donnent le meme
         resultat sur la meme bibliotheque */
      while (pris.has(id)) id = id + 1 <= Number.MAX_SAFE_INTEGER ? id + 1 : 1;
      pris.add(id);
      t.id = id;
      t.tags = String(t.genre || '')
        .toLowerCase().split(/[\/,;|]+/).map(s => s.trim()).filter(Boolean);
      /* ------------------------------------------------------------
         « Bon Entendeur;Mouloudji », tel qu'il s'affichait en cabine.

         Les tags ID3 separent les artistes multiples par un
         point-virgule, une barre oblique ou un « / » — et rekordbox
         recopie la chaine telle quelle. Liaison l'affichait telle
         quelle aussi. Ce n'est pas faux, c'est illisible : en
         cabine, a 2 h du matin, on lit un nom, pas une syntaxe.
         ------------------------------------------------------------ */
      if (t.artist) {
        /* ------------------------------------------------------------
           La barre oblique SEULE ne separe rien : AC/DC.

           Premiere version de ce nettoyage : couper sur « ; », « / »
           et « | ». Elle a rendu « AC, DC » des le premier essai.
           Le point-virgule et la barre verticale sont sans ambiguite ;
           la barre oblique ne separe que si elle est entouree
           d'espaces (« Daft Punk / Pharrell »), jamais collee.
           ------------------------------------------------------------ */
        const a = String(t.artist).split(/\s*[;|]\s*|\s+\/\s+/)
          .map(x => x.trim()).filter(Boolean);
        if (a.length > 1) t.artist = a.join(', ');
      }
      /* La provenance suit le morceau jusqu'au widget. Sans valeur,
         il n'y a pas de source : « tag » serait un mensonge poli. */
      t.bpmSource = t.bpm > 0 ? (t.bpmSrc || 'tag') : null;
      t.keySource = t.key ? (t.keySrc || 'tag') : null;
      t.out = t.duration > 300 ? 64 : t.duration > 180 ? 32 : 16;
      t.year = anneeTag(t.year);
      if (t.energy == null) t.energy = 5;
      if (!t.timbre) t.timbre = [5, 5, 5];
      return t;
    });
}

module.exports = { parseRekordboxXML, scanFolder, analyzeAll, finalize, toCamelot, walk, hash53, cleChemin, chargerScanCache, ecrireScanCache, probe, commentOnLitLesTags, lecteurDeTags, lireFfmetadata, anneeTag, anneeDeLaMusique, estReedition, VERSION_TAGS, ffprobePath,
                   FIABILITE, fiabilite, elaguerDisparus, dedoublonner, normaliserNom, AUDIO };
