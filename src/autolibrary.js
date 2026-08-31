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

/* ------------------------------------------------------------
   rekordbox installe, mais rien a lire.

   rekordbox 6 et 7 gardent leur bibliotheque dans une base
   chiffree que Liaison ne lit pas — et ne lira pas : la
   dechiffrer demanderait d'utiliser une cle extraite du logiciel
   de Pioneer, ce qui n'a pas sa place dans un produit qu'on vend.

   Ce que rekordbox sait faire, en revanche, c'est exporter sa
   collection en XML, et c'est meme la fonction qu'il propose pour
   travailler avec d'autres outils. Un export de 22 000 titres se
   lit en une seconde, avec les BPM et les tonalites deja calcules
   par rekordbox lui-meme — donc mieux que ce que Liaison lirait
   dans les tags des fichiers.

   Le probleme n'etait donc pas technique, il etait muet : sans
   XML, Liaison retombait sans rien dire sur un scan de dossier de
   deux heures, alors que la bonne reponse tenait en trois clics
   dans rekordbox. On le dit maintenant.
   ------------------------------------------------------------ */
function rekordboxDirs() {
  return [
    path.join(HOME, 'Library', 'Pioneer', 'rekordbox'),
    path.join(HOME, 'AppData', 'Roaming', 'Pioneer', 'rekordbox'),
    win ? path.join(process.env.APPDATA || '', 'Pioneer', 'rekordbox') : '',
    path.join(HOME, 'Music', 'PioneerDJ'),
    path.join(HOME, 'Musique', 'PioneerDJ')
  ].filter(Boolean);
}
function rekordboxInstalle() {
  for (const d of rekordboxDirs()) if (exists(d)) return d;
  return null;
}

/**
 * Ce qui manque pour aller vite, et comment le corriger.
 * Rendu tel quel a l'interface : c'est un message pour le DJ, pas
 * un diagnostic pour le journal.
 */
function conseils(sources) {
  const out = [];
  const kinds = new Set((sources || []).map(s => s.kind));
  if (!kinds.has('rekordbox') && rekordboxInstalle()) {
    out.push({
      cle: 'rekordbox-sans-xml', quand: 'biblio',
      titre: 'rekordbox est la, mais sa bibliotheque est fermee',
      texte: 'rekordbox garde sa collection dans une base chiffree. Exporte-la une fois ' +
             'et Liaison la lira en une seconde, avec tes BPM et tes tonalites.',
      marche: [
        'Dans rekordbox : Fichier > Exporter la collection au format xml',
        'Enregistre le fichier dans Musique ou sur le Bureau',
        'Reviens ici et relance la detection'
      ],
      /* Sans ca, il reste le scan de dossier : il marche, mais il
         lit les tags des fichiers un par un. */
      repli: 'Sinon Liaison lit ton dossier de musique — plus long, et moins precis.'
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

async function readSource(src, onProgress, opt) {
  if (src.kind === 'serato') return seratoDb.parseDatabase(src.path);
  if (src.kind === 'traktor') return parseTraktor(src.path);
  if (src.kind === 'virtualdj') return parseVirtualDJ(src.path);
  if (src.kind === 'rekordbox') return lib.parseRekordboxXML(src.path);
  if (src.kind === 'itunes') return parseITunes(src.path);
  /* Le seul cas lent, et donc le seul qui a besoin d'un cache. */
  return lib.scanFolder(src.path, onProgress, opt || {});
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

/** Fusionne plusieurs sources en dedoublonnant par chemin de fichier.

    La comparaison passe par la meme mise a plat que les
    identifiants : iTunes ecrit « file:///Users/... » avec des %20,
    Serato « Users/... » sans slash initial, Traktor « /: » a la
    place des « / ». Compares bruts, ces trois chemins font trois
    morceaux differents — et un DJ qui a Serato ET iTunes voyait sa
    bibliotheque comptee deux fois. */
function merge(lists) {
  const byPath = new Map();
  for (const list of lists) {
    for (const t of list) {
      const k = lib.cleChemin(t.path);
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
/* ============================================================
   Surveiller la base d'un logiciel de mix.

   Naivement, on surveille le fichier. Ca ne marche pas : Serato,
   rekordbox et iTunes n'ecrivent jamais par-dessus leur base. Ils
   ecrivent a cote, puis renomment — c'est ce qui protege leurs
   donnees d'une coupure. Or un renommage detruit l'inode que
   fs.watch observait : le surveillant continue de tourner sans
   plus jamais rien signaler. La bibliotheque cesse donc de se
   synchroniser apres la premiere modification, en silence.

   On surveille donc le DOSSIER, qui lui survit au renommage, et
   on filtre sur le nom du fichier. Et parce qu'un dossier surveille
   peut lui aussi disparaitre — un disque externe qu'on debranche —
   on double d'un controle de date toutes les 30 secondes. La
   surveillance est gratuite, le controle est negligeable, et entre
   les deux plus rien ne passe a travers.
   ============================================================ */
/* ------------------------------------------------------------
   La surveillance.

   Les dossiers de musique en etaient exclus, et pour une bonne
   raison a l'epoque : relire un dossier coutait deux heures, on
   n'allait pas le declencher parce qu'un fichier avait bouge.

   Depuis que les tags lus sont gardes en cache, cette raison a
   disparu. Relire un dossier de 22 000 morceaux dont aucun n'a
   change prend cinq millisecondes ; dix titres achetes dans
   l'apres-midi en coutent dix de plus. Le calcul s'est inverse :
   surveiller devient gratuit, et ne pas surveiller oblige le DJ a
   penser a relancer un scan avant chaque soiree — ce que personne
   ne fera.

   fs.watch en recursif couvre macOS et Windows. Sous Linux il ne
   l'est pas, d'ou le balayage periodique qui suit, qui sert aussi
   de filet pour les disques externes rebranches.
   ------------------------------------------------------------ */
function watch(sources, onChange) {
  const vivants = [];
  let timer = null;
  const bases = (sources || []).filter(s => s.kind !== 'folder');
  const dossiers = (sources || []).filter(s => s.kind === 'folder');
  const surveilles = bases;

  const signaler = s => {
    clearTimeout(timer);
    /* on laisse le logiciel finir d'ecrire avant de relire */
    timer = setTimeout(() => onChange(s), 4000);
  };

  /* Un telechargement s'ecrit par morceaux, et un transfert de
     cle USB en ecrit des dizaines a la suite. On attend donc plus
     longtemps qu'apres la sauvegarde d'une base : douze secondes
     sans nouvel evenement, et on relit. */
  let tDossier = null;
  const signalerDossier = s => {
    clearTimeout(tDossier);
    tDossier = setTimeout(() => onChange(s), 12000);
  };

  for (const s of dossiers) {
    try {
      const w = fs.watch(s.path, { recursive: true }, (ev, f) => {
        /* seuls les fichiers audio nous interessent : un .DS_Store
           qui change ne doit pas relancer une lecture */
        if (f && !/\.(mp3|wav|aiff?|flac|m4a|aac|ogg|wma)$/i.test(f)) return;
        signalerDossier(s);
      });
      w.on('error', () => {});
      vivants.push(w);
    } catch (e) { /* recursif refuse (Linux) : le balayage prend le relais */ }
  }

  /* Le balayage : on compte les fichiers audio du dossier. Un
     compte qui change veut dire qu'on a ajoute ou retire quelque
     chose. C'est grossier, mais ca ne reveille pas le disque plus
     d'une fois par minute et ca rattrape ce que fs.watch rate. */
  const comptes = new Map();
  const compter = d => { try { return lib.walk(d, []).length; } catch (e) { return -1; } };
  for (const s of dossiers) comptes.set(s.path, compter(s.path));
  const balayage = dossiers.length ? setInterval(() => {
    for (const s of dossiers) {
      const n = compter(s.path);
      if (n >= 0 && n !== comptes.get(s.path)) { comptes.set(s.path, n); signalerDossier(s); }
    }
  }, 60000) : null;
  if (balayage && balayage.unref) balayage.unref();

  for (const s of surveilles) {
    const dossier = path.dirname(s.path);
    const nom = path.basename(s.path);
    try {
      const w = fs.watch(dossier, (ev, f) => {
        /* f est nul sur certains systemes : dans le doute on relit */
        if (!f || f === nom || f.indexOf(nom) === 0) signaler(s);
      });
      w.on('error', () => {});
      vivants.push(w);
    } catch (e) { /* dossier illisible : le controle de date prendra le relais */ }
  }

  /* Filet : la date de modification, relue regulierement. Il
     rattrape le disque externe rebranche, le dossier recree, et
     les systemes de fichiers reseau ou fs.watch ne dit rien. */
  const dates = new Map();
  for (const s of surveilles) {
    try { dates.set(s.path, fs.statSync(s.path).mtimeMs); } catch (e) { dates.set(s.path, 0); }
  }
  const contro = setInterval(() => {
    for (const s of surveilles) {
      let m = 0;
      try { m = fs.statSync(s.path).mtimeMs; } catch (e) { m = 0; }
      const avant = dates.get(s.path) || 0;
      if (m && m !== avant) { dates.set(s.path, m); signaler(s); }
      else if (!m && avant) dates.set(s.path, 0);   /* fichier parti : on note, sans relire */
    }
  }, 30000);
  if (contro.unref) contro.unref();

  return {
    stop: () => {
      clearTimeout(timer);
      clearTimeout(tDossier);
      clearInterval(contro);
      if (balayage) clearInterval(balayage);
      vivants.forEach(w => { try { w.close(); } catch (e) {} });
    }
  };
}

module.exports = { conseils, rekordboxInstalle, detect, readSource, merge, watch, parseTraktor, parseVirtualDJ, parseITunes,
                   seratoPaths, traktorPaths, virtualdjPaths, rekordboxXmlPaths, itunesPaths,
                   musicFolders, externalVolumes, fromFileURL };
