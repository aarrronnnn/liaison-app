'use strict';
/* ============================================================
   LES TAGS DOIVENT SE LIRE MEME SANS FFPROBE.

   ffprobe-static 3.1.0 — la derniere version publiee — met un
   binaire x86_64 dans bin/darwin/arm64/. Verifie sur l'archive
   npm elle-meme : le paquet est faux, ce n'est pas une
   installation abimee.

   Sur un Mac Apple Silicon sans Rosetta, ce fichier existe, son
   chemin se resout proprement, et il refuse de s'executer. La
   lecture des tags rendait alors un objet vide — sans erreur,
   sans message. Un morceau remontait sans titre, sans artiste,
   sans genre et sans tonalite, exactement comme un fichier qui
   n'aurait aucun tag. La panne la plus couteuse a diagnostiquer
   est celle qui ressemble a un resultat normal.

   Ce test ne verifie donc pas « ffprobe marche » — il verifie que
   l'application SURVIT a son absence, en refaisant le travail
   avec ffmpeg. C'est la propriete qui compte : quel que soit
   l'outil disponible, un fichier tague rend ses tags.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(58) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}

console.log('\n- Lire les tags, quel que soit l\'outil -\n');

/* On fabrique un fichier tague avec l'ffmpeg de la machine. Si
   elle n'en a aucun, il n'y a rien a eprouver ici. */
const { ffmpegPath } = require('../src/analyze');
/* Le PATH est vide dans le sous-processus du deuxieme volet : un
   nom nu comme « ffmpeg » n'y serait plus trouvable, et le test
   mesurerait sa propre mise en scene au lieu du repli. On resout
   donc le chemin absolu ici, une fois. */
function cheminAbsolu(bin) {
  if (bin.includes(path.sep)) return bin;
  const ou = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  const l = String(ou.stdout || '').split(/\r?\n/).find(x => x.trim());
  return l ? l.trim() : bin;
}
const FFMPEG = cheminAbsolu(ffmpegPath());
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-tags-'));
const fichier = path.join(dossier, 'sans-nom-utile.mp3');
const fait = spawnSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi',
  '-i', 'sine=frequency=220:duration=3', '-ac', '1',
  '-metadata', 'title=Mauvais Djo',
  '-metadata', 'artist=Riton la Manivelle',
  '-metadata', 'genre=Variete',
  '-metadata', 'TBPM=112',
  fichier]);

if (fait.status !== 0 || !fs.existsSync(fichier)) {
  console.log('  (aucun ffmpeg utilisable ici : rien a eprouver)\n');
  process.exit(0);
}

/* ------------------------------------------------------------
   On rend TOUS les ffprobe inutilisables.

   LIAISON_FFPROBE pointe vers un programme qui echoue, et le PATH
   est vide pour que « ffprobe » tout court ne trouve rien. Le
   binaire de ffprobe-static, lui, est celui d'une autre
   architecture des qu'on n'est pas sur la machine qui l'a
   installe — et s'il tourne, le premier volet du test le dira.
   ------------------------------------------------------------ */
/* Neutraliser ffprobe-static au niveau du module, comme le ferait
   une machine dont le binaire refuse de demarrer.

   Premiere version de ce test : on vidait le PATH et on pointait
   LIAISON_FFPROBE vers un programme qui echoue. Insuffisant — le
   chemin de ffprobe-static est ABSOLU, donc sur Linux, ou son
   binaire est du bon type, il repondait et le repli n'etait jamais
   emprunte. Le test affirmait alors « on bascule sur ffmpeg » et
   tombait, non pas parce que le code avait tort, mais parce qu'il
   mesurait le mecanisme au lieu de la propriete.

   On remplace donc l'export du module avant tout chargement : la
   panne du Mac est reproduite a l'identique partout. */
const PREPARATION = `
  const cheminPaquet = require.resolve('ffprobe-static', { paths: [${JSON.stringify(path.join(__dirname, '..'))}] });
  require.cache[cheminPaquet] = { id: cheminPaquet, filename: cheminPaquet,
    loaded: true, children: [], paths: [], exports: { path: '/introuvable/ffprobe' } };
`;

function lireDansUnAutreProcessus(env, sansFfprobe) {
  const code = (sansFfprobe ? PREPARATION : '') + `
    const { probe, commentOnLitLesTags } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'library.js'))});
    probe(${JSON.stringify(fichier)}).then(r => {
      process.stdout.write(JSON.stringify({ lecteur: commentOnLitLesTags(), r: r }));
    });
  `;
  const r = spawnSync(process.execPath, ['-e', code], {
    env: Object.assign({}, process.env, env), encoding: 'utf8'
  });
  try { return JSON.parse(r.stdout); } catch (e) { return { erreur: r.stderr || r.stdout }; }
}

/* 1. Le cas normal de cette machine. */
const normal = lireDansUnAutreProcessus({});
verifier('avec l\'outillage de la machine, les tags se lisent',
  !!(normal.r && normal.r.tags && normal.r.tags.title === 'Mauvais Djo'),
  normal.lecteur || JSON.stringify(normal).slice(0, 120));

/* 2. Le cas du Mac Apple Silicon : aucun ffprobe ne repond. */
const sansFfprobe = lireDansUnAutreProcessus({
  LIAISON_FFPROBE: '',                 /* aucune preference : on prend la chaine normale */
  PATH: dossier,                       /* un dossier sans le moindre outil */
  LIAISON_FFMPEG: FFMPEG               /* ffmpeg reste joignable par son chemin */
}, true);
const t = (sansFfprobe.r && sansFfprobe.r.tags) || {};
verifier('sans aucun ffprobe, on bascule sur ffmpeg',
  /ffmpeg/.test(sansFfprobe.lecteur || ''), sansFfprobe.lecteur || JSON.stringify(sansFfprobe).slice(0, 160));
verifier('et le titre est quand meme lu', t.title === 'Mauvais Djo', JSON.stringify(t.title));
verifier('et l\'artiste aussi', t.artist === 'Riton la Manivelle', JSON.stringify(t.artist));
verifier('et le genre aussi', t.genre === 'Variete', JSON.stringify(t.genre));
verifier('et le tempo du tag aussi', String(t.tbpm || t.bpm) === '112', JSON.stringify(t.tbpm || t.bpm));
verifier('et la duree est retrouvee sur la sortie d\'erreur',
  Math.abs((sansFfprobe.r && sansFfprobe.r.duration || 0) - 3) < 0.6,
  String(sansFfprobe.r && sansFfprobe.r.duration));

/* 3. Le morceau complet, pas seulement les tags bruts : c'est ce
      que le widget affiche. */
const exterieurCode = PREPARATION + `
  const ext = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'exterieur.js'))});
  ext.depuisFichier(${JSON.stringify(fichier)}, new Set()).then(t =>
    process.stdout.write(JSON.stringify(t)));
`;
const r3 = spawnSync(process.execPath, ['-e', exterieurCode], {
  env: Object.assign({}, process.env, {
    LIAISON_FFPROBE: '', PATH: dossier, LIAISON_FFMPEG: FFMPEG
  }), encoding: 'utf8'
});
let morceau = null;
try { morceau = JSON.parse(r3.stdout); } catch (e) {}
verifier('le morceau affiche porte son vrai titre, pas le nom du fichier',
  !!morceau && morceau.title === 'Mauvais Djo' && morceau.artist === 'Riton la Manivelle',
  morceau ? morceau.artist + ' / ' + morceau.title : (r3.stderr || '').slice(0, 160));
verifier('et son tempo vient du tag, donc rien a mesurer',
  !!morceau && morceau.bpm === 112 && morceau.aMesurer === false,
  morceau ? 'tempo ' + morceau.bpm + ' aMesurer ' + morceau.aMesurer : 'rien');

try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}

console.log(ko ? '\n' + ko + ' cas en echec.\n' : '\n9 verifications, les tags se lisent avec ou sans ffprobe.\n');
process.exit(ko ? 1 : 0);
