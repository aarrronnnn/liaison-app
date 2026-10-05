'use strict';
/* ============================================================
   LES CAS LIMITES TROUVES PAR L'AUDIT DU 5 OCTOBRE 2026.

   Chaque cas a ete reproduit sur le vrai code avant d'etre corrige.
   Ce banc les garde fermes.

   LE MOTEUR
   1. Le repli par paliers comptait les morceaux HORS LIGNE : cinq
      titres d'un SSD debranche suffisaient a « remplir » la liste,
      et le DJ recevait cinq propositions impossibles a charger
      alors que dix morceaux du disque interne existaient a 4 %.
   2. Il comptait des FICHIERS, pas des chansons : quatre versions
      d'un meme titre dans la fenetre « remplissaient » la liste,
      puis sansDoubles() les ramenait a une ligne — deux
      propositions rendues sur cinq demandees.
   3. transitionOf() lisait l'ecart de tempo sans regarder s'il
      etait CONNU : un morceau sans tempo recevait « Les tempos se
      calent » ou « Blend long — 32 temps », annonces avec
      l'assurance d'une mesure.
   4. Un genre « Constructor » lisait Object.prototype.constructor
      dans les tables de plancher et de fraicheur : NaN.
   5. Les bigrammes d'un titre tres long se triaient en n² : 288 ms
      pour un titre de 20 000 caracteres, sur le fil du widget.
   6. Le meme morceau present deux fois (meme objet) sortait deux
      fois quand il n'avait ni artiste ni titre.
   7. Huit tonalites enharmoniques (Cb, Fb, E#, B#…) etaient
      refusees.

   L'IMPORT
   8. Le dedoublonnage passait AVANT l'elagage : il gardait la copie
      rekordbox (source la plus sure) meme quand son fichier avait
      ete deplace, puis l'elagage la jetait — et la copie vivante,
      rangee en alias, partait avec elle. Le morceau disparaissait.
   9. Traktor sur le disque de demarrage d'un Mac : /Volumes/
      Macintosh HD est un lien vers « / », il existe toujours, et
      tous les chemins sortaient avec ce prefixe — le deck lu par
      rekordbox ne retrouvait plus le morceau.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const plancher = require('../src/plancher.js');
const epoque = require('../src/epoque.js');
const autolib = require('../src/autolibrary.js');

let echecs = 0, cas = 0;
function verifier(quoi, condition, detail) {
  cas++;
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(66), detail ? '  — ' + detail : '');
}

let n = 0;
const m = (o, sansAnalyse) => {
  const t = lib.finalize([Object.assign({ path: '/p/' + (++n) + '.mp3', duration: 200 + n * 7, pop: 60, genre: 'House', key: '8A' }, o)])[0];
  if (!sansAnalyse) { t.analyzed = true; t.energy = 7; t.timbre = [5, 5, 5]; }
  return t;
};
const titres = r => r.map(c => c.track.title + (c.track.offline ? ' [HL]' : '') + (c.horsFenetre ? ' [HF]' : '')).join(' | ');

console.log('\n- cas limites -\n');

/* ---------- 1. les hors ligne ne remplissent pas la liste ---------- */
{
  const cur = m({ title: 'Now', artist: 'A', bpm: 128 });
  const L = [cur];
  for (let i = 0; i < 5; i++) L.push(Object.assign(m({ title: 'SSD ' + i, artist: 'S' + i, bpm: 128 }), { offline: true }));
  for (let i = 0; i < 10; i++) L.push(m({ title: 'Interne ' + i, artist: 'I' + i, bpm: 123 }));
  const r = engine.suggest(cur, L, { limit: 5 });
  verifier('SSD debranche : des morceaux chargeables en tete', r.length === 5 && !r[0].track.offline, titres(r));
  verifier('... marques HORS FENETRE, puisqu\'ils sont a 4 %', r.filter(c => !c.track.offline).every(c => c.horsFenetre));
}

/* ---------- 2. des chansons, pas des fichiers ---------- */
{
  const cur = m({ title: 'Now', artist: 'DJ A', bpm: 128 });
  const fen = [
    m({ title: 'Hit', artist: 'B', bpm: 128 }), m({ title: 'Hit (Extended Mix)', artist: 'B', bpm: 128 }),
    m({ title: 'Hit (Radio Edit)', artist: 'B', bpm: 128 }), m({ title: 'Hit [Clean]', artist: 'B', bpm: 128 }),
    m({ title: 'Autre', artist: 'C', bpm: 127 })
  ];
  const loin = [];
  for (let i = 0; i < 10; i++) loin.push(m({ title: 'Loin ' + i, artist: 'X' + i, bpm: 122.5 }));
  const r = engine.suggest(cur, [cur].concat(fen, loin), { limit: 5 });
  verifier('4 versions d\'un titre dans la fenetre : la liste reste pleine', r.length === 5, r.length + ' : ' + titres(r));
  const r2 = engine.suggest(cur, [cur, fen[0], fen[1], fen[2]].concat(loin), { limit: 3 });
  verifier('... idem a 3 propositions', r2.length === 3, r2.length + ' : ' + titres(r2));
}

/* ---------- 3. un tempo inconnu ne se cale pas ---------- */
{
  const promet = c => /se calent|Blend long|Bass swap|Cut sur le drop/.test(c.transition.n + ' ' + c.transition.d);
  const cur1 = m({ title: 'Sans tempo', artist: 'A', bpm: null, key: null });
  const L1 = [m({ title: 'X', artist: 'B', bpm: 140, key: null }), m({ title: 'Y', artist: 'C', bpm: 92, key: null })];
  const r1 = engine.suggest(cur1, L1, { limit: 5 }).concat(engine.rescue(cur1, L1, { limit: 3 }));
  verifier('morceau en cours sans tempo : aucun calage promis', r1.length > 0 && !r1.some(promet),
           r1.map(c => c.transition.n).join(' / '));
  const cur2 = m({ title: 'Sans tempo 8A', artist: 'A', bpm: null, key: '8A' });
  const r2 = engine.suggest(cur2, [m({ title: 'Z', artist: 'D', bpm: 150, key: '8A' })], { limit: 5 });
  verifier('... meme tonalite des deux cotes : pas de « Blend long »', r2.length > 0 && !r2.some(promet),
           r2.map(c => c.transition.n).join(' / '));
  const cur3 = m({ title: 'Cur 128', artist: 'A', bpm: 128, key: '8A' });
  const r3 = engine.suggest(cur3, [cur3, m({ title: 'Sans BPM', artist: 'F', bpm: null, key: '8A' })], { limit: 5 });
  verifier('candidat sans tempo : pas de « Blend long — 32 temps »', r3.length > 0 && !r3.some(promet),
           r3.map(c => c.transition.n).join(' / '));
}

/* ---------- 4. « Constructor » n'est pas une famille ---------- */
{
  const t = m({ title: 'T', artist: 'A', genre: 'Constructor', bpm: 124, year: 2015 });
  const p = plancher.plancher(t), f = epoque.fraicheur(t, 2026);
  verifier('genre « Constructor » : plancher et fraicheur sont des nombres',
           Number.isFinite(p.v) && Number.isFinite(f), JSON.stringify(p) + ' / ' + f);
  const cur = m({ title: 'Cur', artist: 'Z', genre: 'Constructor', bpm: 124 });
  const r = engine.suggest(cur, [cur, m({ title: 'Bon', artist: 'B', bpm: 124 }), m({ title: 'Autre', artist: 'C', bpm: 124, genre: 'hasOwnProperty' })], { limit: 5 });
  verifier('... et le moteur ne rend aucun NaN', r.every(c => Number.isFinite(c.total) && Number.isFinite(c.plancher) && Number.isFinite(c.fraicheur)),
           JSON.stringify(r.map(c => [c.total, c.plancher, c.fraicheur])));
}

/* ---------- 5. un titre interminable ---------- */
{
  let s = 7;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  let texte = '';
  while (texte.length < 20000) { let w = ''; const k = 3 + Math.floor(r() * 7); for (let i = 0; i < k; i++) w += String.fromCharCode(97 + Math.floor(r() * 26)); texte += w + ' '; }
  const L = lib.finalize([{ path: '/x/long.mp3', title: texte.slice(0, 20000), artist: 'Long', bpm: 124 },
                          { path: '/x/b.mp3', title: 'Normal', artist: 'Court', bpm: 124 }]);
  const t0 = process.hrtime.bigint();
  engine.prechauffer(L, 0, L.length);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  verifier('titre de 20 000 caracteres : bigrammes en moins de 40 ms', ms < 40, ms.toFixed(1) + ' ms');
}

/* ---------- 6. le meme objet deux fois ---------- */
{
  const cur = m({ title: 'Cur', artist: 'A', bpm: 124 });
  const sansNom = m({ title: '', artist: '', bpm: 124 });
  const L = [cur, sansNom, sansNom, m({ title: 'B', artist: 'B', bpm: 124 })];
  const r = engine.suggest(cur, L, { limit: 5 });
  const vus = r.filter(c => c.track === sansNom).length;
  verifier('le meme morceau deux fois dans la bibliotheque : une seule ligne', vus === 1, vus + ' fois');
  const s = engine.rescue(cur, L, { limit: 5 });
  verifier('... idem dans le sauvetage', s.filter(c => c.track === sansNom).length <= 1);
}

/* ---------- 7. les tonalites enharmoniques ---------- */
{
  const attendu = { 'Cb': '1B', 'Fb': '12B', 'E#': '7B', 'B#': '8B', 'E#m': '4A', 'Cbm': '10A', 'Fbm': '9A', 'B#m': '5A' };
  const faux = Object.entries(attendu).filter(([k, v]) => lib.toCamelot(k) !== v).map(([k, v]) => k + '→' + lib.toCamelot(k));
  verifier('Cb, Fb, E#, B# (majeur et mineur) sont lues', faux.length === 0, faux.join(', '));
}

/* ---------- 8. le dedoublonnage ne perd pas la copie vivante ---------- */
{
  const rb = { path: '/Users/dj/Music/Sets/Daft Punk - One More Time.mp3', title: 'One More Time', artist: 'Daft Punk',
               duration: 320, bpm: 122.7, bpmSrc: 'rekordbox', key: '8A', keySrc: 'rekordbox', rbId: 42 };
  const ssd = { path: '/Volumes/SSD DJ/Sets/Daft Punk - One More Time.mp3', title: 'One More Time', artist: 'Daft Punk',
                duration: 320.3, bpm: 123, bpmSrc: 'tag' };
  const ancien = rb.path;
  const d = lib.dedoublonner([rb, ssd]);
  const e = lib.elaguerDisparus(d.tracks, { existe: p => p.startsWith('/Volumes/SSD DJ/'), volumeVivant: () => true, plateforme: 'darwin' });
  const t = e.gardes[0];
  verifier('fichier rekordbox deplace, copie vivante ailleurs : le morceau reste', e.gardes.length === 1 && e.disparus.length === 0,
           e.gardes.length + ' garde(s), ' + e.disparus.length + ' disparu(s)');
  verifier('... il pointe la copie vivante', !!t && t.path === ssd.path, t && t.path);
  verifier('... et garde la grille de rekordbox', !!t && t.bpm === 122.7 && t.rbId === 42, t && (t.bpm + ' / ' + t.rbId));
  verifier('... l\'ancien chemin reste un alias (le deck peut encore l\'annoncer)', !!t && (t.alias || []).includes(ancien));
  /* volume ancien debranche, copie vivante sur le disque interne */
  const a = { path: '/Volumes/Vieux SSD/x.mp3', title: 'Titre', artist: 'Artiste', duration: 200, bpm: 120, bpmSrc: 'rekordbox' };
  const b = { path: '/Users/dj/Music/x.mp3', title: 'Titre', artist: 'Artiste', duration: 200.2, bpm: 120, bpmSrc: 'tag' };
  const d2 = lib.dedoublonner([a, b]);
  const e2 = lib.elaguerDisparus(d2.tracks, { existe: p => p.startsWith('/Users/'), volumeVivant: v => v !== '/Volumes/Vieux SSD', plateforme: 'darwin' });
  verifier('volume d\'origine debranche, copie interne : on charge la copie', e2.gardes.length === 1 && e2.gardes[0].path === b.path && !e2.gardes[0].offline,
           e2.gardes.map(x => x.path + (x.offline ? ' (hors ligne)' : '')).join(', '));
}

/* ---------- 9. Traktor sur le disque de demarrage d'un Mac ---------- */
{
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-traktor-'));
  const nml = path.join(dossier, 'collection.nml');
  const entree = (vol, nom) => '<ENTRY TITLE="' + nom + '" ARTIST="Quelqu\'un"><LOCATION DIR="/:Users/:dj/:Music/:Café Bleu/:" FILE="' + nom +
    '.mp3" VOLUME="' + vol + '" VOLUMEID="x"></LOCATION><TEMPO BPM="123.000000"></TEMPO><INFO GENRE="House" KEY="Am" PLAYTIME="320"></INFO></ENTRY>';
  fs.writeFileSync(nml, '<?xml version="1.0" encoding="UTF-8"?>\n<NML VERSION="19"><COLLECTION ENTRIES="2">' +
    entree('Macintosh HD', 'Été 96') + entree('SSD DJ', 'Nuit') + '</COLLECTION></NML>');
  /* Sur un vrai Mac, /Volumes/Macintosh HD est un lien vers « / » :
     tout ce qui existe sous / existe aussi sous ce prefixe. */
  const vrais = new Set(['/Users/dj/Music/Café Bleu/Été 96.mp3', '/Volumes/SSD DJ/Users/dj/Music/Café Bleu/Nuit.mp3']);
  const existe = p => vrais.has(p) || vrais.has(p.replace(/^\/Volumes\/Macintosh HD/, ''));
  const l = autolib.parseTraktor(nml, { plateforme: 'darwin', existe: existe, estRacine: v => v === '/Volumes/Macintosh HD' });
  const chemins = l.map(t => t.path);
  verifier('Traktor, disque de demarrage : le chemin est celui du deck', chemins.includes('/Users/dj/Music/Café Bleu/Été 96.mp3'),
           chemins.join(' | '));
  verifier('Traktor, volume externe : inchange', chemins.includes('/Volumes/SSD DJ/Users/dj/Music/Café Bleu/Nuit.mp3'));
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
}

/* ---------- 10. un titre d'un mot n'attrape pas tout ----------
   Avec « Adele - Hello » en bibliotheque, le deck qui annoncait
   « Lionel Richie - Hello » — absent — affichait Adele, avec son
   tempo et sa tonalite. Le titre seul, contenu dans le texte,
   valait une inclusion franche et passait au-dessus du garde-fou
   de l'artiste. */
{
  let k = 0;
  const b = (t, a) => lib.finalize([{ path: '/r/' + (++k) + '.mp3', title: t, artist: a, bpm: 120, duration: 200 + k }])[0];
  const L = [b('Hello', 'Adele'), b('Love', 'Lana Del Rey'), b('Home', 'Edward Sharpe'), b('Fire', 'Kasabian'),
             b('Intro', 'The xx'), b('Paradise', 'Coldplay'), b('Blinding Lights', 'The Weeknd'),
             b('Y.M.C.A.', 'Village People'), b('Alors on danse', 'Stromae')];
  for (let i = 0; i < 300; i++) L.push(b('Remplissage ' + i, 'Quelqu\'un ' + i));
  L.push(b('One More Time', 'Daft Punk'), b('Levitating', 'Dua Lipa'), b('ночь', 'Сплин'), b('Night', 'Sarah Cole'),
         b('Paradise', 'Golden Echo'), b('Paradise golden', 'Golden Echo'));
  const attendus = [
    /* des mots EN PLUS du titre font un autre titre… */
    ['Сплин - ночь песня дождь', null],
    ['Sarah Cole - Light Highway Sugar', null],
    ['Daft Punk - One More Night', null],
    /* … pas ce que les logiciels ajoutent autour */
    ['Daft Punk - One More Time (Alive 2007)', 'One More Time'],
    ['Dua Lipa - Levitating feat. DaBaby', 'Levitating'],
    ['Daft Punk - One More Time - Radio Edit', 'One More Time'],
    ['03_Daft_Punk-One_More_Time_(320kbps).mp3', 'One More Time'],
    /* deux lectures possibles : le texte exact gagne, pas l'ordre de la bibliotheque */
    ['Paradise - Golden Echo', 'Paradise'],
    ['Lionel Richie - Hello', null],
    ['Whitney Houston - I Will Always Love You', null],
    ['Arcade Fire - Wake Up', null],
    ['Michael Buble - Home', null],
    ['Daft Punk - Intro (Alive 2007)', null],
    ['Phil Collins - Another Day in Paradise', null],
    ['Kendrick Lamar - LOVE.', null],
    ['Adele - Hello', 'Hello'],
    ['Hello - Adele', 'Hello'],
    ['Blinding Lights - The Weeknd', 'Blinding Lights'],
    ['Compilation Disco 1978 - Y.M.C.A.', 'Y.M.C.A.'],
    ['Various Artists - Alors on danse', 'Alors on danse']
  ];
  for (const [q, voulu] of attendus) {
    const r = engine.match(q, L);
    verifier('deck « ' + q + ' »', (r ? r.track.title : null) === voulu,
             'rend ' + (r ? r.track.artist + ' - ' + r.track.title + ' (' + r.score.toFixed(2) + ')' : 'rien'));
  }
  /* La liste du client, collee sans tiret : meme regle. */
  const cl = require('../src/clientlist.js');
  const res = cl.resolve([{ artist: 'Lionel Richie', title: 'Hello' }, { artist: 'Adele', title: 'Hello' }], L, engine.match);
  verifier('liste du client : « Lionel Richie Hello » manque, « Adele Hello » est la',
           res.missing.length === 1 && res.missing[0].artist === 'Lionel Richie' && res.matched.length === 1,
           res.matched.map(x => x.entry.artist + '→' + x.track.artist).join(', '));
  /* Et l'invite qui tape juste le titre trouve toujours. */
  const s = engine.search('hello', L, 3);
  verifier('invite qui tape « hello » : Adele en premier', !!(s[0] && s[0].track.artist === 'Adele'));
}

console.log('\n' + (cas - echecs) + ' / ' + cas + ' controles.');
if (echecs) { console.error(echecs + ' controle(s) en echec.'); process.exit(1); }
console.log('cas limites : fermes.');
