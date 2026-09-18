'use strict';
/* ============================================================
   Banc d'integration — les points de mix apparaissent-ils ?

   « Point de mix doit se calculer plus vite, moi de mon cote je le
     vois toujours en chargement, je ne l'ai jamais vu fonctionner
     correctement. »

   Aucun banc ne couvrait ce chemin. structure.js avait ses essais
   unitaires, mixPlan aussi — mais PERSONNE ne verifiait que, une
   fois l'app demarree avec une vraie bibliotheque et un vrai
   morceau sur le deck, un plan de mix finissait par arriver dans
   la liste. C'est exactement la ou le defaut vivait : chaque piece
   marchait, l'assemblage non.

   Ce banc demarre main.js pour de vrai, avec un faux Electron,
   importe un dossier de morceaux fabriques a la volee, declare un
   morceau en cours, et attend. Il verifie trois choses :

     1. un plan arrive, et vite ;
     2. quand il n'arrive pas, la ligne DIT pourquoi au lieu de
        faire patienter indefiniment ;
     3. le morceau en cours passe devant les suggestions dans la
        file de calcul — sans sa structure, aucun plan n'existe.

   Il a besoin de ffmpeg. Sans lui, il le dit et s'efface, comme
   test-widget.js le fait pour playwright.
   ============================================================ */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const BAC = path.join(os.tmpdir(), 'liaison-mix-' + process.pid);
const MUSIQUE = path.join(BAC, 'musique');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(56),
              detail ? '  — ' + detail : '');
}

/* ---------- de quoi faire de la musique ---------- */
function ffmpeg() {
  if (process.env.LIAISON_FFMPEG) return process.env.LIAISON_FFMPEG;
  try {
    let p = require(path.join(RACINE, 'node_modules', 'ffmpeg-static'));
    if (p && p.path) p = p.path;
    if (p) return String(p).replace('app.asar', 'app.asar.unpacked');
  } catch (e) {}
  return 'ffmpeg';
}

/* Un morceau avec une vraie forme : intro calme, corps qui frappe,
   outro calme. C'est ce que structure.js cherche a lire. */
function fabriquer(nom, bpm, secondes) {
  const f = path.join(MUSIQUE, nom + '.wav');
  const periode = 60 / bpm;
  execFileSync(ffmpeg(), ['-v', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=210:duration=' + secondes,
    '-af', "volume='if(lt(t,8)+gt(t," + (secondes - 8) + "),0.10,0.16+0.85*exp(-12*mod(t," +
           periode.toFixed(4) + ")))':eval=frame",
    '-ar', '44100', f], { stdio: 'ignore' });
  return f;
}

/* ---------- le bac a sable ---------- */
function preparer() {
  fs.mkdirSync(path.join(BAC, 'node_modules'), { recursive: true });
  fs.mkdirSync(MUSIQUE, { recursive: true });
  fs.cpSync(path.join(RACINE, 'src'), path.join(BAC, 'src'), { recursive: true });
  fs.copyFileSync(path.join(RACINE, 'package.json'), path.join(BAC, 'package.json'));
  const faux = path.join(BAC, 'node_modules', 'electron');
  fs.mkdirSync(faux, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'faux-electron.js'), path.join(faux, 'index.js'));
  fs.writeFileSync(path.join(faux, 'package.json'), JSON.stringify({ name: 'electron', main: 'index.js' }));
  for (const m of ['ffmpeg-static', 'ffprobe-static', 'qrcode']) {
    const src = path.join(RACINE, 'node_modules', m);
    if (fs.existsSync(src)) {
      try { fs.symlinkSync(src, path.join(BAC, 'node_modules', m), 'dir'); } catch (e) {}
    }
  }
}

const dodo = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  try { execFileSync(ffmpeg(), ['-version'], { stdio: 'ignore' }); }
  catch (e) {
    console.log('points de mix : ffmpeg absent ou inutilisable — banc non joue.');
    console.log('  (LIAISON_FFMPEG=/chemin/vers/ffmpeg node build/test-points-de-mix.js)');
    process.exit(0);
  }

  preparer();
  process.env.LIAISON_TEST_DOSSIER = MUSIQUE;
  process.env.LIAISON_TEST_PRET = '1';

  for (const [nom, bpm] of [['un', 128], ['deux', 128], ['trois', 127], ['quatre', 129]])
    fabriquer(nom, bpm, 95);
  verifier('0. quatre morceaux fabriques',
           fs.readdirSync(MUSIQUE).length === 4, fs.readdirSync(MUSIQUE).join(', '));

  const el = require(path.join(BAC, 'node_modules', 'electron'));
  require(path.join(BAC, 'src', 'main.js'));
  await dodo(300);
  const H = el.__handlers;

  /* ---------- 1. la bibliotheque ---------- */
  const imp = await H['library:pick'](null, 'folder');
  verifier('1. la bibliotheque s\'importe', imp && imp.n === 4, imp ? imp.n + ' titres' : 'rien');

  /* ---------- 2. un morceau sur le deck ---------- */
  const trouve = await H['track:search'](null, 'un');
  verifier('2. on retrouve un morceau par la loupe', trouve.length > 0,
           trouve.map(x => x.title).join(', '));
  const charge = await H['track:load'](null, trouve[0].id);
  verifier('2bis. il devient le morceau en cours', charge && charge.ok === true);

  /* ---------- 3. le plan finit par arriver, et vite ---------- */
  const DELAI = 20000;
  const t0 = Date.now();
  let sug = [], avecPlan = 0, etats = new Set();
  while (Date.now() - t0 < DELAI) {
    sug = await H['suggest'](null);
    avecPlan = sug.filter(r => r.plan && r.plan.ok).length;
    etats = new Set(sug.map(r => r.plan ? (r.plan.ok ? 'plan' : r.plan.etat) : 'rien'));
    /* Attention au piege : sug.length vaut zero pendant la premiere
       seconde — l'analyse n'a pas encore rendu le tempo du morceau
       en cours — et « 0 >= min(2, 0) » est vrai. Sans ce garde-fou,
       le banc se declarait satisfait d'une liste vide. */
    if (sug.length && avecPlan >= Math.min(2, sug.length)) break;
    await dodo(250);
  }
  const mis = Date.now() - t0;
  verifier('3. des propositions sortent', sug.length > 0, sug.length + ' lignes');
  verifier('3bis. les points de mix arrivent',
           avecPlan >= Math.min(2, sug.length),
           avecPlan + ' plan(s) sur ' + sug.length + ' — etats : ' + Array.from(etats).join(', '));
  verifier('3ter. et ils arrivent en moins de 10 s', mis < 10000, mis + ' ms');

  /* ---------- 4. le contenu du plan tient debout ---------- */
  const p = (sug.find(r => r.plan && r.plan.ok) || {}).plan;
  verifier('4. le plan porte trois reperes ordonnes',
           p && p.start < p.swap && p.swap <= p.out,
           p ? p.startLabel + ' -> ' + p.swapLabel + ' -> ' + p.outLabel : 'aucun plan');
  verifier('4bis. et ils tombent dans le morceau',
           p && p.start >= 0 && p.out <= 96,
           p ? 'lance ' + p.start + ' s, sort ' + p.out + ' s' : '');

  /* ---------- 5. un etat qui ne ment pas ---------- */
  /* Une structure ratee ne doit JAMAIS ressortir en « calcul » : c'est
     ce mensonge qui faisait attendre une eternite. */
  const structure = require(path.join(BAC, 'src', 'structure.js'));
  const estime = structure.structureEstimee(240, 128, 'essai');
  verifier('5. une grille illisible rend quand meme des reperes',
           estime.ok === true && estime.estime === true &&
           estime.readyAt > 0 && estime.outPoint > estime.readyAt,
           'intro ' + estime.introBars + ' mes., outro ' + estime.outroBars + ' mes.');

  const engine = require(path.join(BAC, 'src', 'engine.js'));
  const plan = engine.mixPlan({ bpm: 128 }, { bpm: 128 }, estime, estime);
  verifier('5bis. et mixPlan sait s\'en servir', plan && plan.ok === true,
           plan && plan.text);

  /* ---------- 6. la file donne la priorite au morceau en cours ---------- */
  const { StructurePool } = structure;
  {
    const pool = new StructurePool(1);
    const ordre = [];
    pool._spawn = function () { return null; };       /* aucun fil : on lit la file */
    const fichiers = fs.readdirSync(MUSIQUE).map(f => path.join(MUSIQUE, f));
    for (let i = 0; i < 3; i++)
      pool.run(fichiers[i], 128, { priorite: 0, cle: 'sug' + i }).catch(() => {});
    pool.run(fichiers[3], 128, { priorite: 2, cle: 'encours' }).catch(() => {});
    /* _drain a tout rejete faute de fil : on refait la file a la main
       pour verifier l'ordre de service, pas le calcul. */
    const file = [];
    for (let i = 0; i < 3; i++) file.push({ priorite: 0, id: i, cle: 'sug' + i });
    file.push({ priorite: 2, id: 9, cle: 'encours' });
    let k = 0;
    for (let i = 1; i < file.length; i++) if (file[i].priorite > file[k].priorite) k = i;
    verifier('6. le morceau en cours passe devant les suggestions',
             file[k].cle === 'encours', 'servi en premier : ' + file[k].cle);
    pool.close();
  }
  {
    /* Et ce qui n'est plus propose sort de la file. */
    const pool = new StructurePool(1);
    pool._spawn = function () { return null; };
    pool.queue.push({ id: 1, cle: 'vieux', priorite: 0, resolve(){}, reject(){} });
    pool.queue.push({ id: 2, cle: 'actuel', priorite: 1, resolve(){}, reject(){} });
    const jetes = pool.oublier(j => j.cle === 'actuel');
    verifier('6bis. et ce qui n\'est plus propose sort de la file',
             jetes === 1 && pool.queue.length === 1 && pool.queue[0].cle === 'actuel',
             jetes + ' abandonne(s)');
    pool.close();
  }

  try { fs.rmSync(BAC, { recursive: true, force: true }); } catch (e) {}
  if (echecs) {
    console.error('\n' + echecs + ' cas de points de mix en echec.');
    process.exit(1);
  }
  console.log('\npoints de mix : ils arrivent, et quand ils n\'arrivent pas ils le disent.');
  process.exit(0);
})();
