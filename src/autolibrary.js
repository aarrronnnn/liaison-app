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
const vol = require('./volumes');
const lib = require('./library');

const HOME = os.homedir();
const win = process.platform === 'win32';
const exists = p => { try { return fs.existsSync(p); } catch (e) { return false; } };

/* ---------- emplacements connus ---------- */
/* ============================================================
   LA BIBLIOTHEQUE N'EST PAS DANS LE DOSSIER PERSONNEL.

   « Quand les DJ jouent un son qui vient de leur bibliotheque
     rekordbox ou Serato, Liaison ne capte meme pas le son — alors
     que quand ils jouent un son qui vient de leur bibliotheque
     iTunes, aucun probleme. »

   Le symptome disait « detection », la cause etait ailleurs : ces
   morceaux n'etaient PAS DANS LA BIBLIOTHEQUE. On ne peut pas
   detecter ce qu'on n'a jamais lu.

   Pourquoi : ces quatre fonctions ne cherchaient que sous HOME.
   Or un DJ mobile ne range pas sa musique dans son dossier
   personnel — il la met sur un SSD externe, parce que c'est le
   disque qu'il emporte en soiree et qu'il branche sur la machine
   du lieu. Et Serato, lui, ecrit un dossier « _Serato_ » A LA
   RACINE DE CHAQUE DISQUE qui porte des morceaux. Celui du SSD
   contient la vraie bibliotheque ; celui du disque interne est
   souvent vide ou residuel.

   Liaison ne trouvait donc rien, retombait sur la bibliotheque
   iTunes — qui, elle, vit bien dans HOME — et le DJ voyait
   exactement ce qu'il a decrit : ses morceaux iTunes reconnus, et
   les autres invisibles. Aucun message, parce que de notre point
   de vue tout allait bien : on avait trouve une source.

   On cherche donc AUSSI sur les volumes montes. Le cout est nul :
   c'est un test d'existence par disque, pas un parcours.
   ============================================================ */
function seratoPaths() {
  const out = [];
  const bases = [path.join(HOME, 'Music'), path.join(HOME, 'Musique'), path.join(HOME, 'Musik')];
  for (const b of bases) out.push(path.join(b, '_Serato_', 'database V2'));
  /* Serato pose son dossier a la racine du volume, et aussi sous un
     dossier Music quand le DJ a range comme sur son Mac. */
  for (const v of externalVolumes()) {
    out.push(path.join(v, '_Serato_', 'database V2'));
    for (const n of ['Music', 'Musique', 'Musik']) {
      out.push(path.join(v, n, '_Serato_', 'database V2'));
    }
  }
  return out;
}
function traktorPaths() {
  const racines = [path.join(HOME, 'Documents', 'Native Instruments')];
  /* Traktor suit son utilisateur : un DJ qui travaille sur deux
     machines pose souvent sa collection sur le disque qu'il emporte. */
  for (const v of externalVolumes()) {
    racines.push(path.join(v, 'Native Instruments'));
    racines.push(path.join(v, 'Documents', 'Native Instruments'));
  }
  const out = [];
  for (const root of racines) {
    let liste = [];
    try { liste = fs.readdirSync(root); } catch (e) { continue; }
    for (const d of liste) {
      if (!/^Traktor/i.test(d)) continue;
      const p = path.join(root, d, 'collection.nml');
      if (exists(p) && out.indexOf(p) < 0) out.push(p);
    }
  }
  return out;
}
function virtualdjPaths() {
  const out = [
    path.join(HOME, 'Documents', 'VirtualDJ', 'database.xml'),
    path.join(HOME, 'Library', 'Application Support', 'VirtualDJ', 'database.xml'),
    win ? path.join(process.env.LOCALAPPDATA || '', 'VirtualDJ', 'database.xml') : ''
  ].filter(Boolean);
  /* VirtualDJ ecrit une base par disque, a sa racine. */
  for (const v of externalVolumes()) out.push(path.join(v, 'VirtualDJ', 'database.xml'));
  return out;
}
function rekordboxXmlPaths() {
  const dirs = [
    path.join(HOME, 'Library', 'Pioneer', 'rekordbox'),
    path.join(HOME, 'AppData', 'Roaming', 'Pioneer', 'rekordbox'),
    path.join(HOME, 'Documents'), path.join(HOME, 'Desktop'),
    path.join(HOME, 'Music', 'PioneerDJ'), path.join(HOME, 'Music')
  ];
  /* Un export rekordbox se pose la ou on le retrouvera : tres
     souvent a la racine du disque qui porte les morceaux. */
  for (const v of externalVolumes()) {
    dirs.push(v);
    for (const n of ['Music', 'Musique', 'PioneerDJ', 'rekordbox']) dirs.push(path.join(v, n));
  }
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
  /* ------------------------------------------------------------
     Un point de montage qu'on n'a pas prevu.

     La liste ci-dessous couvre macOS, Windows et les deux dossiers
     habituels sous Linux. Elle ne couvre pas un NAS monte a la main,
     un chemin d'entreprise, ni un banc d'essai. LIAISON_VOLUMES
     ajoute des racines separees par « : », et c'est aussi ce qui
     permet de tester cette detection sans brancher un disque.
     ------------------------------------------------------------ */
  for (const v of String(process.env.LIAISON_VOLUMES || '').split(win ? ';' : ':')) {
    if (v && exists(v)) out.push(v);
  }
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
/* Le nom est ancre sur un debut de mot : sans le « \b », demander
   « Year » attrapait aussi « ReleaseYear » ou « OrigYear » ailleurs
   dans le meme bloc, et l'annee lue n'etait pas celle qu'on croyait.
   Aucun format ne collisionnait avant l'ajout de « Year », qui est
   le nom le plus court de la liste. */
const attr = (s, name) => { const m = s.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? m[1] : ''; };
const unesc = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

/* L'option « existe » n'est la que pour les essais : elle permet
   d'eprouver la resolution du volume sur une plateforme simulee,
   sans brancher un disque. En production, resoudre() interroge le
   vrai systeme de fichiers. */
function parseTraktor(file, opt) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /<ENTRY\b([\s\S]*?)<\/ENTRY>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[0], head = m[1].slice(0, m[1].indexOf('>') + 1);
    const dir = unesc(attr(e, 'DIR')).replace(/\/:/g, '/').replace(/^\/+/, '/');
    const f = unesc(attr(e, 'FILE'));
    if (!f) continue;
    /* ------------------------------------------------------------
       L'ATTRIBUT « VOLUME », QUI ETAIT JETE.

       Traktor ecrit <LOCATION DIR="/:Music/:" FILE="x.mp3"
       VOLUME="D:"> — et VOLUME porte la lettre du disque sous
       Windows, le NOM du volume sous macOS. On ne lisait que DIR
       et FILE : le chemin rendu n'avait donc pas de racine.

       Exactement la panne de Serato, dans un autre format : aucun
       fichier ne repond, l'elagage supprime tout, la bibliotheque
       tombe a zero et chaque morceau pose sur le deck est annonce
       « hors bibliotheque ». Invisible sur le disque de demarrage
       d'un Mac, ou « / » + chemin tombe juste par hasard.

       C'est aussi ce qui explique la plainte d'origine : « avec
       iTunes aucun probleme » — iTunes ecrit un chemin ABSOLU.
       ------------------------------------------------------------ */
    const volume = unesc(attr(e, 'VOLUME'));
    const kv = attr(e, 'VALUE');
    const bpm = parseFloat(attr(e, 'BPM')) || 0;
    out.push({
      path: (function () {
        const r = vol.racinesTraktor(volume, opt && opt.plateforme);
        return vol.resoudre((dir || '/') + f, r[0],
          { autres: r.slice(1), existe: opt && opt.existe, plateforme: opt && opt.plateforme });
      })(),
      title: unesc(attr(head, 'TITLE')) || f,
      artist: unesc(attr(head, 'ARTIST')),
      genre: unesc(attr(e, 'GENRE')),
      bpm: Math.round(bpm * 10) / 10,
      key: TRAKTOR_KEY[Number(kv)] || lib.toCamelot(unesc(attr(e, 'KEY'))) || null,
      bpmSrc: 'traktor', keySrc: 'traktor',
      duration: parseFloat(attr(e, 'PLAYTIME')) || 0,
      year: annee(attr(e, 'RELEASE_DATE')) || annee(attr(e, 'YEAR')),
      pop: 40 + Math.min(40, (parseInt(attr(e, 'PLAYCOUNT'), 10) || 0) * 5)
    });
  }
  return out;
}

/* ------------------------------------------------------------
   L'annee, telle que chaque logiciel l'ecrit.

   Elle sert au mode bulle : c'est elle qui permet a une soiree
   annees 80 de rester dans les annees 80. Traktor ecrit une date
   complete (« 1983/2/1 »), VirtualDJ une annee seche, iTunes un
   entier, rekordbox un attribut Year — et tous ecrivent parfois
   « 0 » ou rien du tout. On prend les quatre premiers chiffres
   plausibles, et on refuse le reste plutot que d'inventer.
   ------------------------------------------------------------ */
function annee(v) {
  if (v == null) return null;
  const m = String(v).match(/\d{4}/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return (n >= 1900 && n <= 2100) ? n : null;
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
      bpmSrc: 'virtualdj', keySrc: 'virtualdj',
      duration: parseFloat(attr(e, 'SongLength')) || 0,
      year: annee(attr(e, 'Year')),
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
function conseils(sources, opt) {
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

  /* ------------------------------------------------------------
     L'EXPORT QUI DATE.

     « J'ai supprime des musiques de ma bibliotheque et pourtant
       Liaison me les propose toujours. »

     Quand le fichier a vraiment ete efface du disque, l'elagage
     s'en charge. Mais il existe un cas qu'aucun elagage ne peut
     attraper : le morceau est encore sur le disque, le DJ l'a
     seulement retire de sa collection rekordbox — et l'export XML,
     lui, date d'avant. Liaison lit alors une photo perimee, sans
     aucun moyen de le deviner.

     Sauf un : sa date. Un export vieux de deux semaines sur une
     collection qui bouge tous les jours, ca se dit.
     ------------------------------------------------------------ */
  /* ============================================================
     UN LOGICIEL QUI TOURNE ET DONT ON N'A PAS LA BIBLIOTHEQUE.

     C'est la moitie manquante du defaut des volumes externes. Meme
     une fois les disques fouilles, il restera des cas ou la base
     est ailleurs : un NAS, un dossier d'entreprise, un chemin que
     le DJ a choisi lui-meme. Dans ces cas-la, Liaison trouvait la
     bibliotheque iTunes, se declarait content, et le DJ voyait ses
     morceaux Serato ignores SANS UN MOT.

     Le silence etait le vrai defaut. On ne peut pas deviner tous
     les chemins ; on peut dire « ton logiciel tourne et je n'ai pas
     trouve sa bibliotheque », ce qui transforme une panne
     incomprehensible en un reglage de trente secondes.
     ============================================================ */
  const kindsVus = new Set((sources || []).map(s => s.kind));
  const NOMS = { serato: 'Serato DJ', traktor: 'Traktor', virtualdj: 'VirtualDJ' };
  for (const [kind, nom] of Object.entries(NOMS)) {
    if (kindsVus.has(kind)) continue;
    if (!(opt && opt.tournent && opt.tournent.indexOf(kind) >= 0)) continue;
    out.push({
      cle: 'base-introuvable-' + kind, quand: 'biblio',
      titre: nom + ' tourne, mais je n\'ai pas trouve sa bibliotheque',
      texte: 'Liaison a cherche aux emplacements habituels, sur le disque interne et sur les ' +
             'disques branches, et n\'a rien trouve. Tes morceaux ' + nom + ' ne sont donc pas ' +
             'dans la bibliotheque — et un morceau absent de la bibliotheque ne peut pas etre ' +
             'reconnu quand tu le joues.',
      marche: [
        'Verifie que le disque qui porte ta musique est bien branche',
        'Ouvre les reglages de Liaison et designe le dossier a la main',
        kind === 'serato' ? 'Le dossier cherche s\'appelle « _Serato_ », a la racine du disque'
                          : 'Indique le fichier de collection de ' + nom
      ],
      repli: 'En attendant, Liaison travaille avec les autres sources qu\'il a trouvees — ce qui ' +
             'explique que certains morceaux soient reconnus et d\'autres non.'
    });
  }

  const JOURS = 14;
  for (const s of sources || []) {
    if (s.kind !== 'rekordbox') continue;
    let age = 0;
    try { age = (Date.now() - fs.statSync(s.path).mtimeMs) / 86400000; } catch (e) { continue; }
    if (age < JOURS) continue;
    out.push({
      cle: 'rekordbox-xml-perime', quand: 'biblio',
      titre: 'Ton export rekordbox date de ' + Math.round(age) + ' jours',
      texte: 'Un export XML est une photo, pas un lien : ce que tu as ajoute ou supprime ' +
             'dans rekordbox depuis n\'y est pas. C\'est la raison la plus frequente d\'un ' +
             'morceau propose alors que tu l\'as retire de ta collection.',
      marche: [
        'Dans rekordbox : Fichier > Exporter la collection au format xml',
        'Ecrase le fichier precedent, au meme endroit',
        'Liaison le relit tout seul dans les secondes qui suivent'
      ],
      repli: 'Tant que tu ne le refais pas, Liaison travaille sur la collection telle ' +
             'qu\'elle etait a cette date.'
    });
    break;
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
      /* iTunes ecrit l'annee en <integer> : la lecture existait deja,
         on ne la demandait pas. C'est la source des DJ qui rangent
         leur musique dans iTunes puis importent dans rekordbox. */
      year: annee(val('Year')),
      /* iTunes est la seule source qui porte vraiment cette etiquette */
      explicit: val('Explicit') === 'true' ? 1 : 0,
      title: name || path.basename(p, path.extname(p)),
      artist: val('Artist') || val('Album Artist') || '',
      genre: val('Genre') || '',
      /* ------------------------------------------------------------
         Le champ BPM d'iTunes est une SAISIE, pas une mesure.

         iTunes n'a jamais analyse un fichier audio de sa vie : ce
         champ se remplit a la main, ou par un import d'il y a
         quinze ans, ou par un logiciel tiers depuis longtemps
         desinstalle. C'est de la que viennent les « 105 » sur des
         morceaux a 130. On le lit — il vaut mieux que rien — mais
         on le marque faible, et la mesure de Liaison le corrige
         des qu'elle est sure d'elle.
         ------------------------------------------------------------ */
      bpm: bpm > 0 ? Math.round(bpm * 10) / 10 : 0,
      bpmSrc: 'itunes',
      /* iTunes n'a pas de champ tonalite du tout : d'ou les « ? »
         partout chez un DJ dont c'est la seule source. C'est a
         l'analyse de Liaison de la donner. */
      key: null, keySrc: null,
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
      /* ------------------------------------------------------------
         La fusion prenait le premier arrive, pas le mieux informe.

         Un DJ qui a iTunes ET rekordbox voyait donc, selon l'ordre
         de detection, le BPM saisi a la main d'iTunes gagner contre
         la grille analysee de rekordbox — silencieusement, et
         differemment d'un demarrage a l'autre. On compare
         maintenant les provenances : la source la plus fiable
         gagne, a valeur presente des deux cotes.
         ------------------------------------------------------------ */
      if (t.bpm > 0 && (!(prev.bpm > 0) || lib.fiabilite(t.bpmSrc) > lib.fiabilite(prev.bpmSrc))) {
        prev.bpm = t.bpm; prev.bpmSrc = t.bpmSrc;
      }
      if (t.key && (!prev.key || lib.fiabilite(t.keySrc) > lib.fiabilite(prev.keySrc))) {
        prev.key = t.key; prev.keySrc = t.keySrc;
      }
      if (!prev.genre && t.genre) prev.genre = t.genre;
      /* L'annee etait la seule etiquette que la fusion oubliait. Sur
         un DJ qui a Serato ET un dossier de musique, Serato passe en
         premier et n'en porte pas : l'annee lue dans les tags du
         dossier etait jetee, et le mode bulle perdait l'epoque pour
         toute une bibliotheque. */
      /* On repasse par la verification plutot que de tester la
         verite de la valeur : une annee aberrante venue d'une source
         — rekordbox ecrit parfois « 83 » — est truthy, bloquait la
         bonne annee d'une autre source, et se faisait effacer plus
         tard par finalize(). L'ordre des sources changeait alors le
         resultat. */
      if (!annee(prev.year) && annee(t.year)) prev.year = annee(t.year);
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
/* ------------------------------------------------------------
     Compter sans bloquer, et pas toutes les minutes.

     Le comptage utilisait lib.walk(), un parcours recursif ENTIEREMENT
     SYNCHRONE, relance toutes les 60 secondes sur le processus qui
     tient le widget. Sur les vingt-deux mille fichiers d'un disque
     externe emporte en soiree, ca gelait tout — detection de deck
     comprise — une fois par minute, toute la nuit.

     Deux corrections. D'abord le parcours rend la main entre chaque
     dossier : le widget continue de vivre pendant le comptage.
     Ensuite on espace a cinq minutes — ce balayage n'est qu'un filet
     derriere fs.watch, qui reagit lui en une seconde ; il n'a jamais
     eu besoin d'etre aussi bavard.

     Et on ne lance jamais deux comptages a la fois : sur un disque
     lent, ils s'empileraient.
     ------------------------------------------------------------ */
  const comptes = new Map();

  /* Parcours asynchrone, borne, qui souffle entre chaque dossier. */
  async function compterDoux(racine) {
    let n = 0;
    const pile = [racine];
    let vus = 0;
    while (pile.length) {
      const d = pile.pop();
      let entrees;
      try { entrees = await fs.promises.readdir(d, { withFileTypes: true }); }
      catch (e) { continue; }
      for (const e of entrees) {
        if (e.name.charAt(0) === '.') continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) pile.push(p);
        else if (lib.AUDIO_EXT ? lib.AUDIO_EXT.test(e.name) : /\.(mp3|wav|aiff?|flac|m4a|aac|ogg|wma)$/i.test(e.name)) n++;
      }
      /* On rend la main a l'interface tous les 40 dossiers : le
         widget reste vivant meme sur une arborescence enorme. */
      if (++vus % 40 === 0) await new Promise(r => setTimeout(r, 0));
      if (vus > 20000) break;            /* garde-fou : arborescence pathologique */
    }
    return n;
  }

  let comptageEnCours = false;
  async function toutCompter(premier) {
    if (comptageEnCours) return;
    comptageEnCours = true;
    try {
      for (const s of dossiers) {
        const n = await compterDoux(s.path);
        if (premier) { comptes.set(s.path, n); continue; }
        if (n >= 0 && n !== comptes.get(s.path)) { comptes.set(s.path, n); signalerDossier(s); }
      }
    } finally { comptageEnCours = false; }
  }
  toutCompter(true);
  const balayage = dossiers.length ? setInterval(() => { toutCompter(false); }, 300000) : null;
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
