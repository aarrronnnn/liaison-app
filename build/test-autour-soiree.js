'use strict';
/* ============================================================
   AUTOUR DE LA SOIREE (1.9).
   La note de sante et ce que chaque geste promet : un « +6 pts »
   affiche doit etre tenu une fois le defaut corrige.
   ============================================================ */
const health = require('../src/health');
let ko = 0;
const dire = (q, ok, d) => { console.log('  ' + (ok ? 'ok   ' : 'RATE ') + q + (ok || d == null ? '' : '  — ' + d)); if (!ok) ko++; };
console.log('autour de la soiree\n');

const lib = [];
for (let i = 0; i < 1000; i++) lib.push({ id: i, title: 'T' + i, artist: 'A' + (i % 50), bpm: i < 120 ? 0 : 120, key: i < 300 ? '' : '8A', path: '', duration: 200 + i });
const b = health.bilan(lib, {});
const gBpm = (b.actions.find(a => a.cle === 'bpm') || {}).gain;
const gKey = (b.actions.find(a => a.cle === 'key') || {}).gain;
dire('chaque point porte son gain', b.actions.every(a => typeof a.gain === 'number' && a.gain >= 0), JSON.stringify(b.actions.map(a => a.gain)));
dire('le gain BPM suit le poids du calcul (120/1000 × 45 ≈ 5)', gBpm === 5, gBpm);
dire('le gain tonalite suit le poids du calcul (300/1000 × 20 = 6)', gKey === 6, gKey);
/* la promesse tenue : on corrige, la note monte d'autant (a l'arrondi pres) */
const repare = lib.map(t => Object.assign({}, t, { bpm: 120 }));
const b2 = health.bilan(repare, {});
dire('corriger les BPM rapporte le gain annonce (±1)', Math.abs((b2.score - b.score) - gBpm) <= 1, (b2.score - b.score) + ' vs ' + gBpm);
dire('bibliotheque vide : pas de gain invente', !health.bilan([], {}).actions);

console.log('\n' + (ko ? ko + ' echec(s).' : 'autour de la soiree : tout tient.'));
process.exit(ko ? 1 : 0);
