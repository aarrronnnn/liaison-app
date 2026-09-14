'use strict';
/* ============================================================
   « Ca devrait matcher, et ca ne sort pas. »

     — Daddy Cool doit proposer YMCA
     — Cosmo doit proposer Macklemore
     — Last Night doit proposer Waka Waka

   Trois signalements, et aucune facon de savoir lequel des huit
   filtres ferme la porte. Le widget donne une note, pas une
   raison. On devinait, et deviner coute une version a chaque
   fois.

   Cet outil repond a la seule question qui compte : POURQUOI ce
   morceau-la ne sort pas derriere celui-ci. Il charge la vraie
   bibliotheque, le vrai cache d'analyse et les vrais reglages,
   puis il deroule la chaine dans l'ordre exact du moteur :

     1. les deux titres existent-ils seulement ?
     2. ont-ils un tempo, une tonalite, un genre, une analyse ?
     3. le candidat passe-t-il le crible de tempo ?
     4. et sinon, a quelle place sort-il, et quel axe le coule ?

   USAGE
     node build/pourquoi.js "daddy cool" "ymca"
     node build/pourquoi.js "pilee"            (un seul titre : on
                                                verifie juste qu'il
                                                est lisible)
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const engine = require('../src/engine.js');
const lib = require('../src/library.js');
const plancher = require('../src/plancher.js');
const parente = require('../src/parente.js');
const genres = require('../src/genres.js');

/* ---------- ou vit Liaison ---------- */
function dossier() {
  if (process.env.LIAISON_DIR) return process.env.LIAISON_DIR;
  const h = os.homedir();
  if (process.platform === 'darwin') return path.join(h, 'Library', 'Application Support', 'Liaison');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || h, 'Liaison');
  return path.join(h, '.config', 'Liaison');
}
const DIR = dossier();
const lireJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

const args = process.argv.slice(2).filter(x => x.trim());
if (!args.length) {
  console.log('Usage :');
  console.log('  node build/pourquoi.js "daddy cool" "ymca"');
  console.log('  node build/pourquoi.js "pilee"');
  process.exit(0);
}

/* ---------- la bibliotheque, chargee comme l'app la charge ---------- */
const cfg = lireJSON(path.join(DIR, 'config.json'));
if (!cfg) {
  console.log('Aucun reglage trouve dans :');
  console.log('  ' + DIR);
  console.log('Lance Liaison au moins une fois, puis relance cette commande.');
  process.exit(1);
}
console.log('Dossier Liaison : %s', DIR);
console.log('Bibliotheque    : %s (%s)', cfg.libraryPath || '(aucune)', cfg.libraryMode || '?');

let bruts = [];
try {
  if (cfg.libraryMode === 'rekordbox' && cfg.libraryPath)
    bruts = lib.parseRekordboxXML(cfg.libraryPath);
  else if (cfg.libraryPath) {
    const c = lib.chargerScanCache(path.join(DIR, 'scan-cache.json')).e;
    bruts = Object.keys(c).map(k => Object.assign({ path: k.split('|')[0] }, c[k]));
  }
} catch (e) { console.log('Lecture impossible : ' + e.message); }

if (!bruts.length) {
  console.log('\nAucun morceau lu. Si ta bibliotheque est un DOSSIER et non un export');
  console.log('rekordbox, ouvre Liaison une fois pour qu\'il remplisse son cache.');
  process.exit(1);
}
const L = lib.finalize(bruts);

/* ---------- le cache d'analyse, exactement comme AnalysisService ---------- */
const cacheAn = lireJSON(path.join(DIR, 'analysis-cache.json')) || {};
let mesures = 0, absents = 0;
for (const t of L) {
  if (!t.path) continue;
  let st = null;
  try { const s = fs.statSync(t.path); st = s.size + ':' + Math.round(s.mtimeMs); }
  catch (e) { t.offline = true; absents++; continue; }
  const c = cacheAn[t.path + '|' + st];
  if (c) { Object.assign(t, c); t.analyzed = true; mesures++; }
}
console.log('Morceaux        : %d  (analyses : %d, fichiers injoignables : %d)',
            L.length, mesures, absents);

/* ---------- retrouver un titre ---------- */
const sansAccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function chercher(q) {
  const k = sansAccent(q).trim();
  const exact = [], partiel = [];
  for (const t of L) {
    const nom = sansAccent(t.title) + ' ' + sansAccent(t.artist);
    if (sansAccent(t.title) === k) exact.push(t);
    else if (nom.indexOf(k) >= 0) partiel.push(t);
  }
  return exact.concat(partiel);
}

function carte(t, etiquette) {
  const fam = [...genres.famillesDe(t)].map(x => x[0]).join(', ') || '(aucune famille reconnue)';
  const pl = plancher.plancher(t);
  console.log('\n%s', etiquette);
  console.log('  %s — %s', t.title || '(sans titre)', t.artist || '(sans artiste)');
  console.log('  fichier   %s', t.path || '(aucun)');
  console.log('  tempo     %s', t.bpm > 0 ? t.bpm : 'ABSENT — le moteur ne peut pas caler');
  console.log('  tonalite  %s', t.key || 'ABSENTE — l\'axe harmonique ne compte pas');
  console.log('  genre     %s  ->  %s', t.genre || '(aucun)', fam);
  console.log('  annee     %s', t.year || '(aucune)');
  console.log('  analyse   %s', t.analyzed ? 'oui (energie ' + t.energy + ')'
              : (t.offline ? 'NON — fichier injoignable' : 'NON — pas encore mesure'));
  console.log('  plancher  %d /100 (confiance %s)', pl.v, pl.sur);
}

/* ============================================================
   UN SEUL TITRE : est-il seulement lisible ?
   ============================================================ */
const trouves = chercher(args[0]);
if (!trouves.length) {
  console.log('\n« %s » : AUCUN morceau de ce nom dans la bibliotheque.', args[0]);
  console.log('C\'est la premiere porte, et elle explique tout le reste : Liaison ne');
  console.log('peut ni l\'afficher, ni l\'analyser, ni le proposer. Verifie qu\'il est');
  console.log('bien dans ton export rekordbox, puis relance l\'import dans les reglages.');
  const proches = L.filter(t => sansAccent(t.title).slice(0, 4) === sansAccent(args[0]).slice(0, 4));
  if (proches.length) {
    console.log('\nTitres qui commencent pareil :');
    for (const t of proches.slice(0, 8)) console.log('  %s — %s', t.title, t.artist);
  }
  process.exit(0);
}
if (trouves.length > 1) {
  console.log('\n%d morceaux correspondent a « %s ». On prend le premier :', trouves.length, args[0]);
  for (const t of trouves.slice(0, 5)) console.log('   %s — %s', t.title, t.artist);
}
const CUR = trouves[0];
carte(CUR, 'CE QUI TOURNE');

if (args.length < 2) {
  /* ------------------------------------------------------------
     Les trois portes qu'un morceau doit franchir pour s'afficher.
     « Le son Pilee, Liaison ne le lit meme pas. » On dit laquelle
     se ferme, au lieu de laisser chercher.
     ------------------------------------------------------------ */
  const rb = require('../src/sources/rekordbox.js');
  const ext = path.extname(CUR.path || '');
  const reconnue = /\.(mp3|wav|wave|aiff?|aifc|flac|alac|m4a|m4b|mp4|aac|ogg|oga|opus|wma|wv|ape|dsf|dff|mpc)$/i.test(CUR.path || '');
  console.log('\n--- LES TROIS PORTES ---\n');
  console.log('1. dans la bibliotheque  OUI');
  console.log('2. extension reconnue    %s%s', reconnue ? 'OUI' : 'NON',
              ext ? '  (' + ext + ')' : '  (aucune extension)');
  if (!reconnue) {
    console.log('\n   C\'EST LA QUE CA SE FERME. Liaison repere le morceau qui tourne');
    console.log('   parmi les fichiers que rekordbox tient ouverts, et il ne regarde');
    console.log('   que les extensions audio connues. Celle-ci n\'en fait pas partie :');
    console.log('   le morceau reste invisible. Dis-le-moi, je l\'ajoute.');
    process.exit(0);
  }
  console.log('3. fichier joignable     %s', CUR.offline ? 'NON — disque debranche ou fichier deplace' : 'OUI');
  if (CUR.offline) {
    console.log('\n   C\'EST LA QUE CA SE FERME. Le chemin enregistre ne mene a rien :');
    console.log('   ' + CUR.path);
    console.log('   Rebranche le disque, ou reexporte ta collection depuis rekordbox.');
    process.exit(0);
  }
  if (rb.dispo) {
    console.log('\nLes trois portes sont ouvertes. Je regarde si rekordbox tient');
    console.log('ce fichier ouvert en ce moment...\n');
    rb.pids(function (ps) {
      if (!ps.length) {
        console.log('  rekordbox n\'est pas lance. Lance-le, mets le morceau sur un deck,');
        console.log('  puis relance cette commande.');
        return;
      }
      let reste = ps.length, vus = [];
      ps.forEach(function (pid) {
        rb.fichiersAudio(pid, function (fs2) {
          vus = vus.concat(fs2);
          if (--reste) return;
          const ici = vus.some(function (f) { return f === CUR.path; });
          console.log('  rekordbox tient %d fichier(s) audio ouvert(s).', vus.length);
          console.log('  ce morceau parmi eux : %s', ici ? 'OUI' : 'NON');
          if (ici) {
            console.log('\n  Tout est en place : si le widget ne l\'affiche pas, c\'est la');
            console.log('  regle du « dernier arrive » qui se trompe de deck. Lance :');
            console.log('    node build/sonde-decks.js');
          } else {
            console.log('\n  rekordbox ne tient PAS ce fichier ouvert. Soit il n\'est pas');
            console.log('  charge sur un deck en ce moment, soit rekordbox l\'a lu puis');
            console.log('  referme. Charge-le sur un deck et relance.');
            if (vus.length) {
              console.log('\n  Ce qui est ouvert en ce moment :');
              vus.slice(0, 10).forEach(function (f) { console.log('    ' + path.basename(f)); });
            }
          }
        });
      });
    });
    return;
  }
  console.log('\nLe morceau est lisible par Liaison. S\'il ne s\'affiche pas en cabine,');
  console.log('le probleme est la DETECTION du deck, pas la bibliotheque :');
  console.log('  node build/sonde-decks.js');
  process.exit(0);
}

/* ============================================================
   DEUX TITRES : pourquoi celui-la ne sort pas derriere celui-ci.
   ============================================================ */
const cibles = chercher(args[1]);
if (!cibles.length) {
  console.log('\n« %s » : AUCUN morceau de ce nom dans la bibliotheque.', args[1]);
  console.log('Liaison ne peut pas proposer un morceau qu\'il n\'a pas.');
  process.exit(0);
}
const CIB = cibles[0];
carte(CIB, 'CE QU\'IL DEVRAIT PROPOSER');

console.log('\n--- LA CHAINE, DANS L\'ORDRE DU MOTEUR ---\n');

/* 1. le crible de tempo */
const dbl = engine.doubleAdmis(CUR, CIB);
const passe = CUR.bpm > 0 && CIB.bpm > 0
  ? engine.passeLeCrible(CUR.bpm, CIB.bpm, cfg.marge, dbl)
  : true;
const ecart = (CUR.bpm > 0 && CIB.bpm > 0)
  ? Math.abs(CIB.bpm - CUR.bpm) / CUR.bpm * 100 : null;
console.log('1. crible de tempo       %s', passe ? 'PASSE' : 'BLOQUE');
if (ecart != null)
  console.log('   %s -> %s  soit %s %% d\'ecart%s', CUR.bpm, CIB.bpm, ecart.toFixed(1),
              dbl ? ' (double tempo admis)' : ' (double tempo refuse : familles trop eloignees)');
if (!passe) {
  console.log('\n   C\'EST LA QUE CA SE FERME. Le crible ecarte au-dela de 12 %% par');
  console.log('   defaut. Ce morceau n\'est meme pas NOTE : il ne peut pas sortir.');
  console.log('   Dans les reglages, ouvre la marge de tempo.');
}

/* 2. la note, axe par axe */
const out = engine.suggest(CUR, L, { limit: 200, arc: 'up', dna: {},
                                     annee: new Date().getFullYear() });
const rang = out.findIndex(r => r.track.id === CIB.id);
const r = rang >= 0 ? out[rang] : null;
console.log('\n2. classement            %s',
  rang < 0 ? 'HORS LISTE (ecarte avant la notation)'
           : ('position ' + (rang + 1) + ' sur ' + out.length + ' candidats notes'));

if (r) {
  console.log('\n3. le detail de sa note  (total %d /100)', r.total);
  const lignes = [
    ['tempo',     Math.round(r.tempo.s), 0.30],
    ['style',     r.parente,             0.24],
    ['harmonie',  Math.round(r.h),       0.16],
    ['plancher',  r.plancher,            0.17],
    ['energie',   Math.round(r.energyScore), 0.15],
    ['timbre',    Math.round(r.timbreScore), 0.14],
    ['fraicheur', r.fraicheur,           0.14],
    ['affinite',  Math.round(r.affinite), 0.12],
    ['salle',     Math.round(r.crowd),   0.26]
  ];
  lignes.sort((a, b) => a[1] - b[1]);
  for (const [nom, val, poids] of lignes) {
    const barre = '#'.repeat(Math.round(val / 5)).padEnd(20, '.');
    /* console.log de Node ne connait pas « %3d » : il l'affiche tel
       quel et decale tout le reste. On aligne a la main. */
    console.log('   %s %s %s  (poids %s)%s', nom.padEnd(10), barre,
                String(val).padStart(3), String(poids).padEnd(4),
                val < 40 ? '  <= c\'est lui qui coule' : '');
  }
  if (r.parenteDit) console.log('\n   Liaison dit : « %s »', r.parenteDit);
  if (r.plancherDit) console.log('   Liaison dit : « %s »', r.plancherDit);
  if (r.age) console.log('   Liaison dit : « %s »', r.age);

  const limite = 5;
  if (rang >= limite) {
    console.log('\n   Il est note, mais %d morceaux passent devant. Les cinq premiers :', rang);
    for (const x of out.slice(0, 5))
      console.log('     %d  %s — %s', x.total, x.track.title, x.track.artist);
  }
}
console.log('');
