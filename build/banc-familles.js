/* ============================================================
   « Est-ce que les changements sont valorisants sur TOUS les
     types de son ? »

   Premiere tentative : le banc de rejeu classique — cacher le
   morceau joue, regarder s'il revient dans les cinq. Resultat :
   0 % partout. Normal, et ca ne prouve rien : dans une famille
   de six cents titres equivalents, retrouver LE bon est une
   loterie a un contre cent vingt. Le banc mesurait le hasard.

   La bonne question n'est pas « as-tu devine le titre exact »,
   c'est « aurais-tu propose quelque chose qu'un vrai DJ accepte ».
   Pour chaque enchainement reellement joue A -> B, on compare donc
   notre premiere proposition B' a ce que le DJ a fait :

     — meme famille de genre que son choix ?
     — un ecart de tempo au plus aussi grand que le sien ?
     — la meme direction d'energie ?

   Trois sur trois : la proposition tient la route. C'est mesurable
   et ca veut dire quelque chose.
   ============================================================ */
/* USAGE
     node build/banc-familles.js        les six profils, avant / apres
     node build/banc-familles.js pas    le balayage du pas d'energie
*/
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const parente = require('../src/parente.js');

let s = 5; const r = () => ((s = s * 1103515245 + 12345 | 0) >>> 0) / 4294967296;
const KEYS = []; for (let i = 1; i <= 12; i++) { KEYS.push(i + 'A'); KEYS.push(i + 'B'); }
let n = 0;

const PROFILS = {
  'club house':   { fam: [['House',2022,126,8],['Tech House',2023,127,8],['Techno',2021,131,9],['French Touch',2000,124,7],['EDM',2019,128,9]],
                    suite: ['House','Tech House','Tech House','Techno','House','French Touch','EDM','House'] },
  'mariage fr':   { fam: [['Variete francaise',1985,122,7],['Disco',1978,124,8],['Pop',2016,118,7],['Hymne',1990,124,9],['Motown',1968,116,7],['Funk',1976,112,7],['Rock',1982,132,8]],
                    suite: ['Variete francaise','Disco','Funk','Motown','Variete francaise','Pop','Hymne','Rock'] },
  'soleil':       { fam: [['Ragga',1992,98,6],['Reggaeton',2021,94,8],['Zouk',1985,100,6],['Afro House',2022,112,8],['Latin',2018,98,7],['Dancehall',2016,100,8]],
                    suite: ['Ragga','Dancehall','Reggaeton','Latin','Zouk','Afro House','Reggaeton','Ragga'] },
  'rap / urbain': { fam: [['Rap FR',2020,96,7],['Hip Hop',2018,92,7],['Drill',2022,142,8],['RnB',2010,84,5],['Afro House',2022,112,8]],
                    suite: ['Rap FR','Hip Hop','Rap FR','Drill','Hip Hop','RnB','Afro House','Rap FR'] },
  'bar lounge':   { fam: [['Ambient',2019,92,3],['Jazz',1960,105,3],['RnB',2005,88,4],['Deep House',2021,118,5],['Bossa Nova',1964,100,3]],
                    suite: ['Ambient','Jazz','Bossa Nova','RnB','Deep House','Ambient','Jazz','RnB'] },
  'annees 80':    { fam: [['Pop',1985,118,7],['Disco',1979,122,8],['Rock',1984,130,8],['Italodance',1986,124,8],['Funk',1982,112,7]],
                    suite: ['Pop','Disco','Italodance','Pop','Rock','Funk','Disco','Pop'] }
};

function biblio(fam, taille) {
  const out = [];
  for (let i = 0; i < taille; i++) {
    const p = fam[Math.floor(r() * fam.length)];
    out.push({ path: '/m/' + (++n) + '.mp3', title: p[0] + ' ' + i, artist: 'A' + (i % 220),
      genre: p[0], year: p[1] + Math.floor(r() * 8) - 4, bpm: p[2] + Math.floor(r() * 9) - 4,
      key: r() < 0.45 ? KEYS[Math.floor(r() * 24)] : null,
      energy: p[3] + Math.floor(r() * 3) - 1, timbre: [r() * 10, r() * 10, r() * 10],
      duration: 215, pop: Math.round(r() * 100) });
  }
  const L = lib.finalize(out);
  for (const t of L) t.analyzed = r() < 0.65;
  return L;
}

/* ------------------------------------------------------------
   Un faux DJ qui a une INTENTION.

   Premiere version : il tirait au hasard dans la famille du
   moment. Sa direction d'energie etait donc du bruit pur, et
   « suivre » du bruit est impossible : 33 % est le plafond
   mecanique d'un signe a trois valeurs. Le banc mesurait sa
   propre aleatoire et je m'appretais a en conclure que le moteur
   ignorait l'energie.

   Ce DJ-ci fait ce que font les vrais : il monte pendant les deux
   tiers de la soiree, tient un plateau, puis redescend a la fin.
   A chaque pas il prend, dans la famille du moment, le titre dont
   l'energie approche le mieux sa cible. On peut alors demander au
   moteur s'il suit.
   ------------------------------------------------------------ */
function soirees(L, suite, combien) {
  const parFam = new Map();
  for (const t of L) { if (!parFam.has(t.genre)) parFam.set(t.genre, []); parFam.get(t.genre).push(t); }
  const sets = [];
  const LONG = 24;
  for (let k = 0; k < combien; k++) {
    const joues = [];
    for (let i = 0; i < LONG; i++) {
      const pool = parFam.get(suite[(i + k) % suite.length]) || L;
      /* la courbe de la nuit : 4 -> 9 sur les deux tiers, plateau,
         puis atterrissage */
      const x = i / (LONG - 1);
      const cible = x < 0.65 ? 4 + (9 - 4) * (x / 0.65)
                  : x < 0.85 ? 9 : 9 - 4 * ((x - 0.85) / 0.15);
      let best = null, bd = 99;
      /* on regarde vingt candidats au hasard, pas toute la famille :
         un DJ ne compare pas six cents titres, il prend ce qui lui
         vient et qui colle */
      for (let j = 0; j < 20; j++) {
        const c = pool[Math.floor(r() * pool.length)];
        const d = Math.abs((c.energy == null ? 5 : c.energy) - cible);
        if (d < bd) { bd = d; best = c; }
      }
      joues.push(best || pool[0]);
    }
    sets.push(joues);
  }
  return sets;
}

/* La meme lecture de pente que gout.arcObserve. */
function pente(joues) {
  const e = joues.map(t => (t && t.energy != null) ? t.energy : null).filter(x => x != null);
  if (e.length < 4) return 'hold';
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < e.length; i++) { sx += i; sy += e[i]; sxy += i * e[i]; sxx += i * i; }
  const n = e.length;
  const p = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  if (p > 0.28) return 'up';
  if (p < -0.28) return 'down';
  return 'hold';
}

function mesurer(L, sets, opts) {
  let n = 0, style = 0, tempo = 0, energie = 0, trois = 0, vides = 0;
  for (const joues of sets) {
    for (let i = 1; i < joues.length; i++) {
      const A = joues[i - 1], B = joues[i];
      if (A.id === B.id) continue;
      /* L'app ne fige pas la pente a « up » : elle la LIT dans les
         derniers morceaux joues (gout.arcObserve). Mesurer avec un
         « up » constant, c'est mesurer autre chose que l'app. */
      const recents = joues.slice(Math.max(0, i - 6), i);
      const arc = pente(recents);
      const out = engine.suggest(A, L, Object.assign({ limit: 5, arc: arc, dna: {} }, opts));
      n++;
      if (!out.length) { vides++; continue; }
      const P = out[0].track;
      const sOk = parente.score(A, P) >= parente.score(A, B) - 10;
      const ecartDJ = A.bpm > 0 && B.bpm > 0 ? Math.abs(B.bpm - A.bpm) : 99;
      const ecartNous = A.bpm > 0 && P.bpm > 0 ? Math.abs(P.bpm - A.bpm) : 99;
      const tOk = ecartNous <= ecartDJ + 4;
      const dirDJ = Math.sign((B.energy || 5) - (A.energy || 5));
      const dirNous = Math.sign((P.energy || 5) - (A.energy || 5));
      const eOk = dirNous === dirDJ || dirDJ === 0;
      if (sOk) style++;
      if (tOk) tempo++;
      if (eOk) energie++;
      if (sOk && tOk && eOk) trois++;
    }
  }
  return { n, style, tempo, energie, trois, vides };
}

const AVANT = { poids: { pa: 0.5, pl: 0.5, fr: 0.5 }, marge: 0.12 };
const pc = (x, t) => (100 * x / Math.max(1, t)).toFixed(0) + ' %';

/* ---------- le balayage du pas d'energie ----------
   Quel pas fait qu'on suit le mieux l'intention du DJ ? */
if (process.argv[2] === 'pas') {
  const CANDIDATS = [
    ['d\'origine  1,4 / -1,6 / 0,2', { up: 1.4, down: -1.6, hold: 0.2 }],
    ['plus doux   0,8 / -1,0 / 0,1', { up: 0.8, down: -1.0, hold: 0.1 }],
    ['tres doux   0,5 / -0,7 / 0,0', { up: 0.5, down: -0.7, hold: 0.0 }],
    ['nul         0,0 /  0,0 / 0,0', { up: 0.0, down: 0.0, hold: 0.0 }],
    ['plus franc  2,0 / -2,2 / 0,3', { up: 2.0, down: -2.2, hold: 0.3 }]
  ];
  const tout = new Map(CANDIDATS.map(c => [c[0], { e: 0, n: 0 }]));
  for (const [nom, p] of Object.entries(PROFILS)) {
    const L = biblio(p.fam, 3000);
    const sets = soirees(L, p.suite, 5);
    const ligne = [];
    for (const [etiq, pas] of CANDIDATS) {
      const m = mesurer(L, sets, { pas: pas });
      const acc = tout.get(etiq); acc.e += m.energie; acc.n += m.n;
      ligne.push(pc(m.energie, m.n).padStart(5));
    }
    console.log('%s %s', nom.padEnd(14), ligne.join('  '));
  }
  console.log('\n%s %s', 'pas'.padEnd(30), 'energie suivie');
  for (const [etiq, a] of tout) console.log('  %s %s', etiq.padEnd(28), pc(a.e, a.n).padStart(5));
  console.log('\ncolonnes : ' + CANDIDATS.map(c => c[0].split(' ')[0]).join(', '));
  process.exit(0);
}

console.log('Part des enchainements ou notre premiere proposition tient');
console.log('les trois criteres du DJ : meme style, tempo au moins aussi');
console.log('proche, meme direction d\'energie.\n');
console.log('%s %s %s %s', 'profil'.padEnd(14), 'avant'.padStart(7), 'apres'.padStart(7), '  detail apres (style / tempo / energie)');
console.log('-'.repeat(74));
let mieux = 0, pireCas = null;
for (const [nom, p] of Object.entries(PROFILS)) {
  const L = biblio(p.fam, 3000);
  const sets = soirees(L, p.suite, 5);
  const a = mesurer(L, sets, AVANT);
  const b = mesurer(L, sets, {});
  const d = (100 * b.trois / b.n) - (100 * a.trois / a.n);
  if (d > 0) mieux++;
  if (pireCas === null || d < pireCas[1]) pireCas = [nom, d];
  console.log('%s %s %s   %s / %s / %s   %s',
    nom.padEnd(14), pc(a.trois, a.n).padStart(7), pc(b.trois, b.n).padStart(7),
    pc(b.style, b.n).padStart(4), pc(b.tempo, b.n).padStart(4), pc(b.energie, b.n).padStart(4),
    (d >= 0 ? '+' : '') + d.toFixed(0) + ' pts');
}
console.log('-'.repeat(74));
console.log('%d profils sur %d en progres. Le moins bon : %s (%s pts)',
  mieux, Object.keys(PROFILS).length, pireCas[0], (pireCas[1] >= 0 ? '+' : '') + pireCas[1].toFixed(0));
