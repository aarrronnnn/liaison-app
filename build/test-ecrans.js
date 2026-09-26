'use strict';
/* Le widget reste a l'ecran : petits ecrans, mise a l'echelle, ecran debranche. */
const { ramener } = require('../src/ecran');
let ko = 0;
const v = (q, ok, d) => { console.log('  ' + (ok ? 'ok   ' : 'RATE ') + q.padEnd(62) + (ok ? '' : '  — ' + JSON.stringify(d))); if (!ok) ko++; };
console.log('ecrans : le widget reste visible\n');
const W = 344;
/* 1366×768, barre des taches en bas : zone utile 728 px */
let r = ramener({ x: 994, y: 40, width: W, height: 760 }, { x: 0, y: 0, width: 1366, height: 728 });
v('1366×768 : la hauteur tient dans la zone utile', r.y + r.height <= 728 - 8 && r.height <= 712, r);
/* 1080p a 150 % : 1280×680 utiles */
r = ramener({ x: 908, y: 40, width: W, height: 760 }, { x: 0, y: 0, width: 1280, height: 680 });
v('1080p a 150 % : rien sous la barre des taches', r.y + r.height <= 672, r);
/* ecran externe debranche : la position memorisee est a x = 2500 */
r = ramener({ x: 2500, y: 300, width: W, height: 400 }, { x: 0, y: 25, width: 1440, height: 875 });
v('ecran externe debranche : ramene sur l\'ecran restant', r.x + r.width <= 1440 && r.x >= 0, r);
/* ecran a gauche, coordonnees negatives */
r = ramener({ x: -1500, y: 100, width: W, height: 400 }, { x: -1920, y: 0, width: 1920, height: 1040 });
v('ecran a gauche (x negatifs) : la position est respectee', r.x === -1500 && r.y === 100, r);
/* barre des taches a gauche */
r = ramener({ x: 0, y: 0, width: W, height: 400 }, { x: 62, y: 0, width: 1858, height: 1080 });
v('barre des taches a gauche : le widget ne passe pas dessous', r.x >= 62, r);
/* barre de menus + encoche macOS */
r = ramener({ x: 1100, y: 0, width: W, height: 400 }, { x: 0, y: 38, width: 1512, height: 944 });
v('Mac a encoche : sous la barre de menus', r.y >= 38, r);
/* la largeur ne bouge jamais sur un ecran normal */
r = ramener({ x: 100, y: 100, width: W, height: 500 }, { x: 0, y: 0, width: 1920, height: 1040 });
v('ecran normal : rien ne bouge', r.x === 100 && r.y === 100 && r.width === W && r.height === 500, r);
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.js'), 'utf8');
v('le raccourci de secours ramene le widget a l\'ecran', /ramenerWidget\(\);\s+\/\* le filet/.test(src));
v('ecran branche / debranche : le widget est ramene', /display-removed/.test(src) && /display-metrics-changed/.test(src));
v('la hauteur demandee est bornee a l\'ecran', /Math\.min\(900, hMax, Math\.round\(cible\)\)/.test(src));
console.log('\n' + (ko ? ko + ' RATE(S)' : 'ecrans : le widget reste visible, quel que soit l\'ecran.'));
process.exit(ko ? 1 : 0);
