'use strict';
/* ============================================================
   BILAN DE SANTE 1.5.2 — la soiree, le serveur des invites et la
   detection du logiciel de mix.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SetLog, GuestServer } = require('../src/session.js');
const { detectFrom } = require('../src/watcher.js');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(64) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-soiree-'));
console.log('bilan de sante : soiree, invites, detection\n');

/* ---------- 1. une soiree se referme d'elle-meme ---------- */
{
  const log = new SetLog(path.join(tmp, 'sets.json'));
  const T = id => ({ id: id, title: 'T' + id, artist: 'A', bpm: 124, key: '8A' });
  log.play(T(1));
  const samedi = log.current.id;
  log.current.played[0].at = Date.now() - 5 * 86400000;   /* joue il y a cinq jours */
  verifier('app restee ouverte 5 jours : la soiree de samedi est perimee', log.fermerSiPerimee() === true);
  verifier('plus de soiree en cours (mise a jour de nouveau proposee)', log.current === null);
  log.play(T(2));
  verifier('le morceau suivant ouvre une NOUVELLE soiree', log.current && log.current.id !== samedi);

  log.current.played[0].at = Date.now() - 30 * 60000;
  verifier('une pause de 30 min ne coupe pas la soiree', log.fermerSiPerimee() === false && !!log.current);

  const avant = log.current.id;
  log.current.played[log.current.played.length - 1].at = Date.now() - 6 * 3600000;
  log.play(T(3));
  verifier('six heures sans morceau puis un titre : nouvelle soiree', log.current.id !== avant);
  verifier('« deja passe ce soir » ne voit plus la veille', log.current.played.length === 1);
  log.vider();
}

/* ---------- 2. X-Forwarded-For ne fabrique pas de telephones ---------- */
{
  const g = new GuestServer();
  const req = xff => ({ headers: { 'x-forwarded-for': xff }, socket: { remoteAddress: '192.168.1.23' } });
  verifier('l\'adresse vient du socket, pas d\'un en-tete ecrit par le client',
           g._adresse(req('1.2.3.4')) === '192.168.1.23' && g._adresse(req('5.6.7.8')) === '192.168.1.23');
  let passe = 0;
  for (let i = 0; i < 20; i++) if (g._peutChercher(req('10.0.0.' + i))) passe++;
  verifier('20 recherches en rafale, en-tete change a chaque fois : 3 passent', passe === 3, passe);
}

/* ---------- 3. rekordboxAgent n'est pas rekordbox ---------- */
{
  const ids = l => detectFrom(l).map(a => a.id).join(',');
  verifier('macOS : rekordboxAgent seul → rien d\'ouvert',
           ids(['/Applications/rekordboxAgent.app/Contents/MacOS/rekordboxAgent']) === '');
  verifier('macOS : rekordbox → rekordbox',
           ids(['/Applications/rekordbox 7/rekordbox.app/Contents/MacOS/rekordbox']) === 'rekordbox');
  verifier('Windows : rekordboxAgent.exe seul → rien',
           ids(['"rekordboxAgent.exe","812","Console","1","9 000 K"']) === '');
  verifier('Windows : rekordbox.exe → rekordbox',
           ids(['"rekordbox.exe","4120","Console","1","512 000 K"']) === 'rekordbox');
  verifier('Serato DJ Pro, Traktor, Engine DJ, djay : reconnus',
           ids(['/Applications/Serato DJ Pro.app/Contents/MacOS/Serato DJ Pro',
                '/Applications/Native Instruments/Traktor Pro 3/Traktor.app/Contents/MacOS/Traktor',
                '/Applications/Engine DJ.app/Contents/MacOS/Engine DJ',
                '/Applications/djay Pro AI.app/Contents/MacOS/djay Pro AI']) === 'serato,traktor,enginedj,djay');
}

/* ---------- 4. la page des invites s'execute vraiment ---------- */
{
  /* 1.5.1 servait une page dont le script ne se lancait pas : une
     apostrophe echappee (\') dans un gabarit `...` perdait son
     antislash, et « l'a pas » refermait la chaine. Recherche et
     demandes mortes sur tous les telephones. On compile ici chaque
     script de la page, dans les deux langues. */
  const vm = require('vm');
  const genere = require('../src/session.js').guestPage;
  verifier('la page des invites existe', typeof genere === 'function');
  for (const langue of ['fr', 'en']) {
    const html = genere('Soirée d\'essai', 'jeton', { cooldown: 90, maxPerDevice: 5, langue });
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x => x[1]);
    let err = null;
    for (const s of scripts) { try { new vm.Script(s); } catch (e) { err = e.message; } }
    verifier('page des invites (' + langue + ') : chaque script compile', scripts.length > 0 && !err, err);
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (ko ? ko + ' RATE(S)' : 'soiree : elle se referme, les invites sont comptes, rekordbox est le bon.'));
process.exit(ko ? 1 : 0);
