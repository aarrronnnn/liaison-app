'use strict';
/* ============================================================
   LES DOSSIERS AJOUTES A LA MAIN.

   Demande d'un DJ a deux disques dont la bibliotheque n'etait pas
   trouvee : « ca serait cool de pouvoir fournir un dossier
   directement ».

   Le piege est dans le detail. Il existait deja un « library:pick »
   dans le cote principal — jamais appele par l'interface — et il
   REMPLACAIT toute la bibliotheque par le dossier choisi. Le DJ a
   deux disques qui s'en serait servi aurait perdu le premier, et
   sa base rekordbox avec. Un raccourci qui detruit est pire que
   l'absence de raccourci.

   Ce fichier eprouve donc la propriete qui compte : un dossier
   ajoute est une source DE PLUS. Jamais un remplacement.
   ============================================================ */
const D = require('../src/dossiers');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(58) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}

console.log('\n- Les dossiers ajoutes a la main -\n');

/* ---------- la forme des chemins ---------- */
verifier('un slash final ne fait pas un dossier different',
  D.cle('/Volumes/SSD/Tracks/') === D.cle('/Volumes/SSD/Tracks'));
verifier('les antislash de Windows valent des slash',
  D.cle('D:\\Sons\\Tracks') === D.cle('D:/Sons/Tracks'));
verifier('un chemin vide ne devient pas un dossier',
  D.ajouter([], '   ').ajoute === false);

/* ---------- ajouter ---------- */
let r = D.ajouter([], '/Volumes/SSD/Tracks');
verifier('un premier dossier entre', r.ajoute && r.liste.length === 1, JSON.stringify(r.liste));

r = D.ajouter(r.liste, '/Volumes/SSD/Tracks');
verifier('le meme dossier n\'entre pas deux fois',
  !r.ajoute && r.raison === 'deja' && r.liste.length === 1, r.raison);

r = D.ajouter(r.liste, '/Volumes/SSD/Tracks/House');
verifier('un sous-dossier d\'un dossier deja la est refuse',
  !r.ajoute && r.raison === 'inclus' && r.liste.length === 1, r.raison);

/* Le parent englobe : on ne lit pas deux fois la meme musique. */
r = D.ajouter(['/Volumes/SSD/Tracks/House'], '/Volumes/SSD/Tracks');
verifier('un dossier parent remplace les enfants qu\'il contient',
  r.ajoute && r.raison === 'englobe' && r.liste.length === 1
    && r.retires[0] === '/Volumes/SSD/Tracks/House', JSON.stringify(r));

/* Deux disques : c'est tout le sujet. */
r = D.ajouter(['/Volumes/SSD/Tracks'], '/Volumes/Backup/Sons');
verifier('deux disques differents coexistent',
  r.ajoute && r.liste.length === 2, JSON.stringify(r.liste));

/* ---------- retirer ---------- */
const ret = D.retirer(['/Volumes/SSD/Tracks', '/Volumes/Backup/Sons'], '/Volumes/SSD/Tracks/');
verifier('retirer marche malgre le slash final',
  ret.retire && ret.liste.length === 1 && ret.liste[0] === '/Volumes/Backup/Sons',
  JSON.stringify(ret.liste));
verifier('retirer un dossier absent ne casse rien',
  D.retirer(['/a'], '/b').liste.length === 1);

/* ---------- en sources ---------- */
const present = d => d !== '/Volumes/Backup/Sons';   /* le second disque est debranche */
const src = D.sources(['/Volumes/SSD/Tracks', '/Volumes/Backup/Sons'], present);
verifier('chaque dossier devient une source de type « folder »',
  src.length === 2 && src.every(s => s.kind === 'folder'), JSON.stringify(src.map(s => s.kind)));
verifier('et se reconnait comme ajoutee a la main',
  src.every(s => s.manuel === true));
verifier('son libelle porte le nom du dossier',
  /Tracks/.test(src[0].label), src[0].label);

/* ------------------------------------------------------------
   LE DISQUE DEBRANCHE.

   Un SSD revient le lendemain. Effacer le reglage de quelqu'un
   parce qu'il a retire sa cle serait une trahison — et c'est
   exactement le genre de chose qu'on ne remarque qu'une fois le
   reglage perdu.
   ------------------------------------------------------------ */
verifier('un dossier absent reste dans la liste',
  src.length === 2 && src[1].present === false, JSON.stringify(src[1]));
verifier('mais il n\'est pas propose a la lecture ce soir',
  D.lisibles(['/Volumes/SSD/Tracks', '/Volumes/Backup/Sons'], present).length === 1);

/* ------------------------------------------------------------
   LA PROPRIETE CENTRALE : ON AJOUTE, ON NE REMPLACE PAS.

   On rejoue ce que fait le cote principal — les sources detectees,
   puis les dossiers du DJ — et on exige que les premieres soient
   toujours la.
   ------------------------------------------------------------ */
const detectees = [
  { kind: 'rekordbox', path: '/Users/dj/Music/rekordbox.xml', label: 'rekordbox — export XML' },
  { kind: 'serato', path: 'D:/_Serato_/database V2', label: 'Serato — base de morceaux' }
];
const toutes = detectees.concat(D.lisibles(['/Volumes/SSD/Tracks'], () => true));
verifier('les sources detectees survivent a l\'ajout d\'un dossier',
  toutes.length === 3 && toutes.some(s => s.kind === 'rekordbox')
                      && toutes.some(s => s.kind === 'serato'),
  toutes.map(s => s.kind).join(' + '));
verifier('et le dossier du DJ vient en plus, pas a la place',
  toutes[2].kind === 'folder' && toutes[2].manuel === true);

/* ============================================================
   LE CONTRAT ENTRE LA PAGE ET LE COTE PRINCIPAL.

   Deja vu cette semaine, deux fois : la page lisait « g.tag » que
   personne n'envoyait, et le pont exposait « pickLibrary » que
   l'interface n'appelait jamais. Les deux ont tenu des semaines
   sans une erreur.

   On lit donc la page elle-meme : les champs qu'elle utilise
   doivent exister, et les methodes qu'elle appelle doivent etre
   exposees par le pont.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'settings.html'), 'utf8');
const pont = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
const principal = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

for (const m of ['dossiersListe', 'dossiersAjouter', 'dossiersRetirer']) {
  verifier('la page appelle « ' + m + " », et le pont l'expose",
    page.includes('window.liaison.' + m) && pont.includes(m + ':'),
    'page:' + page.includes('window.liaison.' + m) + ' pont:' + pont.includes(m + ':'));
}
for (const c of ['dossiers:liste', 'dossiers:ajouter', 'dossiers:retirer']) {
  verifier('le canal « ' + c + ' » est bien traite cote principal',
    principal.includes("ipcMain.handle('" + c + "'"));
}

/* Les champs que la page lit sur chaque dossier doivent exister
   sur ce que sources() fabrique reellement. */
const rendu = page.slice(page.indexOf('box.innerHTML = liste.map(d => {'));
const champs = Array.from(new Set((rendu.slice(0, rendu.indexOf("}).join('')"))
  .match(/\bd\.([A-Za-z_$][\w$]*)/g) || []).map(x => x.slice(2))));
const modele = D.sources(['/Volumes/SSD/Tracks'], () => true)[0];
verifier('on a trouve le rendu des dossiers dans la page', champs.length > 0, champs.join(', '));
for (const c of champs) {
  verifier('la page lit « d.' + c + ' », et le cote principal l\'envoie',
    modele[c] !== undefined, 'absent de { ' + Object.keys(modele).join(', ') + ' }');
}

/* Et le reglage doit survivre a un redemarrage : il vit dans la
   config, pas dans une variable. */
verifier('les dossiers sont enregistres dans la configuration',
  /dossiers:\s*\[\]/.test(principal) && principal.includes('config.dossiers'));

console.log(ko ? '\n' + ko + ' cas en echec.\n'
               : '\ndossiers : un dossier ajoute est une source de plus, jamais un remplacement.\n');
process.exit(ko ? 1 : 0);
