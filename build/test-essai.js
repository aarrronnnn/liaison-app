'use strict';
/* ============================================================
   L'essai resiste-t-il aux fraudes ?

   Ce fichier existe parce que la reponse ne se lit pas dans le
   code : elle se mesure. On instancie la vraie classe License sur
   un dossier jetable, on joue les fraudes une par une, et on
   verifie qu'il reste bien zero jour la ou il doit en rester zero.

   Les six premiers cas etaient deja couverts par la mecanique des
   deux temoins voisins. Le septieme — effacer TOUT le dossier de
   donnees — passait : un seul « rm -rf » emportait les deux
   fichiers d'un coup. D'ou le troisieme temoin, dans le dossier
   personnel, que ce test verrouille.

   Le dossier personnel est simule : ce test n'ecrit jamais dans le
   vrai HOME de qui le lance.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

const JOUR = 86400000;

/* ---------- l'horloge et le dossier personnel, sous controle ---------- */
const vraiNow = Date.now;
const vraiHome = os.homedir;
let decalage = 0;
Date.now = () => vraiNow() + decalage;

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-essai-'));
const MAISON = path.join(racine, 'maison');
const DONNEES = path.join(racine, 'donnees');
fs.mkdirSync(MAISON, { recursive: true });
fs.mkdirSync(DONNEES, { recursive: true });
os.homedir = () => MAISON;

/* Le require vient APRES le detournement : license.js lit os.homedir
   a l'usage, pas au chargement, mais autant ne rien laisser au hasard. */
const { License, TRIAL_DAYS } = require('../src/license.js');
const LIC = path.join(DONNEES, 'license.json');

let echecs = 0;
function cas(quoi, attendu) {
  const l = new License(LIC);
  l.ensureTrial();
  const reste = l.trialLeft();
  const ok = reste === attendu;
  if (!ok) echecs++;
  console.log('  %s %s %s jours (attendu %s)',
    ok ? 'ok  ' : 'RATE', quoi.padEnd(48),
    String(reste).padStart(2), attendu);
  return reste;
}

console.log('essai : ' + TRIAL_DAYS + ' jours\n');

cas('1. premier lancement', TRIAL_DAYS);

decalage += 8 * JOUR;
cas('2. huit jours plus tard', 0);

fs.unlinkSync(LIC);
cas('3. license.json efface', 0);

decalage -= 365 * JOUR;
cas('4. horloge reculee d\'un an', 0);
decalage += 365 * JOUR;

/* Desinstaller une app ne supprime pas son dossier de donnees, ni sur
   macOS ni sur Windows : le cas se simule en ne touchant a rien. */
cas('5. app desinstallee puis reinstallee', 0);

/* La fraude qui passait avant le troisieme temoin. */
fs.rmSync(DONNEES, { recursive: true, force: true });
fs.mkdirSync(DONNEES, { recursive: true });
cas('6. dossier de donnees entierement efface', 0);

/* Et si on efface aussi le troisieme ? L'essai repart — c'est assume :
   a ce stade la personne a cherche deux emplacements et su les vider.
   Le test fige ce comportement pour qu'un changement futur se voie. */
fs.rmSync(path.join(MAISON, '.liaison'), { recursive: true, force: true });
fs.rmSync(DONNEES, { recursive: true, force: true });
fs.mkdirSync(DONNEES, { recursive: true });
cas('7. les trois temoins effaces (limite assumee)', TRIAL_DAYS);

/* ---------- le temoin d'une AUTRE machine ne compte pas ----------
   Quelqu'un qui restaure son dossier personnel sur un ordinateur neuf
   a droit a son essai : ce n'est pas lui qu'on vise. */
decalage += 30 * JOUR;
const temoin = path.join(MAISON, '.liaison', 'essai');
const lu = JSON.parse(Buffer.from(fs.readFileSync(temoin, 'utf8'), 'base64').toString('utf8'));
fs.writeFileSync(temoin, Buffer.from(JSON.stringify(
  Object.assign({}, lu, { d: 'empreinte-dun-autre-ordinateur' })), 'utf8').toString('base64'));
fs.rmSync(DONNEES, { recursive: true, force: true });
fs.mkdirSync(DONNEES, { recursive: true });
cas('8. temoin venu d\'une autre machine : ignore', TRIAL_DAYS);

/* ---------- un vieux temoin, sans empreinte, reste valable ----------
   Sinon la mise a jour offrirait un essai neuf a tous ceux qui en
   avaient un en cours. */
const vieux = { t: vraiNow() - 20 * JOUR, v: vraiNow() };
fs.mkdirSync(path.dirname(temoin), { recursive: true });
fs.writeFileSync(temoin, Buffer.from(JSON.stringify(vieux), 'utf8').toString('base64'));
fs.rmSync(DONNEES, { recursive: true, force: true });
fs.mkdirSync(DONNEES, { recursive: true });
cas('9. temoin d\'avant la mise a jour : accepte', 0);

/* ---------- menage ---------- */
Date.now = vraiNow;
os.homedir = vraiHome;
fs.rmSync(racine, { recursive: true, force: true });

if (echecs) {
  console.error('\n' + echecs + ' cas d\'essai en echec.');
  process.exit(1);
}
console.log('\nessai : 9 fraudes essayees, la protection tient.');
