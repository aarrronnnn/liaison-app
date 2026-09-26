'use strict';
/* ============================================================
   BILAN DE SANTE 1.5.2 — les bugs de donnees trouves a l'audit.

   Chacun de ces cas faisait une suggestion FAUSSE sans que rien
   ne se voie : un morceau d'une autre tonalite, deux morceaux
   fondus en un, un fichier retire de la bibliotheque, un repere
   de mix invente. Chaque essai a ete joue contre la version
   d'avant et la faisait tomber.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../src/library.js');
const auto = require('../src/autolibrary.js');
const engine = require('../src/engine.js');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(64) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-bilan-'));
console.log('bilan de sante : donnees et suggestions\n');

/* ---------- 1. Traktor : pas de tonalite analysee ≠ 8B ---------- */
{
  const f = path.join(tmp, 'collection.nml');
  fs.writeFileSync(f, `<NML><COLLECTION>
<ENTRY TITLE="Jamais analyse" ARTIST="A"><LOCATION DIR="/:m/:" FILE="a.mp3" VOLUME=""></LOCATION><INFO KEY="Am" PLAYTIME="200"></INFO></ENTRY>
<ENTRY TITLE="Analyse" ARTIST="B"><LOCATION DIR="/:m/:" FILE="b.mp3" VOLUME=""></LOCATION><INFO PLAYTIME="200"></INFO><MUSICAL_KEY VALUE="21"></MUSICAL_KEY></ENTRY>
<ENTRY TITLE="Rien" ARTIST="C"><LOCATION DIR="/:m/:" FILE="c.mp3" VOLUME=""></LOCATION><INFO PLAYTIME="200"></INFO></ENTRY>
</COLLECTION></NML>`);
  const t = auto.parseTraktor(f);
  verifier('Traktor sans MUSICAL_KEY : on lit KEY="Am" (8A), pas 8B', t[0].key === '8A', t[0].key);
  verifier('Traktor MUSICAL_KEY 21 : 8A', t[1].key === '8A', t[1].key);
  verifier('Traktor sans aucune tonalite : inconnue, pas 8B', t[2].key == null, t[2].key);
}

/* ---------- 2. rekordbox : entites XML ---------- */
{
  const d = path.join(tmp, 'Drum & Bass');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'x.wav'), '');
  const f = path.join(tmp, 'rb.xml');
  const loc = 'file://localhost' + encodeURI(tmp.replace(/\\/g, '/')) + '/Drum%20&amp;%20Bass/x.wav';
  fs.writeFileSync(f, `<?xml version="1.0"?><DJ_PLAYLISTS><COLLECTION>
<TRACK TrackID="1" Name="L&apos;Aventurier" Artist="Simon &amp; Garfunkel" Location="${loc}" AverageBpm="128" Tonality="Am" TotalTime="200"/>
</COLLECTION></DJ_PLAYLISTS>`);
  const t = lib.parseRekordboxXML(f)[0];
  verifier('rekordbox : « &amp; » dans le chemin → le fichier existe', fs.existsSync(t.path), t.path);
  verifier('rekordbox : titre « L\'Aventurier »', t.title === "L'Aventurier", t.title);
  verifier('rekordbox : artiste « Simon & Garfunkel »', t.artist === 'Simon & Garfunkel', t.artist);
  verifier('entites en une passe : « &amp;lt; » rend « &lt; »', lib.xmlDecode('&amp;lt;') === '&lt;');
  verifier('entites numeriques : « &#233; &#xE9; »', lib.xmlDecode('&#233;&#xE9;') === 'éé');
}

/* ---------- 3. dedoublonnage : un featuring ne fond pas deux titres ---------- */
{
  const T = (a, t, d, p) => ({ id: p, path: p, artist: a, title: t, duration: d });
  const r = lib.dedoublonner([
    T('Ninho feat. Niska', 'Tout va bien', 200, '/a'),
    T('Ninho feat. Niska', 'Coco', 201, '/b'),
    T('X', 'Danse avec moi', 180, '/c'),
    T('X', 'Danse avec toi', 181, '/d'),
    T('Ninho', 'Tout va bien (feat. Niska)', 200.5, '/e'),
    T('Céline', 'Cœur', 100, '/g'),
    T('Celine', 'Coeur', 100.4, '/h')
  ]);
  const titres = r.tracks.map(t => t.title);
  verifier('« Tout va bien » et « Coco » (meme featuring) restent deux', titres.includes('Coco') && titres.includes('Tout va bien'));
  verifier('« Danse avec moi » et « Danse avec toi » restent deux', titres.includes('Danse avec moi') && titres.includes('Danse avec toi'));
  verifier('la vraie copie « (feat. Niska) » est bien repliee', !titres.includes('Tout va bien (feat. Niska)'));
  verifier('« Cœur » et « Coeur » : meme morceau', r.tracks.filter(t => /c(œ|oe)ur/i.test(t.title)).length === 1);
}

/* ---------- 4. plan de mix sans tempo ---------- */
{
  const S = { ok: true, readyAt: 10, inPoint: 0, outPoint: 180, firstBeat: 0, duration: 220, lastCall: 200 };
  const a = engine.mixPlan({ bpm: 0 }, { bpm: 128 }, S, S);
  const b = engine.mixPlan({ bpm: null }, { bpm: null }, S, S);
  verifier('un BPM absent : pas de repere invente', a.ok === false);
  verifier('deux BPM absents : pas de « Lance a 0:00 »', b.ok === false);
  const c = engine.mixPlan({ bpm: 124 }, { bpm: 125 }, S, S);
  verifier('deux BPM connus : le plan sort toujours', c.ok === true);
}

/* ---------- 5. la variete apprise est appliquee ---------- */
{
  const T = (id, a) => ({ id: 't' + id, path: '/x' + id, title: 'T' + id, artist: a, bpm: 124, key: '8A', genre: 'House', duration: 200 });
  const L = [T(1, 'A'), T(2, 'A'), T(3, 'B'), T(4, 'C')];
  const pen = v => (engine.suggest(L[0], L, { variete: v, limit: 5,
    recent: [{ id: 't1', artist: 'A', at: Date.now() }] }).find(x => x.track.id === 't2') || {}).variete;
  const doux = pen(0.3), dur = pen(1.4);
  verifier('variete apprise 0,3 penalise moins que 1,4', doux > dur, doux + ' / ' + dur);
  verifier('variete NaN : pas de NaN dans le score', Number.isFinite(pen(NaN)));
}

/* ---------- 6. un fichier illisible n'est pas « mesure » ---------- */
{
  const cur = { id: 'c', path: '/c', title: 'C', artist: 'Z', bpm: 124, key: '8A', genre: 'House',
                analyzed: true, energy: 5, timbre: [5, 5, 5], duration: 200 };
  const ill = { id: 'i', path: '/i', title: 'I', artist: 'Y', bpm: 124, key: '8A', genre: 'House',
                analyzed: true, illisible: true, energy: 5, timbre: [5, 5, 5], duration: 200 };
  const r = engine.suggest(cur, [cur, ill], { limit: 5 });
  const x = r.find(s => s.track.id === 'i');
  verifier('illisible : son timbre par defaut ne vaut pas 100', x && x.timbreScore !== 100, x && x.timbreScore);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (ko ? ko + ' RATE(S)' : 'bilan : tonalites, doublons, chemins et reperes tiennent.'));
process.exit(ko ? 1 : 0);
