'use strict';
/* ============================================================
   LES FICHES DE SOIREE (1.8).
   Ce qui relie une fiche a ce qui s'y joue : les listes qui font
   l'aller-retour sans se deformer, les sets qui portent la fiche,
   et la serie de semaines qui ne ment pas.
   ============================================================ */
const fs = require('fs'), os = require('os'), path = require('path');
const { Soirees, enLigne, serie, lundiDe } = require('../src/soirees');
const { SetLog } = require('../src/session');
const { splitPair } = require('../src/clientlist');
let ko = 0;
const dire = (q, ok, d) => { console.log('  ' + (ok ? 'ok   ' : 'RATE ') + q + (ok || d == null ? '' : '  — ' + d)); if (!ok) ko++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-fiches-'));

console.log('fiches de soiree\n');
const S = new Soirees(path.join(dir, 'soirees.json'));
const f = S.creer({ nom: 'Mariage Léa & Sam', voulus: ['Daft Punk - Get Lucky', 'Sweet Dreams - Radio Edit', 'Juste un titre'], interdits: ['Rick Astley - Never Gonna Give You Up'] });
const r = S.reglages(f.id);
dire('une fiche activee coupe « Artiste - Titre » comme Le client', r.clientWanted[0].artist === 'Daft Punk' && r.clientWanted[0].title === 'Get Lucky', JSON.stringify(r.clientWanted[0]));
dire('un titre sans artiste reste un titre', r.clientWanted[2].artist === '' && r.clientWanted[2].title === 'Juste un titre');
dire('les refus aussi', r.clientBanned[0].artist === 'Rick Astley');
const retour = r.clientWanted.map(enLigne);
dire('aller-retour fiche → client → fiche sans deformation', JSON.stringify(retour) === JSON.stringify(f.voulus), JSON.stringify(retour));
dire('enLigne tolere le vide', enLigne(null) === '' && enLigne({ title: 'X' }) === 'X');
dire('splitPair ne coupe pas un titre a tiret colle', splitPair('A-ha - Take On Me').artist === 'A-ha');

/* ---------- la serie ---------- */
const J = 86400e3;
const maintenant = new Date(2026, 8, 27, 15).getTime();     /* dimanche 27 septembre 2026 */
const sam = k => new Date(2026, 8, 26 - 7 * k, 23).getTime();
dire('aucune soiree : serie nulle', serie([], maintenant) === 0);
dire('trois samedis de suite : 3', serie([sam(0), sam(1), sam(2)], maintenant) === 3, serie([sam(0), sam(1), sam(2)], maintenant));
dire('deux soirees la meme semaine comptent une fois', serie([sam(0), sam(0) - J, sam(1)], maintenant) === 2);
dire('un trou casse la serie', serie([sam(0), sam(2), sam(3)], maintenant) === 1);
const mardi = new Date(2026, 8, 29, 12).getTime();
dire('la semaine en cours ne casse pas la serie le mardi', serie([sam(0), sam(1)], mardi) === 2, serie([sam(0), sam(1)], mardi));
dire('au-dela, elle est cassee', serie([sam(1), sam(2)], mardi) === 0);
dire('un lundi est un lundi', new Date(lundiDe(maintenant)).getDay() === 1);
dire('les dates ISO passent aussi', serie([new Date(sam(0)).toISOString()], maintenant) === 1);

/* ---------- les sets portent la fiche ---------- */
const L = new SetLog(path.join(dir, 'sets.json'));
L.open('Mariage', 'fr-mariage', f.id);
dire('un set ouvert porte la fiche armee', L.list()[0].soiree === f.id);
const L2 = new SetLog(path.join(dir, 'sets2.json'));
L2.nommer = () => ({ name: 'Mariage Léa & Sam', pack: 'fr-mariage', soiree: f.id });
L2.play({ id: 1, title: 'Get Lucky', artist: 'Daft Punk', bpm: 116 });
dire('un set ouvert tout seul prend le nom de la soiree en cours', L2.list()[0].name === 'Mariage Léa & Sam', L2.list()[0].name);
dire('… et sa fiche', L2.list()[0].soiree === f.id);
const L3 = new SetLog(path.join(dir, 'sets3.json'));
L3.play({ id: 1, title: 'x', artist: 'y' });
dire('sans nommer, rien ne change (« Session »)', L3.list()[0].name === 'Session' && L3.list()[0].soiree === null);
const L4 = new SetLog(path.join(dir, 'sets4.json'));
L4.nommer = () => { throw new Error('boom'); };
let ok4 = true; try { L4.play({ id: 1, title: 'x', artist: 'y' }); } catch (e) { ok4 = false; }
dire('un nommer qui jette ne casse pas la tracklist', ok4 && L4.list()[0].name === 'Session');

try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
console.log('\n' + (ko ? ko + ' echec(s).' : 'fiches de soiree : tout tient.'));
process.exit(ko ? 1 : 0);
