'use strict';
/* ============================================================
   Le test de demarrage.

   Il repond a la question la plus couteuse : « est-ce que l'app
   s'ouvre ? ». Une dependance manquante ou une exception dans le
   chargement de main.js donne une fenetre qui ne s'affiche jamais,
   et un testeur qui abandonne sans pouvoir rien raconter.

   On remplace Electron par un faux juste assez complet pour que
   main.js aille au bout de son chargement, puis on APPELLE les
   gestionnaires que l'interface declenche dans sa premiere
   seconde. Ce n'est pas un test d'interface — c'est le controle
   qu'aucun de ces chemins ne jette.

       node build/demarrage.js

   A lancer avant chaque publication.
   ============================================================ */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const BAC = path.join(os.tmpdir(), 'liaison-demarrage-' + process.pid);

function preparer() {
  fs.mkdirSync(path.join(BAC, 'node_modules'), { recursive: true });
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

const APPELS = ['config:get', 'analysis:state', 'gout:etat', 'library:sources', 'library:scanInfo',
  'apps:running', 'filters:get', 'filters:crates', 'now:get', 'suggest', 'rescue', 'client:get',
  'landing:get', 'sets:list', 'license:status', 'icon:data', 'structure:get'];

(async () => {
  preparer();
  let el, t0 = Date.now();
  try {
    el = require(path.join(BAC, 'node_modules', 'electron'));
    require(path.join(BAC, 'src', 'main.js'));
  } catch (e) {
    console.log('L\'APPLICATION NE DEMARRE PAS :');
    console.log('  ' + e.message);
    console.log(String(e.stack).split('\n').slice(1, 4).map(s => '  ' + s.trim()).join('\n'));
    process.exit(1);
  }
  console.log('main.js charge en ' + (Date.now() - t0) + ' ms.');

  const h = el.__handlers || {};
  console.log(Object.keys(h).length + ' gestionnaires enregistres.');
  let ko = 0;
  for (const c of APPELS) {
    if (!h[c]) { console.log('  ABSENT  ' + c); ko++; continue; }
    try { await h[c]({}); } catch (e) { console.log('  ERREUR  ' + c + ' : ' + e.message); ko++; }
  }
  try { fs.rmSync(BAC, { recursive: true, force: true }); } catch (e) {}
  if (ko) { console.log('\n' + ko + ' chemin(s) de demarrage en echec.'); process.exit(1); }
  console.log(APPELS.length + ' chemins de demarrage repondent sans erreur.');
})();
