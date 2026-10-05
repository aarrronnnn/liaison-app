'use strict';
/* ============================================================
   BANC DE RECONNAISSANCE — le jeu d'evaluation du deck.

   Toutes les propositions partent du morceau reconnu. Si Liaison
   reconnait mal ce qui tourne, le meilleur moteur du monde propose
   la suite d'un AUTRE morceau. Ce banc mesure donc la premiere
   marche : un texte annonce par le logiciel (Serato, VirtualDJ,
   Traktor) -> le bon morceau de la bibliotheque, ou rien.

   Trois issues, et elles ne se valent pas :
     JUSTE  le bon morceau ;
     RIEN   aucun morceau — le widget le dit (« hors bibliotheque »),
            le DJ le voit ;
     FAUX   un autre morceau — la pire, parce qu'elle ne se voit pas
            (ARCHITECTURE §16.8). La regle : zero.

   Les textes annonces sont ceux qu'un logiciel ecrit vraiment : les
   tags tels quels, dans un ordre ou dans l'autre, avec une mention
   de version, sans accents, ou le nom du fichier. Les absents sont
   ceux qu'une soiree amene : un titre que le DJ n'a pas d'un artiste
   qu'il a ; un titre d'un mot qu'un AUTRE artiste a aussi (« Hello »
   d'Adele et celui de Lionel Richie) ; rien de connu.

   A part, la recherche des invites : eux tapent avec des fautes, et
   on mesure si le bon titre est dans les trois premiers.

   La bibliotheque et les textes sont fabriques avec une graine fixe :
   deux executions donnent les memes chiffres sur toutes les machines.
   Ecritures couvertes : francais, anglais, latin etendu (ø ß ł ı),
   cyrillique, arabe, grec, coreen, japonais.

   Usage : node build/banc-reconnaissance.js [--detail]
   Le banc echoue (code 1) a la moindre reconnaissance fausse, si
   moins de 97 % des morceaux presents sont retrouves, ou si moins de
   90 % des recherches d'invites mettent le bon titre dans les trois
   premiers.
   ============================================================ */
const engine = require('../src/engine.js');
const lib = require('../src/library.js');

let graine = 20261005;
const alea = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
const pioche = l => l[Math.floor(alea() * l.length)];

/* Deux vocabulaires par ecriture : celui de la bibliotheque, et celui
   des titres absents. Un absent qui partage TOUS ses mots avec la
   bibliotheque n'est pas un absent realiste, c'est une permutation. */
const MOTS = {
  fr: ['nuit', 'amour', 'soleil', 'danse', 'ville', 'cœur', 'rêve', 'été', 'lumière', 'fête', 'océan', 'étoile',
       'liberté', 'désir', 'rivière', 'printemps', 'mémoire', 'café', 'jardin', 'frère', 'voyage', 'minuit'],
  en: ['night', 'love', 'fire', 'dance', 'heart', 'dream', 'summer', 'light', 'party', 'ocean', 'star', 'freedom',
       'desire', 'river', 'midnight', 'golden', 'gravity', 'thunder', 'paradise', 'shadow', 'feeling', 'forever'],
  ext: ['søster', 'straße', 'łódź', 'kırmızı', 'ærø', 'fjørd', 'gdańsk', 'şarkı', 'kärlek', 'œuvre', 'smørrebrød', 'ışık'],
  cyr: ['ночь', 'любовь', 'солнце', 'танец', 'город', 'сердце', 'мечта', 'лето', 'звезда', 'кровь', 'группа', 'небо'],
  ara: ['ليل', 'حب', 'شمس', 'رقص', 'مدينة', 'قلب', 'حلم', 'صيف', 'نور', 'حبيبي', 'عيون', 'بحر'],
  gre: ['νύχτα', 'αγάπη', 'ήλιος', 'χορός', 'πόλη', 'καρδιά', 'όνειρο', 'καλοκαίρι', 'αστέρι', 'θάλασσα'],
  kor: ['밤', '사랑', '태양', '춤', '도시', '마음', '꿈', '여름', '별', '바다', '봄날', '눈물'],
  jpa: ['夜', '恋', '太陽', '踊り', '街', '心', '夢', '夏', '星', '海', '桜', '群青']
};
const AILLEURS = {
  fr: ['tempête', 'chemin', 'silence', 'horizon', 'miroir', 'saison', 'colère', 'promesse', 'orage', 'fenêtre'],
  en: ['window', 'stranger', 'highway', 'whisper', 'sugar', 'storm', 'mirror', 'pressure', 'ghost', 'diamond'],
  ext: ['ølfabrik', 'größe', 'świat', 'yıldız', 'ærme', 'kłos', 'fünf', 'şehir'],
  cyr: ['ветер', 'дорога', 'тишина', 'зеркало', 'гроза', 'окно', 'дождь', 'песня'],
  ara: ['طريق', 'مطر', 'نافذة', 'ريح', 'صمت', 'مرآة', 'وعد', 'غيمة'],
  gre: ['δρόμος', 'βροχή', 'σιωπή', 'καθρέφτης', 'άνεμος', 'παράθυρο'],
  kor: ['바람', '거울', '비', '창문', '침묵', '약속', '구름', '길'],
  jpa: ['風', '鏡', '雨', '窓', '道', '約束', '雲', '声']
};
const ARTISTES = {
  fr: ['Les Voyageurs', 'Camille Roux', 'Bastien Lefort', 'Nina Delmas', 'Le Grand Orchestre', 'Zoé Martin'],
  en: ['The Midnight Club', 'Sarah Cole', 'Golden Echo', 'Jake Rivers', 'Neon Avenue', 'Lucy Grant'],
  ext: ['Røyksopp', 'Mø', 'Łona', 'Kırmızı Ses', 'Sjöström', 'Ærø Band'],
  cyr: ['Кино', 'Земфира', 'Звери', 'Сплин', 'Мумий Тролль', 'Ночные Снайперы'],
  ara: ['عمرو دياب', 'نانسي عجرم', 'Khaled', 'Cheb Mami', 'إليسا', 'تامر حسني'],
  gre: ['Βανδή', 'Ρέμος', 'Παπαρίζου', 'Mikis Theodorakis'],
  kor: ['아이유', '방탄소년단', 'BIGBANG', '태연'],
  jpa: ['YOASOBI', 'あいみょん', '米津玄師', 'AKB48']
};
const AUTRES_ARTISTES = ['Lionel Richie', 'Whitney Houston', 'Arcade Fire', 'Michael Buble', 'Phil Collins', 'Kendrick Lamar'];
const SANS_ESPACE = { jpa: true };
const joindre = (ecr, mots) => mots.join(SANS_ESPACE[ecr] ? '' : ' ');
const majuscule = (ecr, s) => (ecr === 'fr' || ecr === 'en' || ecr === 'ext') ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* La bibliotheque : chaque artiste, une douzaine de titres distincts.
   Deux titres faits des memes mots dans un autre ordre ne sont pas
   tires : ce serait un piege que personne ne rencontre. */
const brut = [];
const vus = new Set(), sacs = new Set();
let n = 0;
for (const ecr of Object.keys(ARTISTES)) {
  for (const artiste of ARTISTES[ecr]) {
    let k = 0, essais = 0;
    while (k < 12 && essais++ < 400) {
      const nb = 1 + Math.floor(alea() * 3);
      const mots = [];
      for (let i = 0; i < nb; i++) mots.push(pioche(MOTS[ecr]));
      if (new Set(mots).size < mots.length) continue;
      const sac = artiste + '|' + mots.slice().sort().join(' ');
      if (sacs.has(sac)) continue;
      const titre = majuscule(ecr, joindre(ecr, mots));
      sacs.add(sac); vus.add(artiste + '|' + titre); k++;
      brut.push({ path: '/m/' + (++n) + '.mp3', artist: artiste, title: titre, ecr: ecr, mots: mots,
                  bpm: 100 + (n % 40), duration: 180 + (n % 120) });
    }
  }
}
/* Du volume autour, comme une vraie bibliotheque : les mots sont les
   memes, c'est ce qui rend la reconnaissance difficile. */
for (let i = 0; i < 4000; i++) {
  const ecr = pioche(['fr', 'en', 'en', 'fr', 'cyr', 'ara']);
  const titre = pioche(MOTS[ecr]) + ' ' + pioche(MOTS[ecr]) + (i % 7 ? '' : ' ' + pioche(MOTS[ecr]));
  brut.push({ path: '/v/' + i + '.mp3', artist: 'Remplissage ' + (i % 300), title: titre, ecr: 'vol',
              bpm: 90 + (i % 60), duration: 200 });
}
/* Des titres d'un mot, chez un artiste a part : c'est eux qu'un texte
   d'un autre artiste attrapait. */
const MOTS_SEULS = ['Hello', 'Love', 'Home', 'Fire', 'Intro', 'Paradise', 'Halo', 'Crazy', 'Animals', 'Sorry'];
for (const m of MOTS_SEULS) brut.push({ path: '/u/' + m + '.mp3', artist: 'Artiste de ' + m, title: m, ecr: 'mot', bpm: 120, duration: 210 });

const L = lib.finalize(brut.map(t => Object.assign({}, t)));
const parChemin = new Map(L.map(t => [t.path, t]));

/* ---------- les textes annonces par le logiciel ---------- */
const sansAccents = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/æ/g, 'ae').replace(/Æ/g, 'Ae').replace(/œ/g, 'oe')
  .replace(/ß/g, 'ss').replace(/ł/g, 'l').replace(/Ł/g, 'L').replace(/ı/g, 'i');
const textes = [];
for (const t of brut.filter(x => x.ecr !== 'vol' && x.ecr !== 'mot')) {
  const vrai = parChemin.get(t.path);
  const forme = (texte, quoi) => textes.push({ texte, attendu: vrai, quoi, ecr: t.ecr });
  forme(t.artist + ' - ' + t.title, 'artiste - titre');
  forme(t.title + ' - ' + t.artist, 'titre - artiste');
  forme(t.artist + ' - ' + t.title + ' (Extended Mix)', 'version longue');
  forme(t.artist + ' feat. Quelqu\'un - ' + t.title, 'featuring');
  if (t.ecr === 'fr' || t.ecr === 'en' || t.ecr === 'ext') {
    forme(sansAccents(t.artist + ' - ' + t.title).toLowerCase(), 'sans accents, minuscules');
    forme('0' + (1 + (n++ % 9)) + '_' + (t.artist + '-' + t.title).replace(/ /g, '_') + '_(320kbps).mp3', 'nom de fichier');
  }
}

/* ---------- les absents ---------- */
const absents = [];
for (const ecr of Object.keys(ARTISTES)) {
  const siens = brut.filter(x => x.ecr === ecr);
  for (const artiste of ARTISTES[ecr]) {
    for (let i = 0; i < 3; i++) {
      /* un titre qu'il n'a pas, fait d'autres mots */
      const mots = [pioche(AILLEURS[ecr]), pioche(AILLEURS[ecr])];
      absents.push({ texte: artiste + ' - ' + majuscule(ecr, joindre(ecr, mots)), attendu: null, quoi: 'titre absent', ecr: ecr });
    }
    /* un titre qui partage UN mot avec l'un des siens — une autre chanson */
    const sien = siens.find(x => x.artist === artiste && x.mots.length >= 2);
    if (sien) {
      const mots = [sien.mots[0], pioche(AILLEURS[ecr]), pioche(AILLEURS[ecr])];
      absents.push({ texte: artiste + ' - ' + majuscule(ecr, joindre(ecr, mots)), attendu: null, quoi: 'un mot en commun', ecr: ecr });
    }
  }
  absents.push({ texte: 'Inconnu Total - ' + joindre(ecr, [pioche(AILLEURS[ecr]), pioche(AILLEURS[ecr])]), attendu: null, quoi: 'rien de connu', ecr: ecr });
}
/* le meme titre d'un mot, chante par un autre */
for (const m of MOTS_SEULS) {
  absents.push({ texte: pioche(AUTRES_ARTISTES) + ' - ' + m, attendu: null, quoi: 'meme titre, autre artiste', ecr: 'mot' });
  absents.push({ texte: pioche(AUTRES_ARTISTES) + ' - ' + pioche(['I Will Always', 'Another Day in', 'Wake Up My', 'Coming']) + ' ' + m,
                 attendu: null, quoi: 'titre d\'un mot dans un autre', ecr: 'mot' });
}
/* et le titre d'un mot, juste — lui doit etre retrouve */
for (const m of MOTS_SEULS) textes.push({ texte: 'Artiste de ' + m + ' - ' + m, attendu: parChemin.get('/u/' + m + '.mp3'), quoi: 'titre d\'un mot', ecr: 'mot' });

/* ---------- la mesure du deck ---------- */
const detail = process.argv.includes('--detail');
const parEcr = new Map();
const compte = (ecr, issue) => {
  if (!parEcr.has(ecr)) parEcr.set(ecr, { juste: 0, rien: 0, faux: 0, total: 0 });
  const c = parEcr.get(ecr); c[issue]++; c.total++;
};
const parQuoi = new Map();
let juste = 0, faux = 0, absentsFaux = 0;
const t0 = Date.now();
for (const q of textes.concat(absents)) {
  const r = engine.match(q.texte, L);
  const eu = r ? r.track : null;
  let issue;
  if (q.attendu) issue = !eu ? 'rien' : (eu === q.attendu || engine.memeChanson(eu, q.attendu)) ? 'juste' : 'faux';
  else issue = eu ? 'faux' : 'juste';
  compte(q.ecr, issue);
  const pq = parQuoi.get(q.quoi) || { ok: 0, n: 0 };
  pq.n++; if (issue === 'juste') pq.ok++; parQuoi.set(q.quoi, pq);
  if (q.attendu) { if (issue === 'juste') juste++; else if (issue === 'faux') faux++; }
  else if (issue === 'faux') absentsFaux++;
  if (detail && issue !== 'juste')
    console.log('  ' + issue.toUpperCase().padEnd(5) + ' ' + q.quoi.padEnd(28) + JSON.stringify(q.texte) +
                (eu ? '  ->  ' + eu.artist + ' - ' + eu.title + ' (' + r.score.toFixed(2) + ')' : ''));
}
const ms = Date.now() - t0;

/* ---------- la recherche des invites ---------- */
const faute = s => {
  const mots = s.split(' ');
  const i = mots.findIndex(w => w.length >= 5);
  if (i < 0) return null;
  const w = mots[i];
  mots[i] = w.slice(0, w.length - 2) + w[w.length - 1] + w[w.length - 2];      /* deux lettres inversees, en fin de mot */
  return mots.join(' ');
};
let invites = 0, invitesOk = 0;
for (const t of brut.filter(x => x.ecr === 'fr' || x.ecr === 'en' || x.ecr === 'ext')) {
  const f = faute(sansAccents(t.title).toLowerCase());
  if (!f) continue;
  const vrai = parChemin.get(t.path);
  for (const q of [f, t.artist.split(' ').pop().toLowerCase() + ' ' + f]) {
    invites++;
    const s = engine.search(q, L, 3);
    if (s.some(x => x.track === vrai || engine.memeChanson(x.track, vrai))) invitesOk++;
    else if (detail) console.log('  INVITE ' + JSON.stringify(q) + '  ->  ' + s.map(x => x.track.title).join(' | '));
  }
}

console.log('\nbanc de reconnaissance — ' + L.length + ' titres, ' + textes.length + ' textes presents, ' + absents.length + ' absents\n');
console.log('ecriture   juste    rien    faux');
for (const [ecr, c] of parEcr) {
  const p = x => (100 * x / c.total).toFixed(0).padStart(4) + ' %';
  console.log(ecr.padEnd(9) + p(c.juste) + '  ' + p(c.rien) + '  ' + p(c.faux));
}
console.log('\ncas                            justes');
for (const [quoi, c] of parQuoi) console.log('  ' + quoi.padEnd(28) + (100 * c.ok / c.n).toFixed(0).padStart(4) + ' %   (' + c.ok + ' / ' + c.n + ')');
const rappel = juste / textes.length;
const rappelInv = invitesOk / Math.max(1, invites);
console.log('\npresents retrouves        : ' + (100 * rappel).toFixed(1) + ' %   (' + juste + ' / ' + textes.length + ')');
console.log('reconnus a tort           : ' + (faux + absentsFaux) + '   (dont ' + absentsFaux + ' sur des titres absents)');
console.log('invites, bon titre top 3  : ' + (100 * rappelInv).toFixed(1) + ' %   (' + invitesOk + ' / ' + invites + ', avec une faute de frappe)');
console.log('temps moyen               : ' + (ms / (textes.length + absents.length)).toFixed(1) + ' ms par texte annonce');

if (faux + absentsFaux > 0 || rappel < 0.97 || rappelInv < 0.9) {
  console.error('\nRATE : ' + (faux + absentsFaux) + ' reconnaissance(s) fausse(s), rappel ' + (100 * rappel).toFixed(1) +
                ' % (seuil 97 %), invites ' + (100 * rappelInv).toFixed(1) + ' % (seuil 90 %).');
  process.exit(1);
}
console.log('\nreconnaissance : zero faux, et ce qui est la est retrouve.');
