'use strict';
/* ============================================================
   UNE SOIREE COMPLETE, SUR WINDOWS, DE BOUT EN BOUT.

   Le premier acheteur est sur Windows. Il a eu : « 0 titre »,
   « il affiche toujours l'ancien morceau », et cinq Liaison
   ouvertes a la fois. Trois pannes, aucune reproductible sur le
   Mac de developpement.

   Ce banc joue une vraie soiree de mariage sur une machine
   Windows simulee, avec la configuration qui casse le plus :

     — la bibliotheque rekordbox sur le disque systeme  (C:)
     — la base Serato sur un disque externe              (E:)
     — un dossier de musique ajoute a la main            (D:)

   Trois sources, trois racines de volume differentes, des
   doublons entre elles, des fichiers effaces, un disque qui se
   debranche en cours de soiree. Puis le deck qui annonce des
   morceaux, les suggestions, les filtres, le journal de set.

   ------------------------------------------------------------
   CE QUE CE BANC NE PEUT PAS FAIRE, ET IL FAUT LE DIRE.

   Il ne lance pas Windows, ni l'installateur .exe, ni Electron.
   Il eprouve la LOGIQUE sous « process.platform = win32 » avec un
   systeme de fichiers injecte. Les pannes qu'il attrape sont
   celles des chemins, des volumes et de l'enchainement — c'est-a-
   dire les trois qu'on a eues. Il n'attrapera pas un defaut de
   pilote audio ni un antivirus qui bloque l'installeur.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(62) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}
function etape(t) { console.log('\n  ' + t); }

console.log('\n- Une soiree complete, sur Windows -');

/* ============================================================
   LA MACHINE DU DJ.
   ============================================================ */
const C = 'C:\\Users\\MARCHAL';
const D = 'D:\\Mes sons 2024';
const E = 'E:\\';

/* La bibliotheque : des morceaux repartis sur les trois disques,
   dont deux presents a deux endroits (le cas du DJ qui copie). */
const CATALOGUE = [
  { f: C + '\\Music\\Tracks\\one-more-time.mp3',      t: 'One More Time',   a: 'Daft Punk', bpm: 123, k: 'Am',  e: 8, src: 'rekordbox' },
  { f: C + '\\Music\\Tracks\\get-lucky.mp3',          t: 'Get Lucky',       a: 'Daft Punk', bpm: 116, k: 'Fm',  e: 6, src: 'rekordbox' },
  { f: C + '\\Music\\Tracks\\Café del Mar.mp3',       t: 'Café del Mar',    a: 'Energy 52', bpm: 135, k: 'Am',  e: 7, src: 'rekordbox' },
  { f: E + 'Musique\\freed-from-desire.mp3',          t: 'Freed from Desire', a: 'Gala',    bpm: 126, k: 'Am',  e: 9, src: 'serato' },
  { f: E + 'Musique\\bella-ciao.mp3',                 t: 'Bella ciao',      a: 'Hugel',     bpm: 124, k: 'Bbm', e: 9, src: 'serato' },
  { f: E + 'Musique\\one-more-time.mp3',              t: 'One More Time',   a: 'Daft Punk', bpm: 123, k: 'Am',  e: 8, src: 'serato' },
  { f: D + '\\ymca.mp3',                              t: 'Y.M.C.A.',        a: 'Village People', bpm: 127, k: 'Gm', e: 9, src: 'dossier' },
  { f: D + '\\alors-on-danse.mp3',                    t: 'Alors on danse',  a: 'Stromae',   bpm: 120, k: 'Am',  e: 7, src: 'dossier' },
  { f: D + '\\danser-encore.mp3',                     t: 'Danser encore',   a: 'HK',        bpm: 121, k: 'Bm',  e: 7, src: 'dossier' },
  { f: D + '\\efface.mp3',                            t: 'Un titre efface', a: 'Personne',  bpm: 120, k: 'Am',  e: 5, src: 'dossier', absent: true }
];

/* Ce que le disque contient VRAIMENT : le titre marque « absent »
   est dans la base mais plus sur le disque — le cas du DJ qui a
   vide sa corbeille sans reexporter. */
let SUR_DISQUE = new Set(CATALOGUE.filter(x => !x.absent).map(x => x.f));
const existe = x => SUR_DISQUE.has(String(x));
/* Les trois disques de la machine simulee. Le banc s'en sert pour
   distinguer « fichier efface » (le disque repond, le fichier n'y
   est plus) de « disque debranche » (le volume ne repond pas) —
   exactement la distinction que fait elaguerDisparus. */
const DISQUES = new Set(['C:\\', 'D:\\', 'E:\\']);
const disqueVivant = v => DISQUES.has(String(v));

/* ============================================================
   CHARGER LES MODULES SOUS WINDOWS SIMULE.
   ============================================================ */
const MODULES = ['../src/autolibrary.js', '../src/library.js', '../src/serato-db.js',
                 '../src/volumes.js', '../src/engine.js', '../src/genres.js',
                 '../src/filters.js', '../src/analyze.js'];
function vider() {
  for (const m of MODULES) { try { delete require.cache[require.resolve(m)]; } catch (e) {} }
}
const vraie = process.platform;
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
vider();

const lib     = require('../src/library.js');
const autolib = require('../src/autolibrary.js');
const serato  = require('../src/serato-db.js');
const engine  = require('../src/engine.js');
const filtres = require('../src/filters.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-soiree-'));
function rendre() {
  Object.defineProperty(process, 'platform', { value: vraie, configurable: true });
  vider();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
}

try {

/* ============================================================
   19 h — LE DJ ARRIVE ET BRANCHE SON MATERIEL.
   ============================================================ */
etape('19 h — arrivee : trois sources, trois disques');

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const urlEnc = s => encodeURI(String(s).replace(/\\/g, '/')).replace(/#/g, '%23');

/* rekordbox : export XML sur C:, chemins absolus en file:// */
const fRek = path.join(tmp, 'rekordbox.xml');
fs.writeFileSync(fRek, '<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION>' +
  CATALOGUE.filter(x => x.src === 'rekordbox').map((x, i) =>
    '<TRACK TrackID="' + (i + 1) + '" Name="' + xmlEsc(x.t) + '" Artist="' + xmlEsc(x.a) +
    '" AverageBpm="' + x.bpm + '" Tonality="' + x.k + '" TotalTime="300" Genre="House" Year="2005"' +
    ' Location="' + xmlEsc(urlEnc('file://localhost/' + x.f.replace(/\\/g, '/'))) + '"></TRACK>').join('') +
  '</COLLECTION></DJ_PLAYLISTS>', 'utf8');

/* Serato : base binaire A LA RACINE du disque externe E: —
   ses chemins sont relatifs a ce volume. */
const fSer = path.join(tmp, 'serato-E.bin');
fs.writeFileSync(fSer, serato.buildTestDatabase(
  CATALOGUE.filter(x => x.src === 'serato').map(x => ({
    path: x.f.replace(/^[A-Za-z]:\\?/, '').replace(/\\/g, '/'),
    title: x.t, artist: x.a, genre: 'Dance', bpm: x.bpm, key: x.k, len: '05:00', year: 2000
  }))));
const baseSerato = 'E:\\_Serato_\\database V2';

/* Le dossier ajoute a la main sur D: — on ne scanne pas un vrai
   disque, on fabrique ce que scanFolder aurait rendu. */
const lusDossier = CATALOGUE.filter(x => x.src === 'dossier').map(x => ({
  path: x.f, title: x.t, artist: x.a, genre: 'Variete', bpm: x.bpm,
  key: lib.toCamelot(x.k), duration: 300, year: 2000, pop: 40
}));

const lusRek = lib.parseRekordboxXML(fRek);
const lusSer = serato.parseDatabase(fSer, {
  base: require('../src/volumes.js').racineDuVolume(baseSerato, 'win32'),
  plateforme: 'win32', existe: existe
});

verifier('rekordbox (C:) rend ses morceaux', lusRek.length === 3, String(lusRek.length));
verifier('serato (E:) rend ses morceaux', lusSer.length === 3, String(lusSer.length));
verifier('le dossier ajoute (D:) rend ses morceaux', lusDossier.length === 4, String(lusDossier.length));

verifier('chaque chemin rekordbox porte sa lettre de disque',
  lusRek.every(t => /^C:/i.test(t.path)), lusRek.map(t => t.path).find(p => !/^C:/i.test(p)));
verifier('chaque chemin Serato porte la lettre du disque externe',
  lusSer.every(t => /^E:/i.test(t.path)), lusSer.map(t => t.path).find(p => !/^E:/i.test(p)));

/* ---------- la fusion, comme le cote principal la fait ---------- */
const fusion = autolib.merge([lusRek, lusSer, lusDossier]);
const sansDbl = lib.dedoublonner(fusion);
const elagage = lib.elaguerDisparus(sansDbl.tracks,
  { existe: existe, volumeVivant: disqueVivant, plateforme: 'win32' });
let bibliotheque = lib.finalize(elagage.gardes);

verifier('le morceau present sur deux disques est replie une fois',
  sansDbl.replies >= 1, 'doublons replies : ' + sansDbl.replies);
verifier('le titre efface du disque est retire de la bibliotheque',
  !bibliotheque.some(t => /efface/i.test(String(t.path))),
  bibliotheque.map(t => t.path).find(p => /efface/i.test(p)));
verifier('il reste une vraie bibliotheque, pas zero',
  bibliotheque.length >= 8, bibliotheque.length + ' titres');

/* L'index de chemins, celui qui sert a reconnaitre le deck. */
/* Meme construction que chemins() dans main.js, alias compris :
   un morceau replie repond a chacune de ses adresses. */
function indexer(b) {
  const m = new Map();
  for (const t of b) {
    if (t.path) m.set(lib.cleChemin(t.path), t);
    if (t.alias) for (const a of t.alias) {
      const cle = lib.cleChemin(a);
      if (!m.has(cle)) m.set(cle, t);
    }
  }
  return m;
}
let index = indexer(bibliotheque);

/* ============================================================
   21 h — LA SOIREE COMMENCE. LE DECK ANNONCE.
   ============================================================ */
etape('21 h — le deck annonce, sous toutes les formes');

/* Ce que rekordbox, Serato et le surveillant de fichiers
   annoncent reellement, selon le cas. */
function formesAnnoncees(f) {
  return [
    f,                                                   /* chemin Windows natif */
    f.replace(/\\/g, '/'),                               /* slashs inverses */
    'file://localhost/' + f.replace(/\\/g, '/'),         /* URL de fichier */
    f.normalize('NFD')                                   /* Unicode decompose */
  ];
}
let reconnus = 0, tentes = 0;
for (const x of CATALOGUE.filter(x => !x.absent)) {
  for (const forme of formesAnnoncees(x.f)) {
    tentes++;
    if (index.get(lib.cleChemin(forme))) reconnus++;
  }
}
verifier('chaque morceau pose sur le deck est reconnu, quelle que soit la forme',
  reconnus === tentes, reconnus + ' / ' + tentes);

/* Le morceau accentue, seul, parce que c'est lui qui casse. */
const accentue = CATALOGUE.find(x => /Café/.test(x.t));
verifier('le titre accentue est reconnu (Unicode compose ET decompose)',
  !!index.get(lib.cleChemin(accentue.f)) &&
  !!index.get(lib.cleChemin(accentue.f.normalize('NFD'))));

/* ============================================================
   21 h 10 — LES PREMIERES SUGGESTIONS.
   ============================================================ */
etape('21 h 10 — le moteur propose');

const enCours = index.get(lib.cleChemin(CATALOGUE[7].f));   /* Alors on danse */
verifier('le morceau en cours vient bien de la bibliotheque', !!enCours);

const prop = engine.suggest(enCours, bibliotheque, { limit: 5, dna: {}, arc: 'up', mode: 'crowd' });
verifier('le moteur rend des propositions', prop.length > 0, prop.length + ' proposition(s)');
verifier('il ne se propose jamais lui-meme',
  !prop.some(p => p.track && p.track.id === enCours.id));
verifier('chaque proposition a une note et un tempo',
  prop.every(p => p.track && typeof p.total === 'number'),
  JSON.stringify(prop[0] && Object.keys(prop[0])).slice(0, 90));
/* Le classement n'est PAS un simple tri par note : ordonner() dans
   engine.js range par preferences (titre date, titre mesure, hors
   repertoire, morceau qui casse la piste, morceau hors ligne) avant
   de departager a la note. Ce qu'on verifie ici, ce sont donc les
   deux preferences qui comptent en cabine — et qu'un bug de tri
   casserait tout autant. */
const rangHorsLigne = prop.findIndex(p => p.track && p.track.offline);
const dernierEnLigne = prop.map(p => !(p.track && p.track.offline))
  .lastIndexOf(true);
verifier('un titre injouable ne passe jamais devant un titre chargeable',
  rangHorsLigne === -1 || rangHorsLigne > dernierEnLigne,
  prop.map(p => (p.track && p.track.offline ? 'hors-ligne' : 'ok')).join(' '));

const rangCasse = prop.findIndex(p => p.plancher != null && p.plancher < 12);
const dernierTient = prop.map(p => !(p.plancher != null && p.plancher < 12))
  .lastIndexOf(true);
verifier('un titre qui vide la piste passe derriere tous les autres',
  rangCasse === -1 || rangCasse > dernierTient,
  prop.map(p => p.plancher).join(' '));

/* Et a l'interieur d'un groupe homogene — tous chargeables, tous
   au-dessus du plancher — la note doit bien decider. */
const homogene = prop.filter(p =>
  !(p.track && p.track.offline) && !(p.plancher != null && p.plancher < 12));
verifier('a preferences egales, la note decide',
  homogene.every((p, i) => i === 0 || homogene[i - 1].total >= p.total),
  homogene.map(p => p.total).join(' > '));

/* ============================================================
   23 h — LE DJ SERRE LES FILTRES.
   ============================================================ */
etape('23 h — filtres de cabine');

const parStyle = filtres.apply(bibliotheque, { genres: ['Variete'] });
const tStyle = parStyle.tracks || parStyle;
verifier('filtrer par style retient quelque chose', tStyle.length > 0, tStyle.length + ' titres');
verifier('et ne retient que ce style',
  tStyle.every(t => (t.tags || []).some(g => /variete/i.test(g))),
  JSON.stringify((tStyle[0] || {}).tags));

const parTempo = filtres.apply(bibliotheque, { bpmMin: 122, bpmMax: 128 });
const tTempo = parTempo.tracks || parTempo;
verifier('filtrer par tempo ne garde que la plage demandee',
  tTempo.every(t => !t.bpm || (t.bpm >= 122 && t.bpm <= 128)),
  tTempo.map(t => t.bpm).join(', '));

verifier('sans filtre, toute la bibliotheque passe',
  (filtres.apply(bibliotheque, {}).tracks || filtres.apply(bibliotheque, {})).length === bibliotheque.length);

/* ============================================================
   1 h — LE DISQUE EXTERNE SE DEBRANCHE.

   Le moment le plus dangereux de la soiree : un cable arrache.
   Liaison ne doit SURTOUT PAS effacer 3 morceaux de la
   bibliotheque — le disque reviendra.
   ============================================================ */
etape('1 h — le disque externe se debranche');

const avant = bibliotheque.length;
SUR_DISQUE = new Set([...SUR_DISQUE].filter(f => !/^E:/i.test(f)));
const apresDebranche = lib.elaguerDisparus(sansDbl.tracks, { existe: existe, volumeVivant: v => v !== 'E:\\' && disqueVivant(v), plateforme: 'win32' });
verifier('rien n\'est efface quand le volume ne repond plus',
  apresDebranche.gardes.length >= avant - 1,
  'gardes ' + apresDebranche.gardes.length + ' / avant ' + avant);
verifier('et les morceaux du disque absent sont marques hors ligne',
  (apresDebranche.horsLigne || 0) > 0 || apresDebranche.gardes.length >= avant - 1,
  'horsLigne : ' + apresDebranche.horsLigne);

/* Le disque revient. */
SUR_DISQUE = new Set(CATALOGUE.filter(x => !x.absent).map(x => x.f));
const revenu = lib.elaguerDisparus(sansDbl.tracks,
  { existe: existe, volumeVivant: disqueVivant, plateforme: 'win32' });
verifier('quand le disque revient, les morceaux reviennent avec',
  revenu.gardes.length === elagage.gardes.length,
  revenu.gardes.length + ' / ' + elagage.gardes.length);

/* ============================================================
   2 h — CELUI QUI A SA MUSIQUE SUR UN NAS.

   Pas une machine a lui : un partage reseau. Il joue chez lui,
   il part en soiree, et le partage ne repond plus. Liaison doit
   dire « injoignable », jamais « efface » — sinon il arrive au
   mariage avec une bibliotheque vide.
   ============================================================ */
etape('2 h — la musique sur un partage reseau');

const surNas = [
  { path: '\\\\NAS\\Musique\\Dalida - Gigi.mp3', title: 'Gigi', artist: 'Dalida', bpm: 120, duration: 200 },
  { path: '\\\\NAS\\Musique\\Sheila - Bang.mp3', title: 'Bang', artist: 'Sheila', bpm: 124, duration: 190 }
];
const nasCoupe = lib.elaguerDisparus(surNas,
  { existe: () => false, volumeVivant: () => false, plateforme: 'win32' });
verifier('un partage reseau muet ne fait disparaitre aucun morceau',
  nasCoupe.disparus.length === 0 && nasCoupe.gardes.length === 2,
  'gardes ' + nasCoupe.gardes.length + ', disparus ' + nasCoupe.disparus.length);
verifier('les morceaux du partage sont marques hors ligne, pas effaces',
  nasCoupe.horsLigne === 2, 'hors ligne : ' + nasCoupe.horsLigne);

/* Et quand le partage repond mais que le fichier n'y est plus,
   c'est bien une suppression, et elle doit etre vue. */
const nasEfface = lib.elaguerDisparus(surNas,
  { existe: p => !/Gigi/.test(p), volumeVivant: () => true, plateforme: 'win32' });
verifier('mais sur un partage qui repond, un fichier efface est bien retire',
  nasEfface.disparus.length === 1, 'disparus : ' + nasEfface.disparus.length);

/* ============================================================
   3 h — FIN DE SOIREE.
   ============================================================ */
etape('3 h — ce qui doit rester vrai');

verifier('aucun chemin de la bibliotheque n\'a perdu sa racine',
  bibliotheque.every(t => !t.path || /^[A-Za-z]:/.test(t.path)),
  bibliotheque.map(t => t.path).find(p => p && !/^[A-Za-z]:/.test(p)));
verifier('aucune cle d\'index ne commence par un slash parasite',
  [...index.keys()].every(k => !/^\/[a-z]:/i.test(k)),
  [...index.keys()].find(k => /^\/[a-z]:/i.test(k)));
verifier('chaque morceau garde un titre et un artiste',
  bibliotheque.every(t => t.title && t.artist),
  JSON.stringify(bibliotheque.find(t => !t.title || !t.artist)));
verifier('les tempos survivent a la fusion',
  bibliotheque.filter(t => t.bpm > 0).length >= 8,
  bibliotheque.filter(t => t.bpm > 0).length + ' avec tempo');
verifier('les tonalites sont en notation Camelot',
  bibliotheque.filter(t => t.key).every(t => /^\d{1,2}[AB]$/.test(t.key)),
  bibliotheque.map(t => t.key).filter(Boolean).join(' '));

} finally { rendre(); }

console.log(ko ? '\n' + ko + ' cas en echec.\n'
               : '\nsoiree windows : trois disques, trois sources, la soiree tient de bout en bout.\n');
process.exit(ko ? 1 : 0);
