'use strict';
/* ============================================================
   Le morceau qui tourne DOIT s'afficher.

   « J'ai des sons qui, quand je les passe, ne sont pas du tout
     reconnus : rien ne s'affiche alors qu'ils tournent. »

   Trois chemins menaient au silence, et ce banc les couvre tous
   les trois :

     1. un fichier ouvert par rekordbox dont le chemin n'est pas
        dans la bibliotheque ;
     2. un texte annonce par Serato / Traktor / VirtualDJ qui ne
        se rapproche d'aucun morceau au seuil normal ;
     3. un morceau hors bibliotheque pose comme morceau en cours :
        le moteur doit continuer a proposer.

   Aucun Electron ici : on teste les modules, pas la fenetre.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const exterieur = require('../src/exterieur');
const engine = require('../src/engine');
const libmod = require('../src/library');
const { AnalysisService } = require('../src/analysis');

let dur = 0, ok = 0;
const G = '\x1b[32m', R = '\x1b[31m', F = '\x1b[0m';
function verifier(nom, condition, detail) {
  dur++;
  if (condition) { ok++; console.log('  ' + G + 'ok' + F + '   ' + nom + (detail ? '   - ' + detail : '')); }
  else { console.log('  ' + R + 'ECHEC' + F + ' ' + nom + (detail ? '   - ' + detail : '')); process.exitCode = 1; }
}

/* ---------- une bibliotheque de reference ---------- */
function biblio() {
  const brut = [
    { path: '/M/daft punk - one more time.mp3', title: 'One More Time', artist: 'Daft Punk', genre: 'French Touch', bpm: 123, key: '8A', year: 2000 },
    { path: '/M/boney m - daddy cool.mp3', title: 'Daddy Cool', artist: 'Boney M.', genre: 'Disco', bpm: 126, key: '9A', year: 1976 },
    { path: '/M/village people - ymca.mp3', title: 'Y.M.C.A.', artist: 'Village People', genre: 'Disco', bpm: 127, key: '9B', year: 1978 },
    { path: '/M/abba - dancing queen.mp3', title: 'Dancing Queen', artist: 'ABBA', genre: 'Disco', bpm: 101, key: '5B', year: 1976 },
    { path: '/M/patrick sebastien - les sardines.mp3', title: 'Les Sardines', artist: 'Patrick Sebastien', genre: 'Variete', bpm: 128, key: '8B', year: 1996 },
    { path: '/M/charles aznavour - la boheme.mp3', title: 'La Boheme', artist: 'Charles Aznavour', genre: 'Chanson', bpm: 76, key: '8B', year: 1965 },
    { path: '/M/stromae - alors on danse.mp3', title: 'Alors on danse', artist: 'Stromae', genre: 'Electro', bpm: 120, key: '6A', year: 2009 },
    { path: '/M/dua lipa - levitating.mp3', title: 'Levitating', artist: 'Dua Lipa', genre: 'Pop', bpm: 103, key: '11B', year: 2020 }
  ];
  return libmod.finalize(brut.map(t => Object.assign({ duration: 210, pop: 60 }, t)));
}

/* ---------- un vrai fichier audio tague, ecrit par ffmpeg ---------- */
function fichierTague(dossier, nom, tags) {
  const f = path.join(dossier, nom);
  const args = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=3', '-ac', '1'];
  for (const k of Object.keys(tags)) args.push('-metadata', k + '=' + tags[k]);
  args.push(f);
  const r = spawnSync(require('../src/analyze').ffmpegPath(), args);
  return r.status === 0 && fs.existsSync(f) ? f : null;
}

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-detect-'));

(async () => {
  console.log('\n- Le morceau qui tourne doit s\'afficher -\n');
  const library = biblio();

  /* ------------------------------------------------------------
     1. LE TEXTE ABIME QUI DESIGNE POURTANT UN MORCEAU CONNU.

     Les logiciels annoncent ce qu'ils ont sous la main, et ce n'est
     pas toujours propre. Au seuil normal de 0,58, ces textes-la ne
     se rapprochaient de rien et le widget se taisait.
     ------------------------------------------------------------ */
  const abimes = [
    ['03_daft_punk_one_more_time_remaster', 'One More Time'],
    ['Boney M. - Daddy Cool (12\'\' Disco Mix)', 'Daddy Cool'],
    ['VILLAGE PEOPLE-YMCA-1978', 'Y.M.C.A.'],
    ['Compilation Disco 1978 - Y.M.C.A.', 'Y.M.C.A.'],
    ['Stromae Alors On Danse Radio Edit', 'Alors on danse']
  ];
  for (const [texte, attendu] of abimes) {
    const direct = engine.match(texte, library);
    verifier('1. « ' + texte.slice(0, 34) + ' » retrouve son morceau',
      !!direct && direct.track.title === attendu,
      direct ? direct.track.title + '  (note ' + direct.score.toFixed(2) + ')' : 'aucun');
  }

  /* ------------------------------------------------------------
     LE GARDE-FOU DE L'ARTISTE.

     Temoin mesure : sur cette bibliotheque, « Queen - Dancing in
     the Street » se rapprochait de « Dancing Queen » d'ABBA avec
     0,63 — au-dessus du seuil. Le widget affichait donc le mauvais
     morceau, et toutes les propositions partaient d'une base
     fausse. Reconnaitre a tort est pire que ne pas reconnaitre :
     l'un se voit, l'autre pas.
     ------------------------------------------------------------ */
  const faux = engine.match('Queen - Dancing in the Street', library);
  verifier('1bis. un artiste qui ne colle pas empeche le faux rapprochement',
    faux === null,
    faux ? 'a repondu ' + faux.track.artist + ' / ' + faux.track.title +
           ' (' + faux.score.toFixed(2) + ')' : 'aucun, comme il faut');
  verifier('1ter. mais le bon artiste passe toujours',
    !!engine.match('ABBA - Dancing Queen [Remastered 2010]', library),
    'Dancing Queen reconnu');
  verifier('1quater. un texte qui ne designe personne ne designe personne',
    !engine.match('disco', library));

  /* ------------------------------------------------------------
     2. LE TEXTE VRAIMENT INCONNU DEVIENT QUAND MEME UN MORCEAU.
     ------------------------------------------------------------ */
  const pris = new Set(library.map(t => t.id));
  const parTexte = exterieur.depuisTexte('Soprano - Cosmo', pris);
  verifier('2. un titre inconnu donne quand meme un morceau affichable',
    !!parTexte && parTexte.title === 'Cosmo' && parTexte.artist === 'Soprano',
    parTexte ? parTexte.artist + ' / ' + parTexte.title : 'rien');
  verifier('2bis. son identifiant ne percute aucun morceau de la bibliotheque',
    !!parTexte && !pris.has(parTexte.id), 'id ' + (parTexte && parTexte.id));
  verifier('2ter. et il est marque comme hors bibliotheque',
    !!parTexte && parTexte.horsBiblio === true && parTexte.sansFichier === true);

  /* Le piege des noms composes : un tiret sans espaces n'est pas un
     separateur. Sans cette regle, « Jean-Jacques Goldman » devient
     « Jean » qui joue « Jacques Goldman ». */
  const compose = exterieur.couper('Jean-Jacques Goldman - Je te donne');
  verifier('2quater. un nom compose n\'est pas coupe en deux',
    compose.artist === 'Jean-Jacques Goldman' && compose.title === 'Je te donne',
    compose.artist + ' / ' + compose.title);

  /* ------------------------------------------------------------
     3. LE FICHIER OUVERT PAR REKORDBOX, ABSENT DE LA BIBLIOTHEQUE.

     C'est le cas le plus facile de tous et c'etait le plus mal
     traite : resoudre() rendait null, et null ne declenchait rien.
     ------------------------------------------------------------ */
  const f = fichierTague(dossier, 'inconnu.mp3',
    { title: 'Mauvais Djo', artist: 'Riton la Manivelle', genre: 'Variete', TBPM: '112' });
  if (!f) {
    verifier('3. (ffmpeg indisponible : cas du fichier non teste)', true, 'ignore');
  } else {
    const t = await exterieur.depuisFichier(f, pris);
    verifier('3. un fichier hors bibliotheque devient un morceau complet',
      !!t && t.title === 'Mauvais Djo' && t.artist === 'Riton la Manivelle',
      t ? t.artist + ' / ' + t.title + '  tempo ' + t.bpm + '  genre ' + t.genre : 'rien');
    verifier('3bis. il garde son chemin, donc il pourra etre analyse',
      !!t && t.path === f && !t.sansFichier);

    /* Sans le moindre tag, le nom du fichier suffit encore. */
    const nu = fichierTague(dossier, 'Laurent Garnier - Crispy Bacon.mp3', {});
    const t2 = nu ? await exterieur.depuisFichier(nu, pris) : null;
    verifier('3ter. sans aucun tag, le nom du fichier fait l\'affaire',
      !!t2 && t2.artist === 'Laurent Garnier' && t2.title === 'Crispy Bacon',
      t2 ? t2.artist + ' / ' + t2.title : 'rien');

    /* Et l'analyse doit l'accepter alors qu'il n'est pas dans la
       bibliotheque : c'est tout l'objet de ajouter(). */
    const service = new AnalysisService(path.join(dossier, 'cache.json'), {});
    service.charger(library);
    const avant = service.enAttente(t.id);
    service.ajouter(t, 2);
    verifier('3quater. l\'analyse accepte un morceau hors bibliotheque',
      !avant && service.enAttente(t.id) === true,
      'avant ' + avant + ', apres ' + service.enAttente(t.id));
    verifier('3quinquies. et il passe devant tout le monde',
      service.file.get(t.id) && service.file.get(t.id).priorite === 2,
      'priorite ' + (service.file.get(t.id) || {}).priorite);
    service.stop();
  }

  /* ------------------------------------------------------------
     4. LE MOTEUR CONTINUE DE PROPOSER SUR UN MORCEAU QU'IL NE
        CONNAIT PAS.

     C'est la garantie qui compte pour le DJ : peu importe d'ou
     vient le morceau en cours, la liste doit se remplir.
     ------------------------------------------------------------ */
  const horsComplet = { id: 999999999, path: '/ailleurs/x.mp3', horsBiblio: true,
    title: 'Un Inconnu', artist: 'Personne', genre: 'Disco', tags: ['disco'],
    bpm: 125, key: '9A', energy: 7, timbre: [6, 7, 6], year: 1979, pop: 40 };
  const sug = engine.suggest(horsComplet, library, { limit: 5 });
  verifier('4. un morceau hors bibliotheque recoit quand meme des propositions',
    sug.length > 0, sug.length + ' propositions');
  verifier('4bis. et il ne se propose pas lui-meme',
    !sug.some(s => s.track.id === horsComplet.id));

  /* Le cas nu : ni tempo, ni tonalite, ni genre — tout ce qu'on a
     d'un simple texte. La liste doit quand meme se remplir. */
  const horsNu = { id: 999999998, path: null, horsBiblio: true, sansFichier: true,
    title: 'Cosmo', artist: 'Soprano', genre: '', tags: [], bpm: null, key: null, pop: 40 };
  const sugNu = engine.suggest(horsNu, library, { limit: 5 });
  verifier('4ter. meme sans tempo ni tonalite, la liste n\'est pas vide',
    sugNu.length > 0, sugNu.length + ' propositions');

  console.log('\n' + (ok === dur
    ? G + dur + ' verifications, tout passe.' + F
    : R + (dur - ok) + ' echec(s) sur ' + dur + F));
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
})().catch(e => {
  console.error('banc interrompu : ' + (e && e.message));
  process.exitCode = 1;
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (x) {}
});
