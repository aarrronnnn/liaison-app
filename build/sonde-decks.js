'use strict';
/* ============================================================
   La sonde des decks.

   « Quand je mets un titre et que je le lance en meme temps que
     l'autre son tourne, ca ne detecte pas le nouveau son. »

   Liaison ne peut pas demander a rekordbox ce qui tourne :
   Pioneer n'expose aucune interface, ils l'ont confirme sur leur
   propre forum. Liaison regarde donc les FICHIERS que rekordbox
   tient ouverts, et devine.

   Aujourd'hui elle ne regarde qu'une chose : la liste des noms.
   Deux fichiers ouverts, et c'est l'ordre d'apparition qui
   tranche. Si le morceau etait DEJA ouvert — survole dans le
   navigateur, ecoute en preecoute, charge puis recharge — son
   rang d'arrivee est ancien, et il ne peut plus jamais gagner.

   Or lsof sait dire deux choses de plus, qu'on jette :

     — combien de descripteurs pointent le meme fichier. Un
       morceau charge sur un deck n'en a peut-etre pas le meme
       nombre qu'un morceau survole ;
     — la POSITION DE LECTURE de chacun. Un deck qui joue avance
       dans le fichier. Un deck a l'arret, non.

   Si la position avance, on tient un signal direct — « celui-la
   joue » — mille fois plus sur que l'ordre d'arrivee.

   Cette sonde ne modifie rien et ne lit aucun contenu : elle
   note, chaque seconde pendant quarante secondes, quels fichiers
   audio rekordbox tient ouverts, avec leur nombre de
   descripteurs et leur position.

   MARCHE A SUIVRE
     1. rekordbox ouvert, un morceau qui tourne sur le deck A.
     2. Lance :  node build/sonde-decks.js
     3. Pendant qu'elle tourne, charge un morceau sur le deck B
        et lance-le, comme en soiree.
     4. Colle la sortie.
   ============================================================ */
const { execFile } = require('child_process');
const path = require('path');

const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|aac|ogg|wma)$/i;
const SECONDES = 40;

if (process.platform === 'win32') {
  console.log('Cette sonde utilise lsof : elle ne fonctionne que sur macOS.');
  process.exit(0);
}

function run(cmd, args) {
  return new Promise(r => {
    execFile(cmd, args, { timeout: 4000, maxBuffer: 8 * 1024 * 1024 },
             (e, out) => r(String(out || '')));
  });
}

/* -Fnfo : un champ par ligne — f = descripteur, n = nom, o = position.
   C'est le meme appel que fait l'app, avec deux champs de plus. */
async function releve() {
  const bruts = (await run('pgrep', ['-i', '-f', 'rekordbox']))
    .split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s));
  if (!bruts.length) return null;
  /* Le nom du programme, pas sa ligne de commande : sinon le shell
     qui a ecrit ce fichier passe lui-meme pour rekordbox. */
  const ps = [];
  for (const ligne of (await run('ps', ['-o', 'pid=,comm=', '-p', bruts.join(',')])).split('\n')) {
    const m = ligne.trim().match(/^(\d+)\s+(.*)$/);
    if (m && /rekordbox/i.test(m[2])) ps.push(m[1]);
  }
  if (!ps.length) return null;
  ps.length = Math.min(ps.length, 4);
  const par = new Map();                 /* chemin -> { n, positions:[] } */
  for (const pid of ps) {
    const out = await run('lsof', ['-p', pid, '-Fnfo']);
    let pos = null;
    for (const ligne of out.split('\n')) {
      const c = ligne[0], v = ligne.slice(1);
      if (c === 'o') pos = v;
      else if (c === 'f') pos = null;
      else if (c === 'n') {
        if (!AUDIO.test(v)) { pos = null; continue; }
        if (!par.has(v)) par.set(v, { n: 0, positions: [] });
        const e = par.get(v);
        e.n++;
        if (pos != null) e.positions.push(pos);
        pos = null;
      }
    }
  }
  return par;
}

const court = p => path.basename(p).slice(0, 44);
let precedent = new Map();

(async () => {
  const premier = await releve();
  if (premier === null) {
    console.log('rekordbox n\'est pas lance — ouvre-le puis relance la sonde.');
    process.exit(0);
  }
  console.log('rekordbox detecte. %d fichier(s) audio ouvert(s) au depart.', premier.size);
  console.log('Charge et lance un morceau sur le second deck maintenant.');
  console.log('Chaque ligne : [+] nouveau  [~] position changee  [-] referme\n');
  precedent = premier;
  for (const [p, e] of premier)
    console.log('  %s  ouvert deja   %d descripteur(s)  position %s',
                court(p).padEnd(46), e.n, (e.positions[0] || '?'));
  console.log();

  for (let s = 1; s <= SECONDES; s++) {
    await new Promise(r => setTimeout(r, 1000));
    const m = await releve();
    if (m === null) { console.log('%ds  rekordbox a disparu', s); continue; }
    const lignes = [];
    for (const [p, e] of m) {
      const av = precedent.get(p);
      const posA = (av && av.positions.join(',')) || '';
      const posB = e.positions.join(',');
      if (!av) lignes.push(['+', p, e.n + ' desc.  position ' + (posB || '?')]);
      else if (posA !== posB) lignes.push(['~', p, 'position ' + posA + ' -> ' + posB]);
      else if (av.n !== e.n) lignes.push(['~', p, av.n + ' -> ' + e.n + ' descripteur(s)']);
    }
    for (const [p] of precedent) if (!m.has(p)) lignes.push(['-', p, 'referme']);
    for (const [signe, p, quoi] of lignes)
      console.log('%ss  %s %s  %s', String(s).padStart(2), signe, court(p).padEnd(46), quoi);
    precedent = m;
  }

  console.log('\n--- fin ---');
  console.log('%d fichier(s) audio ouvert(s) a la fin.', precedent.size);
  let bougent = 0;
  for (const [, e] of precedent) if (e.positions.some(x => x && x !== '0t0' && x !== '0x0')) bougent++;
  console.log('%d ont une position de lecture non nulle.', bougent);
  console.log('\nColle tout ce qui precede dans la conversation.');
})();
