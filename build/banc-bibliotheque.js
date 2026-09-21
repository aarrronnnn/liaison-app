'use strict';
/* ============================================================
   BANC — LA BIBLIOTHEQUE, SUR N'IMPORTE QUELLE MACHINE.

   Deux pannes en une semaine, la meme au fond :

     Serato   le chemin est relatif au volume, la lettre de disque
              manquait sur Windows.
     Traktor  l'attribut VOLUME, qui porte cette lettre, n'etait
              jamais lu.

   Dans les deux cas : aucun fichier ne repond, l'elagage
   « fichier introuvable » supprime tout, la bibliotheque tombe a
   zero, et chaque morceau pose sur le deck est annonce « hors
   bibliotheque ». Sans une erreur nulle part.

   Et dans les deux cas, LA PANNE ETAIT INVISIBLE SUR LA MACHINE
   DE DEVELOPPEMENT. Sur le disque de demarrage d'un Mac, « / » +
   chemin tombe juste par hasard. Il fallait un Windows, ou un SSD
   externe — c'est-a-dire la configuration de la moitie des DJ et
   le disque qu'ils emportent en soiree.

   ------------------------------------------------------------
   CE QUE CE BANC FAIT, ET QUE LES AUTRES ESSAIS NE FONT PAS.

   Il ne teste pas « le parseur lit des octets ». Il eprouve, pour
   CHAQUE format et CHAQUE configuration de machine, la seule
   propriete qui compte vraiment :

     un morceau present dans la bibliotheque doit etre RETROUVE
     quand le logiciel de mix l'annonce sur le deck.

   C'est la chaine entiere : lecture du format, racine du volume,
   normalisation du chemin, index, rapprochement. Si un maillon
   casse, le DJ voit « 0 titre » ou « hors bibliotheque » — les
   deux symptomes qu'on a vus.

   Les plateformes sont SIMULEES : le module est recharge sous une
   fausse valeur de process.platform, et l'existence des fichiers
   est injectee. Ce banc tombe donc sur la panne de Windows en
   tournant sur un Mac ou sur Linux — sinon il ne servirait a rien
   la ou elle se produit.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(64) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}
function titre(t) { console.log('\n  ' + t); }

console.log('\n- La bibliotheque, sur n\'importe quelle machine -');

/* ============================================================
   LES QUATRE MACHINES QU'ON SIMULE.
   ============================================================ */
const MACHINES = [
  { id: 'win-c',    plateforme: 'win32',  nom: 'Windows, disque systeme',
    racine: 'C:\\Users\\MARCHAL', dossier: 'C:\\Users\\MARCHAL\\Music\\Tracks',
    volumeTraktor: 'C:', sep: '\\' },
  { id: 'win-d',    plateforme: 'win32',  nom: 'Windows, second disque',
    racine: 'D:\\', dossier: 'D:\\Mes sons 2024',
    volumeTraktor: 'D:', sep: '\\' },
  { id: 'mac-boot', plateforme: 'darwin', nom: 'macOS, disque de demarrage',
    racine: '/', dossier: '/Users/dj/Music/Tracks',
    volumeTraktor: 'Macintosh HD', sep: '/' },
  { id: 'mac-ext',  plateforme: 'darwin', nom: 'macOS, SSD externe',
    racine: '/Volumes/SSD DJ', dossier: '/Volumes/SSD DJ/Music/Tracks',
    volumeTraktor: 'SSD DJ', sep: '/' },
  { id: 'linux',    plateforme: 'linux',  nom: 'Linux, disque monte',
    racine: '/media/dj/SSD', dossier: '/media/dj/SSD/Musique',
    volumeTraktor: 'SSD', sep: '/' }
];

/* Des morceaux avec ce qui casse : accents, espaces, apostrophe,
   parentheses, et un titre qui ressemble a un chemin. */
const MORCEAUX = [
  { nom: 'one-more-time.mp3',            titre: 'One More Time',      artiste: 'Daft Punk' },
  { nom: 'Café del Mar (Original Mix).mp3', titre: 'Café del Mar',    artiste: 'Energy 52' },
  { nom: "L'amour toujours.mp3",         titre: "L'amour toujours",   artiste: 'Gigi D\'Agostino' },
  { nom: 'Bella ciao - Hugel Remix.mp3', titre: 'Bella ciao',         artiste: 'Hugel' }
];

function joindre(m, nom) {
  return m.dossier.replace(/[\\/]+$/, '') + m.sep + nom;
}
/* Ce que le disque contiendrait reellement sur cette machine. */
function disqueDe(m) {
  return new Set(MORCEAUX.map(t => joindre(m, t.nom)));
}

/* ============================================================
   CHARGER LES MODULES SOUS UNE PLATEFORME SIMULEE.

   Les parseurs lisent process.platform au chargement. On le
   remplace, on vide le cache, on recharge — et on remet tout en
   place ensuite, quoi qu'il arrive.
   ============================================================ */
const MODULES = ['../src/autolibrary.js', '../src/library.js',
                 '../src/serato-db.js', '../src/volumes.js', '../src/analyze.js'];

function sousPlateforme(plateforme, fn) {
  const vraie = process.platform;
  const vider = () => {
    for (const m of MODULES) { try { delete require.cache[require.resolve(m)]; } catch (e) {} }
  };
  Object.defineProperty(process, 'platform', { value: plateforme, configurable: true });
  vider();
  try {
    return fn({
      autolib: require('../src/autolibrary.js'),
      lib: require('../src/library.js'),
      serato: require('../src/serato-db.js'),
      vol: require('../src/volumes.js')
    });
  } finally {
    Object.defineProperty(process, 'platform', { value: vraie, configurable: true });
    vider();
  }
}

/* ============================================================
   FABRIQUER UNE BIBLIOTHEQUE DE CHAQUE FORMAT, AVEC LES
   CONVENTIONS REELLES DE CHACUN.
   ============================================================ */
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                             .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const urlEnc = s => encodeURI(String(s).replace(/\\/g, '/')).replace(/#/g, '%23');

/* rekordbox et iTunes : file://localhost + chemin ABSOLU.
   Sous Windows l'URL porte un slash devant la lettre : /D:/... */
function urlFichier(m, nom) {
  const p = joindre(m, nom).replace(/\\/g, '/');
  return 'file://localhost' + (m.plateforme === 'win32' ? '/' + p : p);
}

function rekordboxXML(m) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<DJ_PLAYLISTS Version="1.0.0">\n' +
    '<COLLECTION Entries="' + MORCEAUX.length + '">\n' +
    MORCEAUX.map((t, i) =>
      '<TRACK TrackID="' + (i + 1) + '" Name="' + xmlEsc(t.titre) + '" Artist="' + xmlEsc(t.artiste) +
      '" AverageBpm="123.00" Tonality="Am" TotalTime="320" Year="2000" Genre="House"' +
      ' Location="' + xmlEsc(urlEnc(urlFichier(m, t.nom))) + '"></TRACK>').join('\n') +
    '\n</COLLECTION>\n</DJ_PLAYLISTS>';
}

/* Traktor : DIR et FILE separes, avec « /: » comme separateur, et
   le volume RANGE A PART dans VOLUME. */
function traktorNML(m) {
  const dir = m.dossier.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
                       .replace(/^\/?/, '/').replace(/\/+$/, '') + '/';
  const dirTraktor = dir.split('/').filter(Boolean).map(x => '/:' + x).join('') + '/:';
  return '<?xml version="1.0" encoding="UTF-8"?>\n<NML VERSION="19">\n<COLLECTION ENTRIES="' +
    MORCEAUX.length + '">\n' +
    MORCEAUX.map(t =>
      '<ENTRY TITLE="' + xmlEsc(t.titre) + '" ARTIST="' + xmlEsc(t.artiste) + '">' +
      '<LOCATION DIR="' + xmlEsc(dirTraktor) + '" FILE="' + xmlEsc(t.nom) +
      '" VOLUME="' + xmlEsc(m.volumeTraktor) + '" VOLUMEID="x"></LOCATION>' +
      '<TEMPO BPM="123.000000"></TEMPO><INFO GENRE="House" KEY="Am" PLAYTIME="320"></INFO>' +
      '</ENTRY>').join('\n') +
    '\n</COLLECTION>\n</NML>';
}

/* VirtualDJ : FilePath absolu, tel quel. */
function virtualdjXML(m) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<VirtualDJ_Database Version="8">\n' +
    MORCEAUX.map(t =>
      '<Song FilePath="' + xmlEsc(joindre(m, t.nom)) + '" FileSize="1000">' +
      '<Tags Author="' + xmlEsc(t.artiste) + '" Title="' + xmlEsc(t.titre) +
      '" Genre="House" Key="Am" Bpm="0.487"></Tags>' +
      '<Infos SongLength="320"></Infos></Song>').join('\n') +
    '\n</VirtualDJ_Database>';
}

function itunesPlist(m) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>\n' +
    '<key>Tracks</key><dict>\n' +
    MORCEAUX.map((t, i) =>
      '<key>' + (i + 1) + '</key><dict>' +
      '<key>Track ID</key><integer>' + (i + 1) + '</integer>' +
      '<key>Name</key><string>' + xmlEsc(t.titre) + '</string>' +
      '<key>Artist</key><string>' + xmlEsc(t.artiste) + '</string>' +
      '<key>Genre</key><string>House</string>' +
      '<key>Total Time</key><integer>320000</integer>' +
      '<key>BPM</key><integer>123</integer>' +
      '<key>Location</key><string>' + xmlEsc(urlEnc(urlFichier(m, t.nom))) + '</string>' +
      '</dict>').join('\n') +
    '\n</dict>\n<key>Playlists</key><array></array>\n</dict></plist>';
}

/* ============================================================
   LE BANC.
   ============================================================ */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-banc-'));
let fichiers = 0;

for (const m of MACHINES) {
  titre(m.nom + '  (' + m.plateforme + ')');
  const surDisque = disqueDe(m);
  const existe = x => surDisque.has(x);

  const formats = {
    rekordbox: { texte: rekordboxXML(m), ext: 'xml' },
    traktor:   { texte: traktorNML(m),   ext: 'nml' },
    virtualdj: { texte: virtualdjXML(m), ext: 'xml' },
    itunes:    { texte: itunesPlist(m),  ext: 'xml' }
  };

  sousPlateforme(m.plateforme, ({ autolib, lib, serato, vol }) => {
    const lus = {};

    for (const [nom, f] of Object.entries(formats)) {
      const fichier = path.join(tmp, m.id + '-' + nom + '.' + f.ext);
      fs.writeFileSync(fichier, f.texte, 'utf8');
      fichiers++;
      let t = [];
      try {
        t = nom === 'rekordbox' ? lib.parseRekordboxXML(fichier)
          : nom === 'traktor'   ? autolib.parseTraktor(fichier, { existe: existe })
          : nom === 'virtualdj' ? autolib.parseVirtualDJ(fichier)
          :                       autolib.parseITunes(fichier);
      } catch (e) { verifier(nom + ' : la lecture ne jette pas', false, e.message); }
      lus[nom] = t;
      verifier(nom.padEnd(10) + ' rend ses ' + MORCEAUX.length + ' morceaux',
               t.length === MORCEAUX.length, t.length + ' lu(s)');
    }

    /* Serato : base binaire, chemins relatifs au volume. */
    const baseSerato = m.racine.replace(/[\\/]+$/, '') + m.sep + '_Serato_' + m.sep + 'database V2';
    const fSerato = path.join(tmp, m.id + '-serato.bin');
    fs.writeFileSync(fSerato, serato.buildTestDatabase(MORCEAUX.map(t => ({
      path: joindre(m, t.nom).replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'),
      title: t.titre, artist: t.artiste, genre: 'House', bpm: 123, key: 'Am', len: '05:20', year: 2000
    }))));
    fichiers++;
    lus.serato = serato.parseDatabase(fSerato, {
      base: vol.racineDuVolume(baseSerato, m.plateforme), plateforme: m.plateforme, existe: existe
    });
    verifier('serato'.padEnd(10) + ' rend ses ' + MORCEAUX.length + ' morceaux',
             lus.serato.length === MORCEAUX.length, lus.serato.length + ' lu(s)');

    /* --------------------------------------------------------
       LA PROPRIETE QUI COMPTE, FORMAT PAR FORMAT.
       -------------------------------------------------------- */
    for (const [nom, t] of Object.entries(lus)) {
      if (!t.length) continue;

      verifier(nom.padEnd(10) + ' : chaque chemin est ABSOLU sur cette machine',
        t.every(x => vol.estAbsolu(String(x.path), m.plateforme === 'win32')),
        t.map(x => x.path).find(x => !vol.estAbsolu(String(x), m.plateforme === 'win32')));

      verifier(nom.padEnd(10) + ' : chaque chemin designe un fichier du disque',
        t.every(x => existe(String(x.path).replace(/\//g, m.sep === '\\' ? '\\' : '/'))
                  || existe(String(x.path))),
        t.map(x => x.path).find(x => !existe(String(x)) &&
             !existe(String(x).replace(/\//g, m.sep === '\\' ? '\\' : '/'))));

      /* L'index de chemins, tel que le cote principal le fabrique. */
      const index = new Map();
      for (const x of t) if (x.path) index.set(lib.cleChemin(x.path), x);

      /* Ce que le logiciel de mix annonce sur le deck : le chemin
         du fichier, dans les formes qu'ils emploient reellement. */
      const annonces = nom => [
        joindre(m, nom),
        joindre(m, nom).replace(/\\/g, '/'),
        'file://localhost' + (m.plateforme === 'win32' ? '/' : '') + joindre(m, nom).replace(/\\/g, '/'),
        joindre(m, nom).normalize('NFD')
      ];
      let retrouves = 0, total = 0;
      for (const mo of MORCEAUX) for (const a of annonces(mo.nom)) {
        total++;
        if (index.get(lib.cleChemin(a))) retrouves++;
      }
      verifier(nom.padEnd(10) + ' : le morceau pose sur le deck est RETROUVE',
        retrouves === total, retrouves + ' / ' + total + ' formes reconnues');
    }
  });
}

/* ============================================================
   LES PANNES QU'ON DOIT SURVIVRE, PARTOUT.
   ============================================================ */
titre('Ce qui doit tenir quoi qu\'il arrive');

for (const m of MACHINES.slice(0, 4)) {
  sousPlateforme(m.plateforme, ({ autolib, lib, serato, vol }) => {
    /* Disque debranche : rien ne repond. On ne doit pas rendre un
       chemin nu — l'elagage ne saurait plus distinguer « efface »
       de « hors ligne ». */
    const jamais = () => false;
    const r = vol.resoudre(m.plateforme === 'win32' ? '/Music/x.mp3' : '/Music/x.mp3',
                           vol.racineDuVolume(
                             m.racine.replace(/[\\/]+$/, '') + m.sep + '_Serato_' + m.sep + 'database V2',
                             m.plateforme),
                           { plateforme: m.plateforme, existe: jamais });
    verifier(m.id.padEnd(10) + ' : disque muet, on rend un chemin exploitable',
      typeof r === 'string' && r.length > 3, r);

    /* Un fichier illisible ne doit pas faire tomber l'import. */
    const casse = path.join(tmp, m.id + '-casse.xml');
    fs.writeFileSync(casse, '<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION><TRA');
    let ok = true;
    try { lib.parseRekordboxXML(casse); } catch (e) { ok = false; }
    verifier(m.id.padEnd(10) + ' : un fichier tronque ne fait pas tomber la lecture', ok);

    /* Une base vide rend un tableau vide, pas une exception. */
    const vide = path.join(tmp, m.id + '-vide.nml');
    fs.writeFileSync(vide, '<NML VERSION="19"><COLLECTION ENTRIES="0"></COLLECTION></NML>');
    let l = null;
    try { l = autolib.parseTraktor(vide); } catch (e) {}
    verifier(m.id.padEnd(10) + ' : une base vide rend une liste vide, pas une erreur',
      Array.isArray(l) && l.length === 0);
  });
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}

console.log(ko ? '\n' + ko + ' cas en echec.\n'
               : '\nbanc : 5 formats x 5 machines, le morceau du deck est toujours retrouve.\n');
process.exit(ko ? 1 : 0);
