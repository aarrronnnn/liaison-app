'use strict';
/* ============================================================
   L'APP EMPAQUETEE TROUVE-T-ELLE SON FFMPEG ?

   Les bancs tournent depuis les sources : ffmpeg-static y est dans
   node_modules, et tout marche. Dans l'app livree, les fils
   d'analyse sont charges depuis app.asar.unpacked/src/ — et de la,
   require('ffmpeg-static') rend DEJA un chemin « app.asar.unpacked ».
   L'ancien .replace('app.asar', 'app.asar.unpacked') le changeait
   en « app.asar.unpacked.unpacked » : chemin mort, repli sur le
   ffmpeg du systeme — absent chez un client — et toute l'analyse
   (tempo, tonalite, energie, points de mix) tombait en panne.

   On reconstruit ici l'arborescence d'une app livree et on appelle
   ffmpegPath() depuis l'interieur, exactement comme un fil.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(62) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
console.log('empaquetage : ffmpeg dans l\'app livree\n');

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-asar-'));
const res = path.join(racine, 'Liaison.app', 'Contents', 'Resources');
const unpacked = path.join(res, 'app.asar.unpacked');
fs.mkdirSync(path.join(unpacked, 'src'), { recursive: true });
fs.mkdirSync(path.join(unpacked, 'node_modules', 'ffmpeg-static'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', 'src', 'analyze.js'), path.join(unpacked, 'src', 'analyze.js'));
fs.writeFileSync(path.join(unpacked, 'node_modules', 'ffmpeg-static', 'index.js'),
  "module.exports = require('path').join(__dirname, 'ffmpeg" + (process.platform === 'win32' ? '.exe' : '') + "');");

/* Un faux ffmpeg qui repond a -version, a l'endroit exact ou l'app
   livree range le vrai. */
const bin = path.join(unpacked, 'node_modules', 'ffmpeg-static', 'ffmpeg');
if (process.platform === 'win32') {
  fs.copyFileSync(process.execPath, bin + '.exe');            /* node repond a --version, pas -version */
} else {
  fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(bin, 0o755);
}

if (process.platform !== 'win32') {
  const code = "process.env.PATH='/nonexistent';" +
    "console.log(require(" + JSON.stringify(path.join(unpacked, 'src', 'analyze.js')) + ").ffmpegPath())";
  const vu = execFileSync(process.execPath, ['-e', code], { encoding: 'utf8' }).trim();
  /* macOS : /var/folders est un lien vers /private/var/folders, et
     require() rend le chemin reel. On compare donc les chemins reels. */
  const reel = p => { try { return fs.realpathSync(p); } catch (e) { return p; } };
  verifier('depuis app.asar.unpacked : le ffmpeg livre est trouve', reel(vu) === reel(bin), vu);
  verifier('jamais « app.asar.unpacked.unpacked »', !/unpacked\.unpacked/.test(vu), vu);
} else {
  console.log('  (banc Unix : sous Windows, le faux binaire ne repond pas a -version)');
}

/* Et le chemin vu depuis le fil principal (dans l'archive) reste juste. */
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'analyze.js'), 'utf8');
const re = /\.replace\(\/app\\\.asar\(\?!\\\.unpacked\)\/, 'app\.asar\.unpacked'\)/;
verifier('la reecriture ne touche que « app.asar » nu', re.test(src));
const deplie = p => p.replace(/app\.asar(?!\.unpacked)/, 'app.asar.unpacked');
verifier('app.asar/x → app.asar.unpacked/x', deplie('/R/app.asar/node_modules/f') === '/R/app.asar.unpacked/node_modules/f');
verifier('app.asar.unpacked/x reste tel quel', deplie('/R/app.asar.unpacked/node_modules/f') === '/R/app.asar.unpacked/node_modules/f');

/* Aucun ffmpeg / ffprobe lance sans windowsHide : sous Windows,
   chacun ouvrait une console noire qui pouvait prendre le clavier
   au logiciel de mix. */
for (const f of ['analyze.js', 'structure.js', 'library.js']) {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const appels = s.match(/\bspawn(Sync)?\([^;]*?\);/gs) || [];
  const nus = appels.filter(a => !/windowsHide:\s*true/.test(a));
  verifier(f + ' : chaque lancement cache sa console Windows', nus.length === 0, nus[0]);
}
for (const f of ['analyze.js', 'structure.js']) {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  verifier(f + ' : ffmpeg d\'analyse en priorite basse', /basse\(p\)/.test(s));
}

fs.rmSync(racine, { recursive: true, force: true });
console.log('\n' + (ko ? ko + ' RATE(S)' : 'empaquetage : l\'app livree trouve son ffmpeg, sans console, en priorite basse.'));
process.exit(ko ? 1 : 0);
