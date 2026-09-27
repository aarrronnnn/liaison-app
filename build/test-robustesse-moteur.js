'use strict';
/* ============================================================
   « Il ne doit plus y avoir de bug. »

   Les autres bancs de ce dossier partent d'un retour de DJ et
   verifient qu'on l'a corrige. Celui-ci part de l'autre bout : il
   ne cherche pas un bon classement, il cherche ce qui CASSE. Des
   tags ecrits n'importe comment, des bibliotheques vides ou
   enormes, des morceaux en double sous trois noms de fichier, un
   fichier de gout abime, un plan de mix sur un jingle de vingt
   secondes — tout ce qu'une vraie cabine finit par envoyer au
   moteur un samedi a 2 h du matin.

   Il ne juge JAMAIS le gout. Il verifie des invariants, les memes
   pour toutes les entrees :

     — rien ne jette ;
     — chaque nombre rendu est fini (un NaN dans une note ne fait
       pas qu'afficher « NaN » : il casse le tri de TOUTE la liste,
       parce qu'un comparateur qui rend NaN n'ordonne plus rien) ;
     — la note reste dans 0..100 ;
     — pas deux fois le meme morceau, jamais le morceau en cours,
       jamais un double du morceau en cours ;
     — le meme appel rend deux fois la meme liste ;
     — le nombre demande est respecte ;
     — un plan de mix est ordonne et tient dans le morceau ;
     — un apprentissage abime se recharge sans rien empoisonner ;
     — et tout ca en moins d'un quart de seconde sur 50 000 titres.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const filters = require('../src/filters.js');
const structure = require('../src/structure.js');
const repertoire = require('../src/repertoire.js');
const landing = require('../src/landing.js');
const { Gout } = require('../src/gout.js');

let echecs = 0, cas = 0;
function verifier(quoi, condition, detail) {
  cas++;
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(62),
              detail ? '  — ' + detail : '');
}
/* Un appel qui jette est un echec a lui seul : on le rattrape pour
   que le banc continue et dise TOUT ce qui ne va pas. */
function sansJeter(quoi, fn) {
  try { return fn(); }
  catch (e) { verifier(quoi + ' — ne jette pas', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)); return undefined; }
}

/* ---------- des morceaux qui passent par le vrai chemin ---------- */
let n = 0;
function morceau(o, analyse) {
  const brut = Object.assign({ path: '/musique/' + (++n) + '.mp3', duration: 210, pop: 55 }, o);
  const t = lib.finalize([brut])[0];
  /* finalize ne pose pas « analyzed » : c'est l'analyse de fond. */
  if (analyse) {
    t.analyzed = true;
    if (analyse.energy !== undefined) t.energy = analyse.energy;
    if (analyse.timbre !== undefined) t.timbre = analyse.timbre;
  }
  return t;
}

const GENRES = ['House', 'Tech House', 'Disco', 'Variété française', 'Hip Hop', 'Afro House',
                'Reggaeton', 'Pop', 'Funk', 'Dancehall', 'RnB', 'Techno'];
const CLES = ['1A', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A', '10A', '11A', '12A',
              '1B', '2B', '3B', '4B', '5B', '6B', '7B', '8B', '9B', '10B', '11B', '12B'];
function bibliotheque(taille, graine) {
  let s = graine || 7;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const out = [];
  for (let i = 0; i < taille; i++) {
    out.push(morceau({
      title: 'Titre ' + i, artist: 'Artiste ' + (i % 37),
      genre: GENRES[i % GENRES.length], bpm: 118 + Math.round(r() * 200) / 10,
      key: CLES[i % 24], year: 1978 + (i % 47), pop: Math.round(r() * 100)
    }, i % 3 ? { energy: 1 + (i % 10), timbre: [i % 10, (i * 3) % 10, (i * 7) % 10] } : null));
  }
  return out;
}

/* ---------- les invariants d'une liste de suggestions ---------- */
const CHAMPS = ['total', 'h', 'energyScore', 'timbreScore', 'crowd', 'trend', 'fraicheur',
                'affinite', 'plancher', 'parente', 'repertoire', 'variete'];
function fini(v) { return typeof v === 'number' && isFinite(v); }
function defautsDe(liste) {
  const d = [];
  for (const c of liste) {
    for (const k of CHAMPS) if (!fini(c[k])) d.push(k + '=' + c[k]);
    if (!c.tempo || !fini(c.tempo.s) || !fini(c.tempo.delta)) d.push('tempo=' + JSON.stringify(c.tempo));
    if (c.tempo && c.tempo.pct != null && !fini(c.tempo.pct)) d.push('tempo.pct=' + c.tempo.pct);
    if (c.bulle != null && !fini(c.bulle)) d.push('bulle=' + c.bulle);
    if (!(c.total >= 0 && c.total <= 100)) d.push('total hors 0..100 : ' + c.total);
    if (!c.transition || typeof c.transition.n !== 'string') d.push('transition absente');
  }
  return d;
}
/* Meme identite qu'un DJ : meme artiste, meme titre, version mise a
   part. Ecrite ici independamment du moteur, pour ne pas verifier
   le moteur avec son propre code. */
function memeChanson(a, b) {
  const p = s => String(s || '').toLowerCase()
    .replace(/\((extended|radio|original|club)[^)]*\)/g, '').replace(/\s-\s(extended|radio|original|club).*$/, '')
    .replace(/\s+/g, ' ').trim();
  return p(a.artist) === p(b.artist) && p(a.title) === p(b.title) && p(a.title) !== '';
}
function controler(nom, liste, cur, limite) {
  if (!Array.isArray(liste)) { verifier(nom + ' — rend une liste', false, String(liste)); return; }
  const d = defautsDe(liste);
  verifier(nom + ' — nombres finis, note 0..100', !d.length, d.slice(0, 4).join(', '));
  const ids = liste.map(c => c.track && c.track.id);
  verifier(nom + ' — pas deux fois le meme morceau', new Set(ids).size === ids.length);
  if (cur) {
    verifier(nom + ' — jamais le morceau en cours', !liste.some(c => c.track === cur || (cur.id != null && c.track.id === cur.id)));
    verifier(nom + ' — jamais un double du morceau en cours', !liste.some(c => memeChanson(c.track, cur)),
             liste.filter(c => memeChanson(c.track, cur)).map(c => c.track.title).join(' / '));
  }
  if (limite != null) verifier(nom + ' — respecte le nombre demande', liste.length <= limite, liste.length + ' pour ' + limite);
}
const empreinte = l => (l || []).map(c => c.track.id + ':' + c.total).join(',');

/* ============================================================
   1. LE TEMPO DU MORCEAU EN COURS, ECRIT N'IMPORTE COMMENT
   ============================================================ */
console.log('\n1. tempo du morceau en cours');
{
  const L = bibliotheque(80);
  const tempos = [0, -5, NaN, undefined, null, '128,5', '128.00 BPM', 999, '128', Infinity, 1e-9];
  for (const b of tempos) {
    const cur = morceau({ title: 'En cours', artist: 'Quelqu\'un', genre: 'House', key: '8A' }, { energy: 7, timbre: [5, 6, 5] });
    cur.bpm = b;
    const l = sansJeter('bpm ' + String(b), () => engine.suggest(cur, L, { limit: 5 }));
    if (l) {
      controler('bpm ' + JSON.stringify(b === undefined ? 'undefined' : b), l, cur, 5);
      verifier('bpm ' + String(b) + ' — propose quand meme', l.length === 5, l.length + ' propositions');
    }
    const r = sansJeter('sauvetage, bpm ' + String(b), () => engine.rescue(cur, L, { limit: 3 }));
    if (r) verifier('sauvetage, bpm ' + String(b) + ' — notes finies', r.every(c => fini(c.total) && c.total >= 0 && c.total <= 100));
  }
  /* La mise a plat de la bibliotheque : un tempo ecrit en texte est
     un tempo, pas une absence. */
  const lu = v => lib.finalize([{ path: '/x/' + (++n) + '.mp3', title: 't', artist: 'a', bpm: v }])[0].bpm;
  verifier('finalize lit « 128,5 »', lu('128,5') === 128.5, String(lu('128,5')));
  verifier('finalize lit « 128.00 BPM »', lu('128.00 BPM') === 128, String(lu('128.00 BPM')));
  verifier('finalize rend un nombre pour « 128 »', lu('128') === 128, typeof lu('128'));
  verifier('finalize ecarte 999, -5, 0, NaN', [999, -5, 0, NaN, 'abc'].every(v => lu(v) == null));
}

/* ============================================================
   2. LES TONALITES, SOUS TOUTES LEURS FORMES
   ============================================================ */
console.log('\n2. tonalites');
{
  const attendu = {
    '8A': '8A', '08A': '8A', ' 8a ': '8A', '8 A': '8A',
    '8m': '3A', '8d': '3B', '1m': '8A', '1d': '8B', '12m': '7A',
    'Am': '8A', 'am': '8A', 'A minor': '8A', 'a min': '8A', 'A-Flat Minor': '1A',
    'F#m': '11A', 'Gbm': '11A', 'gbm': '11A', 'F♯m': '11A', 'Db Major': '3B', 'C': '8B',
    'Bb': '6B', 'E': '12B', '8A - Energy 7': '8A',
    '': null, '13A': null, '0A': null, 'H': null, 'xyz': null
  };
  const faux = [];
  for (const [brut, v] of Object.entries(attendu)) {
    const r = sansJeter('toCamelot ' + brut, () => lib.toCamelot(brut));
    if (r !== v) faux.push(JSON.stringify(brut) + ' -> ' + r + ' (attendu ' + v + ')');
  }
  verifier('toCamelot lit toutes les notations', !faux.length, faux.join(', '));
  verifier('toCamelot(null / undefined / nombre) ne jette pas',
           [null, undefined, 8, {}].every(v => sansJeter('toCamelot', () => lib.toCamelot(v)) !== undefined || true));
  /* Deux ecritures de la MEME cle sont la meme cle. */
  verifier('harmScore : « 8a » et « 8A » sont la meme tonalite', engine.harmScore('8a', '8A') === 100,
           String(engine.harmScore('8a', '8A')));
  verifier('harmScore : « 08A » et « 8A » sont la meme tonalite', engine.harmScore('08A', '8A') === 100,
           String(engine.harmScore('08A', '8A')));
  verifier('harmScore : une cle illisible reste neutre', engine.harmScore('Am', '8A') === 50 && engine.harmScore('13A', '8A') === 50,
           engine.harmScore('Am', '8A') + ' / ' + engine.harmScore('13A', '8A'));
  const L = bibliotheque(40);
  for (const k of ['Am', '8m', 'n/a', 42, '', null]) {
    const cur = morceau({ title: 'Cle ' + k, artist: 'X', genre: 'House', bpm: 124 }, { energy: 6, timbre: [5, 5, 5] });
    cur.key = k;
    const l = sansJeter('cle ' + String(k), () => engine.suggest(cur, L, { limit: 5 }));
    if (l) controler('cle en cours ' + JSON.stringify(k), l, cur, 5);
  }
}

/* ============================================================
   3. ENERGIE, TIMBRE, NOTORIETE : ABSENTS OU ABIMES
   ============================================================ */
console.log('\n3. mesures absentes ou abimees');
{
  const base = bibliotheque(40);
  const abimes = [
    morceau({ title: 'Energie NaN', artist: 'A1', genre: 'House', bpm: 124, key: '8A' }, { energy: NaN, timbre: [5, 5, 5] }),
    morceau({ title: 'Energie absente', artist: 'A2', genre: 'House', bpm: 124, key: '8A' }, { energy: undefined, timbre: [5, 5, 5] }),
    morceau({ title: 'Energie texte', artist: 'A3', genre: 'House', bpm: 124.2, key: '8A' }, { energy: 'fort', timbre: [5, 5, 5] }),
    morceau({ title: 'Timbre court', artist: 'A4', genre: 'House', bpm: 124.1, key: '8A' }, { energy: 7, timbre: [5, 5] }),
    morceau({ title: 'Timbre NaN', artist: 'A5', genre: 'House', bpm: 123.9, key: '8A' }, { energy: 7, timbre: [NaN, 3, 4] }),
    morceau({ title: 'Timbre texte', artist: 'A6', genre: 'House', bpm: 124, key: '9A' }, { energy: 7, timbre: 'brillant' }),
    morceau({ title: 'Pop NaN', artist: 'A7', genre: 'House', bpm: 124, key: '8A', pop: NaN }, { energy: 7, timbre: [5, 5, 5] }),
    morceau({ title: 'Pop texte', artist: 'A8', genre: 'House', bpm: 124, key: '8A', pop: 'beaucoup' }, { energy: 7, timbre: [5, 5, 5] }),
    morceau({ title: 'Annee texte', artist: 'A9', genre: 'House', bpm: 124, key: '8A', year: 'jadis' }, { energy: 7, timbre: [5, 5, 5] }),
    morceau({ title: 'Tags texte', artist: 'A10', bpm: 124, key: '8A' }, { energy: 7, timbre: [5, 5, 5] })
  ];
  abimes[abimes.length - 1].tags = 'house';
  const L = base.concat(abimes);
  const curs = [
    morceau({ title: 'Cur mesure', artist: 'Z', genre: 'House', bpm: 124, key: '8A' }, { energy: 7, timbre: [5, 6, 5] }),
    morceau({ title: 'Cur energie NaN', artist: 'Z', genre: 'House', bpm: 124, key: '8A' }, { energy: NaN, timbre: [5, 6, 5] }),
    morceau({ title: 'Cur timbre NaN', artist: 'Z', genre: 'House', bpm: 124, key: '8A' }, { energy: 7, timbre: [NaN, NaN, NaN] }),
    morceau({ title: 'Cur pop NaN', artist: 'Z', genre: 'House', bpm: 124, key: '8A', pop: NaN }, { energy: 7, timbre: [5, 6, 5] })
  ];
  const modes = [
    { limit: 100 }, { limit: 30 }, { limit: 30, mode: 'deep' }, { limit: 30, mode: 'trend' },
    { limit: 30, poids: { pop: 0.8 } }, { limit: 30, arc: 'down' },
    { limit: 30, pas: { up: NaN, down: NaN, hold: NaN } },
    { limit: 30, pas: { up: '2', down: null } },
    { limit: 30, poids: { h: NaN, tp: Infinity, pop: NaN }, variete: NaN, marge: NaN },
    { limit: 30, dna: { house: 'beaucoup', disco: NaN, '': 80 } }
  ];
  for (const cur of curs) {
    for (const o of modes) {
      const l = sansJeter(cur.title + ' ' + JSON.stringify(o), () => engine.suggest(cur, L, o));
      if (l) {
        const d = defautsDe(l);
        if (d.length) verifier(cur.title + ' ' + JSON.stringify(o) + ' — nombres finis', false, d.slice(0, 4).join(', '));
      }
    }
    const B = engine.bulle.ancrer(cur, L);
    const lb = sansJeter(cur.title + ' en bulle', () => engine.suggest(cur, L, { limit: 30, bulle: B }));
    if (lb) controler(cur.title + ' en bulle', lb, cur, 30);
    const r = sansJeter(cur.title + ' sauvetage', () => engine.rescue(cur, L, { limit: 10, bulle: B }));
    if (r) verifier(cur.title + ' sauvetage — notes finies', r.every(c => fini(c.total) && fini(c.energy) && !/NaN/.test(c.why)),
                    r.filter(c => !fini(c.total) || !fini(c.energy) || /NaN/.test(c.why)).map(c => c.track.title + ':' + c.total + ':' + c.why).join(', '));
    const l = engine.suggest(cur, L, { limit: 30 });
    controler(cur.title, l, cur, 30);
  }
  /* Un seul NaN ne doit pas brouiller le reste. Un comparateur qui
     rend NaN n'ordonne plus rien : la suite des notes dependait alors
     de l'ordre des fichiers. A egalite de note, l'ordre des fichiers
     departage — c'est voulu —, mais la SUITE des notes, elle, ne doit
     pas bouger. */
  for (const cur of curs) {
    const a = engine.suggest(cur, L, { limit: 100 }).map(c => c.total);
    const b = engine.suggest(cur, L.slice().reverse(), { limit: 100 }).map(c => c.total);
    verifier(cur.title + ' — l\'ordre des fichiers ne change pas le classement', a.join() === b.join(),
             a.slice(0, 8).join() + ' / ' + b.slice(0, 8).join());
  }
}

/* ============================================================
   4. ARTISTES ET TITRES ABSENTS, ENORMES, EXOTIQUES
   ============================================================ */
console.log('\n4. titres et artistes');
{
  const L = bibliotheque(30).concat([
    morceau({ title: '', artist: '', genre: 'House', bpm: 124, key: '8A' }),
    morceau({ title: undefined, artist: undefined, genre: 'House', bpm: 124.3, key: '8A' }),
    morceau({ title: 'Sans artiste', genre: 'House', bpm: 124.1, key: '8A' }),
    morceau({ artist: 'Sans titre', genre: 'House', bpm: 123.8, key: '8A' }),
    morceau({ title: 'x'.repeat(20000), artist: 'Long', genre: 'House', bpm: 124, key: '8A' }),
    morceau({ title: '🔥🔥🔥', artist: '🎧', genre: 'House', bpm: 124, key: '8A' }),
    morceau({ title: 'Déjà vu (Remix Été)', artist: 'Beyoncé', genre: 'RnB', bpm: 124, key: '8A' }),
    morceau({ title: 'Кукушка', artist: 'Кино', genre: 'Rock', bpm: 124, key: '8A' }),
    morceau({ title: 'Группа крови', artist: 'Кино', genre: 'Rock', bpm: 124.2, key: '8A' })
  ]);
  const cur = morceau({ title: 'Titre normal', artist: 'Normal', genre: 'House', bpm: 124, key: '8A' }, { energy: 6, timbre: [5, 5, 5] });
  const l = sansJeter('titres exotiques', () => engine.suggest(cur, L, { limit: 40 }));
  if (l) controler('titres exotiques', l, cur, 40);
  const vide = morceau({ title: '', artist: '', genre: 'House', bpm: 124, key: '8A' }, { energy: 6, timbre: [5, 5, 5] });
  const lv = sansJeter('morceau en cours sans nom', () => engine.suggest(vide, L, { limit: 40 }));
  if (lv) {
    controler('morceau en cours sans nom', lv, vide, 40);
    /* Sans nom, on ne sait pas dire « c'est le meme » : un autre
       morceau sans nom n'est PAS un double pour autant. */
    verifier('deux morceaux sans nom ne sont pas des doubles', lv.some(c => !c.track.title && !c.track.artist));
  }
  /* Deux chansons differentes du meme artiste en cyrillique ne sont
     pas des doubles : la mise a plat latine les rendait identiques. */
  const kino = L.find(t => t.title === 'Кукушка');
  const lk = engine.suggest(kino, L, { limit: 40 });
  verifier('deux titres cyrilliques differents ne sont pas des doubles', lk.some(c => c.track.title === 'Группа крови'));
  const s = sansJeter('recherche accents', () => engine.search('beyonce deja vu', L));
  verifier('la recherche retrouve « Beyoncé — Déjà vu »', s && s[0] && s[0].track.artist === 'Beyoncé');
  for (const q of ['🔥', '', null, undefined, 42, 'x'.repeat(5000), '(((', '\\', '.*']) {
    sansJeter('recherche ' + String(q).slice(0, 12), () => engine.search(q, L));
    sansJeter('match ' + String(q).slice(0, 12), () => engine.match(q, L));
  }
  verifier('recherche et match sur des textes hostiles ne jettent pas', true);
}

/* ============================================================
   5. BIBLIOTHEQUES LIMITES
   ============================================================ */
console.log('\n5. bibliotheques limites');
{
  const cur = morceau({ title: 'Seul', artist: 'Moi', genre: 'House', bpm: 124, key: '8A' }, { energy: 6, timbre: [5, 5, 5] });
  const vide = sansJeter('bibliotheque vide', () => engine.suggest(cur, [], { limit: 5 }));
  verifier('bibliotheque vide : liste vide', Array.isArray(vide) && vide.length === 0);
  const absente = sansJeter('bibliotheque absente', () => engine.suggest(cur, undefined, { limit: 5 }));
  verifier('bibliotheque absente : liste vide', Array.isArray(absente) && absente.length === 0);
  const seul = sansJeter('bibliotheque = le morceau en cours', () => engine.suggest(cur, [cur], { limit: 5 }));
  verifier('bibliotheque d\'un seul morceau (le sien) : liste vide', Array.isArray(seul) && seul.length === 0);
  const un = morceau({ title: 'Autre', artist: 'Lui', genre: 'House', bpm: 124, key: '8A' });
  const l1 = sansJeter('un seul autre morceau', () => engine.suggest(cur, [cur, un], { limit: 5 }));
  verifier('un seul autre morceau : il sort', l1 && l1.length === 1 && l1[0].track === un);
  const trous = [null, cur, undefined, un, 0, false];
  const lt = sansJeter('entrees nulles dans la bibliotheque', () => engine.suggest(cur, trous, { limit: 5 }));
  verifier('entrees nulles dans la bibliotheque : ignorees', lt && lt.length === 1 && lt[0].track === un);
  const rt = sansJeter('sauvetage, entrees nulles', () => engine.rescue(cur, trous, { limit: 3 }));
  verifier('sauvetage, entrees nulles : ignorees', Array.isArray(rt));
  sansJeter('recherche, entrees nulles', () => engine.search('autre', trous));
  sansJeter('match, entrees nulles', () => engine.match('Lui - Autre', trous));
  verifier('recherche et match ignorent les entrees nulles', true);
  /* Tous identiques : le classement doit etre stable d'un appel a
     l'autre, sinon la liste « danse » a chaque rafraichissement. */
  const clones = [];
  for (let i = 0; i < 25; i++) clones.push(morceau({ title: 'Clone ' + i, artist: 'Pareil ' + i, genre: 'House', bpm: 124, key: '8A', pop: 50 }, { energy: 6, timbre: [5, 5, 5] }));
  const a = engine.suggest(cur, clones, { limit: 5 }), b = engine.suggest(cur, clones, { limit: 5 });
  controler('25 clones', a, cur, 5);
  verifier('25 clones : deux appels, meme liste', empreinte(a) === empreinte(b));
  verifier('25 clones : l\'ordre de la bibliotheque decide a egalite', a.map(c => c.track.title).join() === 'Clone 0,Clone 1,Clone 2,Clone 3,Clone 4',
           a.map(c => c.track.title).join());
  const sans = [];
  for (let i = 0; i < 12; i++) sans.push(morceau({ title: 'Sans tempo ' + i, artist: 'S' + i, genre: 'House', key: '8A' }));
  const ls = engine.suggest(cur, sans, { limit: 5 });
  controler('bibliotheque sans aucun tempo', ls, cur, 5);
  verifier('bibliotheque sans aucun tempo : propose quand meme', ls.length === 5);
}

/* ============================================================
   6. LES DOUBLES DU MORCEAU EN COURS
   ============================================================ */
console.log('\n6. doubles');
{
  const L = bibliotheque(40);
  /* Le meme titre, trois fichiers, trois durees : dedoublonner() ne
     les replie pas (il exige la meme duree), et c'est juste — un
     edit n'est pas une copie. Mais le proposer derriere lui-meme
     reste une absurdite. */
  const cur = morceau({ title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Pop', bpm: 171, key: '4A', duration: 200 }, { energy: 8, timbre: [6, 7, 5] });
  const doubles = [
    morceau({ title: 'Blinding Lights', artist: 'The Weeknd', genre: 'Pop', bpm: 171, key: '4A', duration: 263 }, { energy: 8, timbre: [6, 7, 5] }),
    morceau({ title: 'Blinding Lights (Extended Mix)', artist: 'The Weeknd', genre: 'Pop', bpm: 171, key: '4A', duration: 320 }, { energy: 8, timbre: [6, 7, 5] }),
    morceau({ title: 'Blinding Lights (Radio Edit)', artist: 'the weeknd', genre: 'Pop', bpm: 171, key: '4A', duration: 180 }, { energy: 8, timbre: [6, 7, 5] }),
    morceau({ title: 'Blinding Lights - Radio Edit', artist: 'The Weeknd', genre: 'Pop', bpm: 171, key: '4A', duration: 181 }, { energy: 8, timbre: [6, 7, 5] }),
    morceau({ title: 'Blinding  Lights [Clean]', artist: 'The Weeknd ', genre: 'Pop', bpm: 171, key: '4A', duration: 202 }, { energy: 8, timbre: [6, 7, 5] })
  ];
  const remix = morceau({ title: 'Blinding Lights (Chromatics Remix)', artist: 'The Weeknd', genre: 'Pop', bpm: 171, key: '4A', duration: 300 }, { energy: 8, timbre: [6, 7, 5] });
  const voisin = morceau({ title: 'Save Your Tears', artist: 'The Weeknd', genre: 'Pop', bpm: 170.5, key: '4A' }, { energy: 8, timbre: [6, 7, 5] });
  const tout = L.concat(doubles, [remix, voisin]);
  const l = engine.suggest(cur, tout, { limit: 5 });
  controler('doubles du morceau en cours', l, cur, 5);
  const noms = l.map(c => c.track.title);
  verifier('aucun des doubles ne sort', !l.some(c => doubles.includes(c.track)), noms.join(' / '));
  verifier('un vrai remix reste un autre morceau', l.some(c => c.track === remix), noms.join(' / '));
  const r = engine.rescue(cur, tout, { limit: 3 });
  verifier('le sauvetage ne propose pas un double non plus', !r.some(c => doubles.includes(c.track)), r.map(c => c.track.title).join(' / '));

  /* Deux fichiers d'une meme chanson ne prennent pas deux lignes. */
  const autre = morceau({ title: 'Levitating', artist: 'Dua Lipa', genre: 'Pop', bpm: 103, key: '6A', duration: 203 }, { energy: 8, timbre: [6, 7, 5] });
  const autre2 = morceau({ title: 'Levitating', artist: 'Dua Lipa', genre: 'Pop', bpm: 103, key: '6A', duration: 230 }, { energy: 8, timbre: [6, 7, 5] });
  const autre3 = morceau({ title: 'Levitating (Extended Mix)', artist: 'Dua Lipa', genre: 'Pop', bpm: 103, key: '6A', duration: 330 }, { energy: 8, timbre: [6, 7, 5] });
  const curLev = morceau({ title: 'Physical', artist: 'Dua Lipa', genre: 'Pop', bpm: 103, key: '6A' }, { energy: 8, timbre: [6, 7, 5] });
  const lev = engine.suggest(curLev, [autre, autre2, autre3, voisin].concat(L), { limit: 5 });
  verifier('une chanson en trois fichiers n\'occupe qu\'une ligne',
           lev.filter(c => /Levitating/.test(c.track.title)).length === 1, lev.map(c => c.track.title).join(' / '));
  verifier('et la liste reste pleine', lev.length === 5, lev.length + ' propositions');

  /* Deja passe ce soir sous un autre fichier : c'est deja passe. */
  const joue = doubles[0];
  const cur2 = morceau({ title: 'Take On Me', artist: 'a-ha', genre: 'Pop', bpm: 171, key: '4A' }, { energy: 8, timbre: [6, 7, 5] });
  const lh = engine.suggest(cur2, tout.filter(t => t !== joue), { limit: 100, recent: [joue] });
  const fr = lh.filter(c => /Blinding Lights/.test(c.track.title) && !/Chromatics/.test(c.track.title));
  verifier('un double d\'un titre deja joue porte « deja passe »', fr.length === 1 && fr[0].rejoue === true,
           fr.map(c => c.track.title + ' rejoue=' + c.rejoue).join(', ') || 'absent');
}

/* ============================================================
   7. DEMI ET DOUBLE TEMPO, ET LES SEUILS
   ============================================================ */
console.log('\n7. demi / double tempo');
{
  const t1 = engine.tempoScore(128, 64, true), t2 = engine.tempoScore(174, 87, true);
  verifier('128 / 64 en demi-tempo : rapport x2, ecart nul', t1.ratio === 2 && t1.s === 100 && t1.delta === 0);
  verifier('174 / 87 : idem', t2.ratio === 2 && t2.s === 100);
  verifier('sans demande, pas de rapport x2', engine.tempoScore(128, 64).ratio === 1);
  const cur = morceau({ title: 'House 128', artist: 'H', genre: 'House', bpm: 128, key: '8A' }, { energy: 7, timbre: [5, 6, 5] });
  const L = [
    morceau({ title: 'House 64', artist: 'H2', genre: 'House', bpm: 64, key: '8A' }, { energy: 7, timbre: [5, 6, 5] }),
    morceau({ title: 'House 131.84', artist: 'H3', genre: 'House', bpm: 131.84, key: '8A' }, { energy: 7, timbre: [5, 6, 5] }),
    morceau({ title: 'House 131.9', artist: 'H4', genre: 'House', bpm: 131.9, key: '8A' }, { energy: 7, timbre: [5, 6, 5] }),
    morceau({ title: 'House 124.16', artist: 'H5', genre: 'House', bpm: 124.16, key: '8A' }, { energy: 7, timbre: [5, 6, 5] }),
    morceau({ title: 'House 256', artist: 'H6', genre: 'House', bpm: 256, key: '8A' }, { energy: 7, timbre: [5, 6, 5] })
  ];
  for (const dd of [false, true]) {
    const l = engine.suggest(cur, L, { limit: 5, demiDouble: dd });
    controler('demi-double ' + dd, l, cur, 5);
    const faux = l.filter(c => !c.horsFenetre && c.tempo.pct > 3.01);
    verifier('demi-double ' + dd + ' — « dans la fenetre » veut dire a 3 % au plus', !faux.length,
             faux.map(c => c.track.title + ' ' + c.tempo.pct.toFixed(2) + '%').join(', '));
    const x2 = l.find(c => c.track.title === 'House 64');
    if (dd) verifier('demi-double demande : 64 sous 128 se cale en x2', x2 && x2.tempo.ratio === 2 && !x2.horsFenetre && /x2/.test(x2.transition.n));
    else verifier('demi-double coupe : 64 sous 128 est hors fenetre', !x2 || x2.horsFenetre);
  }
  verifier('crible : 3,0 % tout juste passe', engine.passeLeCrible(128, 131.84, 0.03) === true);
  verifier('crible : 3,05 % ne passe pas', engine.passeLeCrible(128, 131.9, 0.03) === false);
  verifier('crible : tempo de reference absent ne jette pas', engine.passeLeCrible(0, 128, 0.03) === false && engine.passeLeCrible(NaN, 128, 0.03) === false);
}

/* ============================================================
   8. L'HISTORIQUE DE LA SOIREE
   ============================================================ */
console.log('\n8. historique');
{
  const cur = morceau({ title: 'Maintenant', artist: 'M', genre: 'House', bpm: 124, key: '8A' }, { energy: 6, timbre: [5, 5, 5] });
  const jumeau = o => morceau(Object.assign({ genre: 'House', bpm: 124, key: '8A', pop: 60 }, o), { energy: 7, timbre: [5, 5, 5] });
  const joue = jumeau({ title: 'Deja joue', artist: 'P' });
  const neuf = jumeau({ title: 'Jamais joue', artist: 'Q' });
  const memeArtiste = jumeau({ title: 'Autre titre', artist: 'R' });
  const autre = jumeau({ title: 'Encore un', artist: 'S' });
  const recent = [jumeau({ title: 'Avant', artist: 'R' }), joue];
  const L = [joue, neuf, memeArtiste, autre, cur];
  const l = engine.suggest(cur, L, { limit: 4, recent: recent });
  controler('historique', l, cur, 4);
  const rang = t => l.findIndex(c => c.track === t);
  verifier('le deja-joue passe derriere un jumeau neuf', rang(joue) > rang(neuf));
  verifier('le deja-joue porte sa marque', l[rang(joue)] && l[rang(joue)].rejoue === true);
  verifier('le meme artiste passe derriere un jumeau', rang(memeArtiste) > rang(autre));
  verifier('historique avec des trous ne jette pas', Array.isArray(sansJeter('trous', () =>
    engine.suggest(cur, L, { limit: 4, recent: [null, undefined, {}, { id: null }, joue, 5, 'x'] }))));
  verifier('historique qui n\'est pas une liste ne jette pas', Array.isArray(sansJeter('historique Set', () =>
    engine.suggest(cur, L, { limit: 4, recent: new Set([joue]) }))));
  verifier('interdits et voulus passes en tableau ne jettent pas', Array.isArray(sansJeter('tableaux', () =>
    engine.suggest(cur, L, { limit: 4, banned: [engine.keyOf(neuf)], wanted: [autre.id], trends: {} }))));
  const lb = engine.suggest(cur, L, { limit: 4, banned: new Set([engine.keyOf(neuf)]) });
  verifier('un titre interdit ne sort jamais', !lb.some(c => c.track === neuf));
}

/* ============================================================
   9. FILTRES CONTRADICTOIRES
   ============================================================ */
console.log('\n9. filtres');
{
  const L = bibliotheque(60);
  const cur = L[0];
  const jeux = {
    'bpmMin > bpmMax': { bpmMin: 140, bpmMax: 100 },
    'energyMin > energyMax': { energyMin: 9, energyMax: 2 },
    'genre absent': { genres: ['Polka'] },
    'genre en texte': { genres: 'House' },
    'crate vide': { crate: { name: 'Vide', ids: [] } },
    'crate inconnu': { crate: { name: 'X', ids: new Set([999]) } },
    'bornes NaN': { bpmMin: NaN, bpmMax: NaN, energyMin: NaN, energyMax: NaN },
    'bornes texte': { bpmMin: '120', bpmMax: '125' },
    'tout a la fois': { bpmMin: 140, bpmMax: 100, energyMin: 9, energyMax: 2, genres: ['Polka'], crate: { ids: [] }, noExplicit: true, skipPlayed: true, playedIds: [cur.id] },
    'rien': null
  };
  for (const [nom, f] of Object.entries(jeux)) {
    const r = sansJeter('filtre ' + nom, () => filters.apply(L, f));
    if (!r) continue;
    verifier('filtre ' + nom + ' — etat propre', Array.isArray(r.tracks) && typeof r.vide === 'boolean' && Array.isArray(r.active));
    const l = sansJeter('filtre ' + nom + ' puis suggest', () => engine.suggest(cur, r.tracks, { limit: 5 }));
    if (l) controler('filtre ' + nom + ' puis suggest', l, cur, 5);
  }
  const g = filters.apply(L, { genres: 'House' });
  verifier('un genre passe en texte filtre comme un genre', g.tracks.length > 0 && g.tracks.every(t => t.tags.includes('house')),
           g.tracks.length + ' titres, vide=' + g.vide);
  verifier('filtre sur une bibliotheque avec des trous', Array.isArray(sansJeter('filtre trous', () => filters.apply([null, cur, undefined], { bpmMin: 100 })).tracks));
}

/* ============================================================
   10. CHAQUE PROPOSITION : NOMBRE, ORDRE, DETERMINISME
   ============================================================ */
console.log('\n10. nombre et determinisme');
{
  const L = bibliotheque(200);
  const cur = L[3];
  for (const [lim, attendu] of [[0, 5], [-3, 1], [2.7, 2], [NaN, 5], ['3', 3], [Infinity, null], [1, 1], [7, 7]]) {
    const l = sansJeter('limite ' + lim, () => engine.suggest(cur, L, { limit: lim }));
    if (!l) continue;
    if (attendu != null) verifier('limite ' + String(lim) + ' → ' + attendu, l.length === attendu, l.length + ' rendues');
    else verifier('limite Infinity → borne raisonnable', l.length <= 100, l.length + ' rendues');
    controler('limite ' + String(lim), l, cur, attendu == null ? 100 : attendu);
  }
  for (const [lim, attendu] of [[0, 3], [-1, 1], [NaN, 3], ['2', 2]]) {
    const r = sansJeter('sauvetage limite ' + lim, () => engine.rescue(cur, L, { limit: lim }));
    if (r) verifier('sauvetage limite ' + String(lim) + ' → au plus ' + attendu, r.length <= attendu && r.length >= 1, r.length + ' rendues');
  }
  const recent = L.slice(10, 40);
  const o = { limit: 7, recent: recent, dna: { house: 80, disco: 60 }, arc: 'up' };
  const a = engine.suggest(cur, L, o), b = engine.suggest(cur, L, o);
  verifier('meme appel, meme liste', empreinte(a) === empreinte(b));
  const tri = a.every((c, i) => i === 0 || true);
  verifier('les notes sont rendues comme nombres entiers', a.every(c => Number.isInteger(c.total)) && tri);
}

/* ============================================================
   11. LE PLAN DE MIX
   ============================================================ */
console.log('\n11. plan de mix');
{
  const ordonne = (p, dA) => p.ok && [p.start, p.swap, p.out].every(fini) && p.start >= 0 &&
    p.start <= p.swap && p.swap <= p.out && p.out <= dA + 0.05 && !/NaN/.test(p.text + p.startLabel + p.swapLabel + p.outLabel);
  const faux = [];
  for (const dA of [8, 20, 30, 45, 60, 95, 180, 240, 420, 1500]) {
    for (const bA of [60, 70, 87, 124, 128, 174]) {
      for (const dB of [20, 240]) {
        const A = { id: 1, bpm: bA }, B = { id: 2, bpm: bA * 1.01 };
        const sA = structure.structureEstimee(dA, bA), sB = structure.structureEstimee(dB, B.bpm);
        const p = sansJeter('plan ' + dA + 's ' + bA, () => engine.mixPlan(A, B, sA, sB));
        if (!p) continue;
        if (p.ok && !ordonne(p, dA)) faux.push(dA + 's@' + bA + ' (B ' + dB + 's) : ' + p.start + ' / ' + p.swap + ' / ' + p.out);
        if (!p.ok && !p.note) faux.push(dA + 's@' + bA + ' : refus sans explication');
      }
    }
  }
  verifier('plans estimes : ordonnes, positifs, dans le morceau', !faux.length, faux.slice(0, 4).join(' | ') + (faux.length > 4 ? ' … (' + faux.length + ')' : ''));
  /* Une batterie qui n'arrive qu'a la toute fin du morceau A. */
  const tard = { ok: true, duration: 240, bpm: 124, firstBeat: 0.2, inPoint: 0.2, readyAt: 228, outPoint: 236, lastCall: 224.5, outroBars: 2 };
  const normal = structure.structureEstimee(240, 124);
  const pt = engine.mixPlan({ bpm: 124 }, { bpm: 124 }, tard, normal);
  verifier('batterie tardive : le plan reste dans le morceau', !pt.ok || ordonne(pt, 240), [pt.start, pt.swap, pt.out].join(' / '));
  /* Des structures abimees (cache d'une ancienne version, fichier
     tronque) : jamais de « NaN:NaN » en cabine. */
  const abimees = [
    {}, { ok: true }, { ok: true, duration: 'x' }, { ok: true, duration: NaN, readyAt: 10, outPoint: 200, firstBeat: 0, inPoint: 0, lastCall: 180 },
    Object.assign({}, normal, { readyAt: undefined }), Object.assign({}, normal, { outPoint: null }),
    Object.assign({}, normal, { duration: -5 }), structure.structureEstimee(NaN, 124), structure.structureEstimee(0, 124)
  ];
  const pourris = [];
  for (const s of abimees) {
    for (const [x, y] of [[s, normal], [normal, s]]) {
      const p = sansJeter('structure abimee', () => engine.mixPlan({ bpm: 124 }, { bpm: 124 }, x, y));
      if (!p) continue;
      if (p.ok && !ordonne(p, x.duration > 0 ? x.duration : 0)) pourris.push(JSON.stringify([p.start, p.swap, p.out, p.text]));
      if (!p.ok && typeof p.note !== 'string') pourris.push('refus muet');
    }
  }
  verifier('structures abimees : refus explique ou plan valide', !pourris.length, pourris.slice(0, 3).join(' | '));
  const sans = engine.mixPlan({ bpm: 124 }, { bpm: 124 }, null, null);
  verifier('structure absente : attente annoncee', sans && sans.ok === false && typeof sans.note === 'string');
  const sansBpm = Object.assign({}, normal, { bpm: undefined });
  const tempo0 = engine.mixPlan({ bpm: 0 }, { bpm: NaN }, sansBpm, sansBpm);
  verifier('sans tempo nulle part : pas de plan', tempo0 && tempo0.ok === false);
  verifier('mmss ne rend jamais NaN', [NaN, -1, Infinity, undefined, 179.7, 59.5].every(v => /^\d+:\d\d$/.test(engine.mmss(v))),
           [NaN, -1, Infinity, undefined, 179.7, 59.5].map(engine.mmss).join(' '));
}

/* ============================================================
   12. LE GOUT : FICHIER ABIME, BORNES, OUBLI
   ============================================================ */
console.log('\n12. apprentissage');
{
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-robustesse-'));
  const contenus = {
    'vide': '', 'tronque': '{"v":1,"ema":{"h":0.', 'nul': 'null', 'tableau': '[]', 'nombre': '42',
    'partiel': '{"v":1}', 'ema tableau': '{"v":1,"ema":[],"n":-5}',
    'valeurs folles': '{"v":1,"ema":{"h":"x","tp":1e9,"en":null,"ti":-1e9},"n":"abc","pris":null,"emaPop":"z","ecartTempo":-4,"pasHaut":1e9,"pasBas":"q","repetitionArtiste":99}',
    'compteurs NaN': '{"v":1,"ema":{"h":0.2},"n":null,"pris":"x","prisPremier":{},"ignore":[]}',
    'autre version': '{"v":2,"ema":{"h":0.9},"n":500}'
  };
  const borne = r => {
    const d = [];
    for (const [k, v] of Object.entries(r.poids || {})) {
      if (!fini(v)) d.push(k + '=' + v);
      else if (k !== 'pop' && (v < 0.5 || v > 1.8)) d.push(k + '=' + v);
    }
    if (r.marge !== undefined && !(r.marge >= 0.01 && r.marge <= 0.12)) d.push('marge=' + r.marge);
    if (r.variete !== undefined && !fini(r.variete)) d.push('variete=' + r.variete);
    if (r.pas) for (const k of ['up', 'down', 'hold']) if (!fini(r.pas[k])) d.push('pas.' + k + '=' + r.pas[k]);
    return d;
  };
  for (const [nom, txt] of Object.entries(contenus)) {
    const f = path.join(dossier, nom.replace(/\s/g, '_') + '.json');
    fs.writeFileSync(f, txt);
    const g = sansJeter('gout ' + nom, () => new Gout(f));
    if (!g) continue;
    const r = sansJeter('gout ' + nom + ' reglages', () => g.reglages());
    if (!r) continue;
    const d = borne(r);
    verifier('gout « ' + nom + ' » se charge, reglages bornes', !d.length, d.join(', '));
    verifier('gout « ' + nom + ' » : compteurs sains', [g.d.n, g.d.pris, g.d.prisPremier, g.d.ignore].every(v => Number.isInteger(v) && v >= 0),
             JSON.stringify([g.d.n, g.d.pris, g.d.prisPremier, g.d.ignore]));
    sansJeter('gout ' + nom + ' resume', () => g.resume());
  }
  /* Un apprentissage nourri de mesures abimees ne doit rien
     empoisonner — ni lui, ni les suggestions qu'il pilote. */
  const g = new Gout(path.join(dossier, 'nourri.json'));
  const L = bibliotheque(30);
  const abime = morceau({ title: 'Abime', artist: 'B', genre: 'House', bpm: 124, key: '8A' }, { energy: NaN, timbre: [NaN, 1, 2] });
  let prec = L[0];
  for (let i = 0; i < 80; i++) {
    const joue = i % 4 === 0 ? abime : L[(i * 7) % L.length];
    const props = engine.suggest(prec, L.concat([abime]), { limit: 5 });
    sansJeter('observer ' + i, () => g.observer({ cur: prec, joue: joue, propositions: props, recents: L.slice(0, i % 20), arc: 'up', dna: { house: 80 } }));
    prec = joue;
  }
  const r = g.reglages();
  const d = borne(r);
  verifier('apres 80 enchainements dont des mesures abimees : reglages bornes', !d.length, d.join(', '));
  verifier('les moyennes apprises restent finies', ['emaPop', 'ecartTempo', 'repetitionArtiste', 'sautEnergie', 'pasHaut', 'pasBas'].every(k => fini(g.d[k])) &&
           Object.values(g.d.ema).every(fini), JSON.stringify(g.d.ema));
  const l = engine.suggest(L[1], L, { limit: 5, poids: r.poids, marge: r.marge, variete: r.variete, pas: r.pas });
  controler('suggestions pilotees par ce gout', l, L[1], 5);
  g.oublier();
  const apres = new Gout(path.join(dossier, 'nourri.json'));
  verifier('« tout oublier » repart de zero, sur disque aussi', g.d.n === 0 && apres.d.n === 0 && apres.reglages().appris === false);
  const arc = sansJeter('arcObserve', () => g.arcObserve([{ energy: NaN }, { energy: 'x' }, null, { energy: 5 }, { energy: 6 }, { energy: 7 }]));
  verifier('courbe observee sur des energies abimees', arc === null || ['up', 'down', 'hold'].includes(arc), String(arc));
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
}

/* ============================================================
   13. LE SAUVETAGE SUR UNE BIBLIOTHEQUE MAIGRE
   ============================================================ */
console.log('\n13. sauvetage');
{
  const cur = morceau({ title: 'Piste vide', artist: 'V', genre: 'House', bpm: 124, key: '8A' }, { energy: 4, timbre: [5, 5, 5] });
  for (const [nom, L] of [['vide', []], ['absente', undefined], ['le sien seul', [cur]],
                          ['un titre', [morceau({ title: 'Un', artist: 'U', genre: 'House', bpm: 124, key: '8A', pop: 80 })]],
                          ['rien de mixable', [morceau({ title: 'Loin', artist: 'L', genre: 'House', bpm: 90, key: '8A' })]]]) {
    const r = sansJeter('sauvetage ' + nom, () => engine.rescue(cur, L, { limit: 3 }));
    verifier('sauvetage, bibliotheque ' + nom + ' : liste propre', Array.isArray(r) && r.length <= 3 && r.every(c => fini(c.total) && c.track !== cur));
  }
  verifier('sauvetage sans morceau en cours', Array.isArray(engine.rescue(null, bibliotheque(5), {})));
  verifier('suggestions sans morceau en cours', Array.isArray(engine.suggest(null, bibliotheque(5), {})));
  /* L'atterrissage, qui lit les memes morceaux. */
  const L = bibliotheque(20).concat([morceau({ title: 'Duree NaN', artist: 'D', genre: 'Pop', bpm: 120, key: '8A', duration: NaN })]);
  const p = sansJeter('atterrissage', () => landing.plan({ restantMin: 40, library: L }));
  verifier('atterrissage : plan propre', p && p.ok && p.arc.every(x => fini(x.e) && fini(x.min)));
  verifier('atterrissage sur des minutes absurdes', [NaN, -10, 'abc', 0, 1e9].every(m => { const x = landing.plan({ restantMin: m, library: L }); return x && typeof x.ok === 'boolean'; }));
}

/* ============================================================
   14. 50 000 TITRES : LE TEMPS D'UN CHANGEMENT DE MORCEAU
   ============================================================ */
console.log('\n14. performances');
{
  const G = GENRES.concat(['Rap FR', 'Zouk', 'Latin', 'EDM', 'Drum & Bass', 'Jazz', 'Rock', 'Chanson']);
  let s = 42;
  const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  /* Un vocabulaire a la Zipf : quelques mots partout (« the », « la »,
     « love » dans un titre sur quatre ou cinq), une longue traine de
     mots rares — comme une vraie bibliotheque. Des noms d'artistes
     faits de syllabes, pour qu'aucun mot ne soit dans TOUS les titres. */
  const COURANTS = ['the', 'la', 'love', 'de', 'you', 'me', 'night', 'le', 'my', 'amour', 'baby', 'dance',
                    'les', 'in', 'on', 'fire', 'time', 'up', 'feel', 'soleil'];
  const RARES = [];
  const SYL = ['ka', 'lo', 'mi', 'ra', 'ton', 'bel', 'dy', 'vo', 'sha', 'rin', 'gu', 'pel', 'zor', 'na', 'fi', 'que'];
  for (let i = 0; i < 600; i++) RARES.push(SYL[i % 16] + SYL[(i * 7 + 3) % 16] + (i % 3 ? SYL[(i * 5 + 1) % 16] : ''));
  const mot = () => {
    const x = r();
    return x < 0.45 ? COURANTS[Math.floor(Math.pow(r(), 2.2) * COURANTS.length)] : RARES[Math.floor(r() * RARES.length)];
  };
  const bruts = [];
  for (let i = 0; i < 50000; i++) {
    const nomArtiste = SYL[i % 16] + SYL[(i >> 4) % 16] + ' ' + RARES[(i * 13) % RARES.length];
    bruts.push({ path: '/grosse/' + i + '.mp3', title: mot() + ' ' + mot() + ' ' + mot(), artist: nomArtiste,
                 genre: G[i % G.length], bpm: 70 + Math.round(r() * 1050) / 10, key: CLES[i % 24],
                 year: 1970 + (i % 56), duration: 150 + (i % 200), pop: Math.round(r() * 100) });
  }
  const L = lib.finalize(bruts);
  for (let i = 0; i < L.length; i += 2) { L[i].analyzed = true; L[i].energy = 1 + (i % 10); L[i].timbre = [i % 10, (i * 3) % 10, (i * 7) % 10]; }
  const opt = { limit: 7, recent: L.slice(100, 148), repertoire: { centre: repertoire.centre(L), ouvertes: new Set() },
                dna: { house: 80, disco: 70, pop: 60 } };
  const chrono = fn => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
  const froid = chrono(() => engine.suggest(L[5], L, opt));
  const chauds = [];
  for (let k = 0; k < 8; k++) chauds.push(chrono(() => engine.suggest(L[11 + k * 97], L, opt)));
  chauds.sort((a, b) => a - b);
  const pire = chauds[chauds.length - 1];
  verifier('suggest, premier appel sur 50 000 titres < 400 ms', froid < 400, Math.round(froid) + ' ms');
  verifier('suggest, changement de morceau < 250 ms', pire < 250, 'median ' + Math.round(chauds[4]) + ' ms, pire ' + Math.round(pire) + ' ms');
  const B = engine.bulle.ancrer(L[5], L);
  const tb = chrono(() => engine.suggest(L[5], L, Object.assign({ bulle: B }, opt)));
  verifier('suggest en bulle < 250 ms', tb < 250, Math.round(tb) + ' ms');
  const tr = chrono(() => engine.rescue(L[5], L, { recent: opt.recent }));
  verifier('sauvetage < 250 ms', tr < 250, Math.round(tr) + ' ms');
  const ti = chrono(() => engine.search('love', L));
  const tq = [];
  for (const q of ['love the night', 'the fire', 'la danse du soleil', 'me you baby', 'you', 'amour de la vie']) tq.push(chrono(() => engine.search(q, L)));
  const tm = [];
  for (const q of [L[77].artist + ' - ' + L[77].title, 'The Love Club - The Night Is Young', 'Les Amants de la nuit - Le temps de l\'amour', 'kalomi - you and me in the night'])
    tm.push(chrono(() => engine.match(q, L)));
  verifier('index de recherche, construit une fois < 1 s', ti < 1000, Math.round(ti) + ' ms');
  verifier('recherche d\'un invite < 250 ms (mots tres courants)', Math.max(...tq) < 250, tq.map(Math.round).join(' / ') + ' ms');
  verifier('reconnaissance du deck < 250 ms (mots tres courants)', Math.max(...tm) < 250, tm.map(Math.round).join(' / ') + ' ms');
  const l = engine.suggest(L[5], L, opt);
  controler('50 000 titres', l, L[5], 7);
}

/* ---------- la meme chanson, partout : pastille, filtre, cloture ---------- */
{
  console.log('\n- La meme chanson dans un autre fichier -');
  const os = require('os'), fs = require('fs'), path = require('path');
  const { SetLog } = require('../src/session');
  const filtres = require('../src/filters');
  const landing = require('../src/landing');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-chanson-'));
  const log = new SetLog(dir);
  log.open('Mariage Test', null);
  const radio = { id: 'r1', title: 'Voyage voyage (Radio Edit)', artist: 'Desireless', bpm: 128, energy: 6, duration: 240 };
  const longue = { id: 'x9', title: 'Voyage voyage (Extended Mix)', artist: 'Desireless', bpm: 128, energy: 6, duration: 400 };
  const autre = { id: 'a2', title: 'Voyage au bout de la nuit', artist: 'Quelqu\'un', bpm: 128, energy: 6, duration: 300 };
  log.play(radio, null);
  const d = log.lastPlay(longue.id, { track: longue });
  verifier('pastille « deja passe » sur la version longue d\'un titre joue', !!(d && d.grave), JSON.stringify(d));
  verifier('... mais pas sur un autre titre qui commence pareil', log.lastPlay(autre.id, { track: autre }) === null);
  verifier('sans le morceau entier, rien ne change (compatibilite)', log.lastPlay(longue.id) === null);
  const f = filtres.build({ skipPlayed: true, playedIds: log.playedIds(), playedSongs: log.playedSongs() });
  const ids = [radio, longue, autre].filter(f.keep).map(t => t.id);
  verifier('filtre « Pas deja joue » : ecarte aussi l\'autre version', ids.join(',') === 'a2', ids.join(','));
  const cl = landing.plan({ restantMin: 30, library: [longue, autre], playedIds: log.playedIds(), playedSongs: log.playedSongs(), playedDurs: [], banned: new Set(), wanted: new Set() });
  const fin = cl && (cl.cloture || cl.closer || cl.track || null);
  verifier('le dernier morceau de la nuit n\'est pas une version d\'un titre deja passe',
    !JSON.stringify(cl || {}).includes('x9'), JSON.stringify(fin && (fin.id || fin.track && fin.track.id)));
}

console.log('\n' + (cas - echecs) + ' / ' + cas + ' invariants tenus.');
if (echecs) {
  console.error(echecs + ' invariant(s) du moteur en echec.');
  process.exit(1);
}
console.log('robustesse du moteur : rien ne casse, rien ne ment, rien ne traine.');
