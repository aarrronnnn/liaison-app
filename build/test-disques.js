'use strict';
/* ============================================================
   Banc — la bibliotheque sur un disque externe.

   « Quand les DJ jouent un son qui vient de leur bibliotheque
     rekordbox ou Serato, Liaison ne capte meme pas le son — alors
     que quand ils jouent un son qui vient de leur bibliotheque
     iTunes, aucun probleme. »

   Le symptome disait « detection ». La cause etait qu'on ne
   cherchait les bases QUE sous le dossier personnel, alors qu'un
   DJ mobile range sa musique sur le SSD qu'il emporte. Serato pose
   son dossier « _Serato_ » a la racine de CHAQUE disque qui porte
   des morceaux ; celui du SSD est le vrai, celui du disque interne
   est souvent vide.

   Liaison retombait donc sur iTunes — qui, lui, vit bien dans le
   dossier personnel — et le DJ voyait exactement ce qu'il a decrit.

   Ce banc fabrique un faux disque et verifie que chaque source y
   est trouvee. Il verifie aussi la moitie qu'aucun chemin ne
   pourra jamais couvrir : quand un logiciel tourne et qu'on n'a
   pas sa bibliotheque, on le DIT.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(58),
              detail ? '  — ' + detail : '');
}

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-ssd-'));
const SSD = path.join(BAC, 'SSD-DU-DJ');

function poser(rel, contenu) {
  const f = path.join(SSD, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu || 'x');
  return f;
}

/* Un disque de DJ mobile, tel qu'on le trouve vraiment. */
poser('_Serato_/database V2');
poser('Native Instruments/Traktor 4.0.0/collection.nml', '<NML></NML>');
poser('VirtualDJ/database.xml', '<VirtualDJ_Database></VirtualDJ_Database>');
poser('Music/collection.xml',
      '<?xml version="1.0"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION></COLLECTION></DJ_PLAYLISTS>');

process.env.LIAISON_VOLUMES = SSD;
const autolib = require('../src/autolibrary.js');

const vols = autolib.externalVolumes();
verifier('0. le disque est vu comme un volume',
         vols.indexOf(SSD) >= 0, vols.join(', ') || 'aucun');

const trouves = autolib.detect();
const parKind = k => trouves.filter(s => s.kind === k).map(s => s.path);

verifier('1. la base Serato du SSD est trouvee',
         parKind('serato').some(p => p.indexOf(SSD) === 0),
         parKind('serato').join(' | ') || 'rien');
verifier('2. la collection Traktor du SSD est trouvee',
         parKind('traktor').some(p => p.indexOf(SSD) === 0),
         parKind('traktor').join(' | ') || 'rien');
verifier('3. la base VirtualDJ du SSD est trouvee',
         parKind('virtualdj').some(p => p.indexOf(SSD) === 0),
         parKind('virtualdj').join(' | ') || 'rien');
verifier('4. l\'export rekordbox du SSD est trouve',
         parKind('rekordbox').some(p => p.indexOf(SSD) === 0),
         parKind('rekordbox').join(' | ') || 'rien');

/* ------------------------------------------------------------
   Le temoin : sans le disque, on ne trouve rien de tout ca.
   Sans lui, ce banc passerait meme si la correction etait annulee
   — parce que la machine d'essai pourrait avoir ses propres bases.
   ------------------------------------------------------------ */
{
  delete process.env.LIAISON_VOLUMES;
  const sansDisque = autolib.detect().filter(s => String(s.path).indexOf(SSD) === 0);
  verifier('5. TEMOIN : sans le disque, plus rien de ce disque',
           sansDisque.length === 0, sansDisque.length + ' source(s) fantomes');
  process.env.LIAISON_VOLUMES = SSD;
}

/* ------------------------------------------------------------
   Et la moitie qu'aucun chemin ne couvrira jamais.
   ------------------------------------------------------------ */
{
  const c = autolib.conseils([{ kind: 'itunes', path: '/x.xml' }],
                             { tournent: ['serato'] });
  const s = c.find(x => x.cle === 'base-introuvable-serato');
  verifier('6. Serato tourne sans bibliotheque : on le dit',
           !!s, s ? s.titre : 'aucun conseil');
  verifier('6bis. et le conseil explique le symptome exact',
           !!s && /reconnu quand tu le joues/.test(s.texte));

  /* On ne crie pas pour un logiciel dont on A la bibliotheque. */
  const muet = autolib.conseils([{ kind: 'serato', path: '/ok' }], { tournent: ['serato'] });
  verifier('6ter. et on se tait quand la bibliotheque est la',
           !muet.some(x => x.cle === 'base-introuvable-serato'));
}

try { fs.rmSync(BAC, { recursive: true, force: true }); } catch (e) {}
if (echecs) {
  console.error('\n' + echecs + ' cas de disque externe en echec.');
  process.exit(1);
}
console.log('\ndisques : la bibliotheque est cherchee la ou les DJ la rangent vraiment.');
