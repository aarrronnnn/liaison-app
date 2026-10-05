'use strict';
/* ============================================================
   TOUTES LES ECRITURES, PAS SEULEMENT L'ALPHABET LATIN.

   Audit du 5 octobre 2026. La mise a plat du texte — celle qui
   sert a reconnaitre le morceau annonce par Serato, VirtualDJ ou
   Traktor, a chercher un titre pour un invite, a replier les
   doublons — ne gardait que a-z et 0-9. Pour un DJ dont la
   bibliotheque parle arabe, russe, grec, coreen ou japonais :

   1. RECONNAITRE A TORT. « Khaled - عبد القادر » se reduisait a
      « khaled » : TOUS les titres de Khaled ressemblaient a 1,00,
      et le premier de la liste gagnait. Le widget affichait un autre
      morceau, avec un autre tempo et une autre tonalite, et toutes
      les propositions partaient de lui. C'est la pire des deux
      erreurs (ARCHITECTURE §16.8) : elle ne se voit pas.
   2. NE RIEN RECONNAITRE. « Кино - Группа крови » se reduisait a
      rien : morceau « hors bibliotheque » alors qu'il y est, et la
      recherche des invites ne trouvait rien.
   3. REPLIER DES CHANSONS DIFFERENTES. Deux titres arabes du meme
      artiste, de durees voisines, devenaient UN doublon : l'un
      disparaissait des propositions, et l'ecran de sante invitait
      le DJ a effacer une vraie chanson.
   4. SERATO COUPAIT LE TITRE. L'historique ne gardait que les
      caracteres latins : un titre cyrillique ou arabe n'arrivait
      jamais jusqu'au moteur. Et un titre latin de 33 a 61 lettres
      recevait une lettre parasite devant son premier mot.

   Et, a l'inverse, les lettres latines qui ne se decomposent pas —
   ø, æ, œ, ß, ł, ı — coupaient les mots en deux : « Røyksopp »
   devenait « r yksopp ».
   ============================================================ */
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const health = require('../src/health.js');
const serato = require('../src/sources/serato.js');

let echecs = 0, cas = 0;
function verifier(quoi, condition, detail) {
  cas++;
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(64), detail ? '  — ' + detail : '');
}

console.log('\n- toutes les ecritures -\n');

let n = 0;
const m = (title, artist, o) => lib.finalize([Object.assign(
  { path: '/m/' + (++n) + '.mp3', title, artist, bpm: 120, key: '8A', genre: 'Pop', duration: 200 + n }, o || {})])[0];

/* ---------- 1. la mise a plat garde les lettres ---------- */
{
  const k = engine.normalize('Кино - Группа крови');
  verifier('normalize garde le cyrillique', /группа/.test(k), JSON.stringify(k));
  verifier('normalize garde l\'arabe', engine.normalize('Khaled - عبد القادر').includes('عبد'),
           JSON.stringify(engine.normalize('Khaled - عبد القادر')));
  verifier('normalize : ø æ œ ß ł ı se replient en latin',
           engine.normalize('Røyksopp Ærø Cœur Straße Łódź Kırmızı') === 'royksopp aero coeur strasse lodz kirmizi',
           JSON.stringify(engine.normalize('Røyksopp Ærø Cœur Straße Łódź Kırmızı')));
  verifier('normalize : un coreen decompose (NFD, macOS) vaut le compose',
           engine.normalize('사랑해'.normalize('NFD')) === engine.normalize('사랑해'));
  verifier('normalize : les emoji seuls restent vides (rien ne ressemble a tout)',
           engine.normalize('🔥🔥🔥') === '');
}

/* ---------- 2. reconnaitre le bon, ou rien ---------- */
const L = [
  m('ديدي', 'Khaled'), m('عبد القادر', 'Khaled'), m('Aïcha', 'Khaled'),
  m('Кукушка', 'Кино'), m('Группа крови', 'Кино'), m('Нурминский', 'Валентин Стрыкало'),
  m('تملي معاك', 'Amr Diab'), m('حبيبي يا نور العين', 'Amr Diab'),
  m('봄날', 'BTS'), m('Dynamite', 'BTS'),
  m('恋するフォーチュンクッキー', 'AKB48'), m('ヘビーローテーション', 'AKB48'),
  m('Καλημέρα', 'Βανδή'), m('Ζορμπάς', 'Mikis Theodorakis'),
  m('Lean On', 'MØ'), m('Eple', 'Røyksopp'), m('Kırmızı', 'Hande Yener'), m('Łódź nocą', 'Łona'),
  m('Straße der Sehnsucht', 'Tarkan'), m('Cœur de pirate', 'Cœur de pirate'),
  m('Dancing Queen', 'ABBA'), m('One More Time', 'Daft Punk'), m('Get Lucky', 'Daft Punk')
];
for (let i = 0; i < 400; i++) L.push(m('Filler ' + i + ' love night', 'Artist ' + i));

const attendus = [
  ['Khaled - عبد القادر', 'عبد القادر'],
  ['Khaled - وهران', null],                          /* absent : rien, surtout pas Didi */
  ['Kino - Пачка сигарет', null],
  ['Кино - Группа крови', 'Группа крови'],
  ['Группа крови - Кино', 'Группа крови'],
  ['Amr Diab - حبيبي يا نور العين', 'حبيبي يا نور العين'],
  ['BTS - 피 땀 눈물', null],
  ['BTS - 봄날', '봄날'],
  ['AKB48 - ヘビーローテーション', 'ヘビーローテーション'],
  ['Βανδή - Καλημέρα', 'Καλημέρα'],
  ['MO - Lean On', 'Lean On'],
  ['Royksopp - Eple', 'Eple'],
  ['hande yener kirmizi', 'Kırmızı'],
  ['lona lodz noca', 'Łódź nocą'],
  ['tarkan strasse der sehnsucht', 'Straße der Sehnsucht'],
  ['coeur de pirate', 'Cœur de pirate'],
  ['Queen - Dancing in the Street', null],            /* le garde-fou d'origine tient */
  ['Daft Punk - One More Time', 'One More Time']
];
for (const [q, voulu] of attendus) {
  const r = engine.match(q, L);
  const eu = r ? r.track.title : null;
  verifier('match « ' + q + ' »', eu === voulu, 'rend ' + JSON.stringify(eu) + (r ? ' (' + r.score.toFixed(2) + ')' : ''));
}

/* ---------- 3. la recherche des invites ---------- */
{
  const s = engine.search('группа крови', L, 5);
  verifier('recherche « группа крови »', !!(s[0] && s[0].track.title === 'Группа крови'),
           s.map(x => x.track.title).join(', ') || 'rien');
  const a = engine.search('حبيبي', L, 5);
  verifier('recherche « حبيبي »', !!(a[0] && a[0].track.title === 'حبيبي يا نور العين'),
           a.map(x => x.track.title).join(', ') || 'rien');
  /* Le japonais n'a pas d'espaces : un bout de titre doit suffire,
     meme quand la bibliotheque est trop grande pour le balayage de
     secours (6 000 titres). */
  const gros = L.slice();
  for (let i = 0; i < 8000; i++) gros.push(m('Remplissage ' + i, 'Quelqu\'un ' + i));
  gros.push(m('夜に駆ける', 'YOASOBI'));
  const j = engine.search('駆ける', gros, 5);
  verifier('recherche d\'un bout de titre japonais dans 8 000 titres', !!(j[0] && j[0].track.title === '夜に駆ける'),
           j.map(x => x.track.title).join(', ') || 'rien');
  const k = engine.search('フォーチュン', gros, 5);
  verifier('recherche « フォーチュン »', !!(k[0] && k[0].track.title === '恋するフォーチュンクッキー'),
           k.map(x => x.track.title).join(', ') || 'rien');
}

/* ---------- 3bis. les bigrammes tries ne debordent pas ----------
   Un bigramme est range sur 32 bits (deux codes de 16 bits). En
   entier SIGNE, tout caractere au-dela de U+8000 — le han, le
   hangul — passait en negatif, et le tri par insertion comparait
   des nombres qui n'etaient plus les memes : la note par l'index
   ne valait plus la note calculee directement. */
{
  const L2 = lib.finalize([{ path: '/k.mp3', title: '밤편지 너의 의미 좋은 날', artist: '아이유', bpm: 100 },
                           { path: '/j.mp3', title: '夜に駆ける 群青 怪物', artist: 'YOASOBI', bpm: 130 }]);
  engine.prechauffer(L2, 0, L2.length);
  for (const [q, i] of [['아이유 밤편지 좋은', 0], ['群青 夜に駆ける yoasobi', 1]]) {
    const r = engine.search(q, [L2[i]], 1, 0)[0];
    const direct = Math.max(...engine.formesDe(L2[i]).map(x => engine.combine(engine.normalize(q), x)));
    verifier('note par l\'index = note directe (« ' + q + ' »)', !!r && Math.abs(r.score - direct) < 1e-9,
             (r ? r.score.toFixed(4) : 'rien') + ' contre ' + direct.toFixed(4));
  }
}

/* ---------- 4. les doublons ---------- */
{
  const brut = [
    { path: '/m/khaled-didi.mp3',   artist: 'Khaled', title: 'ديدي',  bpm: 120, duration: 290, bpmSrc: 'serato' },
    { path: '/m/khaled-wahran.mp3', artist: 'Khaled', title: 'وهران', bpm: 112, duration: 292, bpmSrc: 'serato' },
    { path: '/m/zorba.mp3',   artist: 'Mikis Theodorakis', title: 'Ζορμπάς', bpm: 100, duration: 260 },
    { path: '/m/syrtaki.mp3', artist: 'Mikis Theodorakis', title: 'Συρτάκι', bpm: 140, duration: 262 },
    /* une vraie copie, elle : meme titre, meme duree */
    { path: '/m/didi-copie.mp3', artist: 'Khaled', title: 'ديدي', bpm: 120, duration: 290.4, bpmSrc: 'tag' },
    /* un titre fait seulement de symboles : pas d'identite, jamais replie */
    { path: '/m/a.mp3', artist: 'Inconnu', title: '???', duration: 200 },
    { path: '/m/b.mp3', artist: 'Inconnu', title: '!!!', duration: 201 }
  ];
  const r = lib.dedoublonner(brut.map(t => Object.assign({}, t)));
  const titres = r.tracks.map(t => t.title).sort();
  verifier('dedoublonner : deux chansons arabes differentes restent deux', titres.includes('ديدي') && titres.includes('وهران'),
           titres.join(' | '));
  verifier('dedoublonner : deux chansons grecques differentes restent deux', titres.includes('Ζορμπάς') && titres.includes('Συρτάκι'));
  verifier('dedoublonner : la vraie copie arabe est repliee', r.replies === 1, r.replies + ' repli(s)');
  verifier('dedoublonner : des titres sans lettres ne se replient pas', titres.includes('???') && titres.includes('!!!'));
  const b = health.bilan(lib.finalize(brut.map(t => Object.assign({}, t))), { verifierFichiers: false });
  verifier('sante : un seul groupe de doublons signale (la vraie copie)', b.doublons.groupes.length === 1,
           b.doublons.groupes.map(g => g.copies.map(c => c.path).join('+')).join(' / '));
}

/* ---------- 5. l'historique de Serato ---------- */
{
  /* Une session Serato : des blocs « oent » > « adat », chaque champ
     = identifiant (4 octets) + longueur (4 octets) + valeur. Les
     textes sont en UTF-16 gros-boutiste ; les dates sont des entiers
     de 4 octets dont l'octet de poids fort tombe, en 2026, dans la
     plage des ideogrammes chinois. */
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
  const utf16 = s => { const le = Buffer.from(s, 'utf16le'); for (let i = 0; i + 1 < le.length; i += 2) { const x = le[i]; le[i] = le[i + 1]; le[i + 1] = x; } return le; };
  const champ = (id, val) => Buffer.concat([u32(id), u32(val.length), val]);
  const bloc = (tag, corps) => Buffer.concat([Buffer.from(tag, 'ascii'), u32(corps.length), corps]);
  const entree = (titre, artiste, chemin) => bloc('oent', bloc('adat', Buffer.concat([
    champ(1, u32(7)),
    champ(2, utf16(chemin)),
    champ(6, utf16(titre)),
    champ(7, utf16(artiste)),
    champ(28, u32(0x6AC29C80)), champ(29, u32(0x6AC2A1F3)),
    champ(31, u32(1)), champ(50, Buffer.from([1]))
  ])));
  const long = 'Mr. Brightside (Jacques Lu Cont Thin White Duke Mix)';    /* 52 lettres */
  const buf = Buffer.concat([
    Buffer.from('vrsn', 'ascii'), u32(4), Buffer.from([0, 0, 0, 2]),
    entree('Группа крови', 'Кино', '/Users/dj/Music/kino.mp3'),
    entree('حبيبي يا نور العين', 'Amr Diab', '/Users/dj/Music/amr.mp3'),
    entree(long, 'The Killers', '/Users/dj/Music/killers.mp3')
  ]);
  const s = serato.strings(buf);
  verifier('Serato : le titre cyrillique arrive entier', s.includes('Группа крови'), JSON.stringify(s.slice(0, 4)));
  verifier('Serato : le titre arabe arrive entier', s.includes('حبيبي يا نور العين'));
  verifier('Serato : un titre long n\'a pas de lettre parasite devant', s.includes(long),
           JSON.stringify(s.find(x => x.includes('Brightside'))));
  verifier('Serato : pas de chaine fabriquee avec les dates', s.every(x => !/[一-鿿]/.test(x)),
           JSON.stringify(s.filter(x => /[一-鿿]/.test(x))));
  /* Un drapeau d'un octet decale la suite d'un octet : la lecture ne
     doit pas en dependre. */
  const decale = Buffer.concat([Buffer.from([7]), buf]);
  verifier('Serato : un tampon decale d\'un octet se lit pareil', serato.strings(decale).includes('Группа крови'));
  /* Structure non reconnue (format futur) : l'ancien balayage reprend,
     elargi aux autres ecritures, sans la lettre parasite. */
  const vrac = Buffer.concat([u32(0), u32(24), utf16('Группа крови'), u32(6), u32(long.length * 2), utf16(long), u32(0)]);
  const v = serato.strings(vrac);
  verifier('Serato, repli : le cyrillique et le titre long passent entiers',
           v.includes('Группа крови') && v.includes(long), JSON.stringify(v));
}

console.log('\n' + (cas - echecs) + ' / ' + cas + ' controles.');
if (echecs) { console.error(echecs + ' controle(s) en echec.'); process.exit(1); }
console.log('toutes les ecritures : reconnues, cherchees, jamais confondues.');
