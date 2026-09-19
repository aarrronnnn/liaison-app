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
const { License, TRIAL_DAYS, TRIAL_SOIREES, TRIAL_PLAFOND_J } = require('../src/license.js');
const LIC = path.join(DONNEES, 'license.json');

let echecs = 0;

/* ------------------------------------------------------------
   Les cas de fraude se jouent avec les soirees DEJA FAITES.

   Depuis que l'essai se compte en soirees, un essai dont les
   jours sont ecoules mais dont les soirees ne le sont pas reste
   ouvert — c'est le but. Les neuf fraudes ci-dessous portent sur
   l'horloge et les fichiers, pas sur les soirees : on pose donc
   le compteur a son maximum pour que « zero jour restant » ait
   le meme sens qu'avant, et on eprouve la regle des soirees
   separement, plus bas.
   ------------------------------------------------------------ */
function cas(quoi, attendu, soirees) {
  const l = new License(LIC);
  l.soirees = () => (soirees == null ? TRIAL_SOIREES : soirees);
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

/* ============================================================
   ET LA REGLE QUI REMPLACE LE COMPTE EN JOURS.

   Le site promet depuis des mois que « l'essai se compte en
   soirees, pas en jours ». Ces cas-la sont la promesse, ecrite
   en code executable : si l'un d'eux tombe, la page ment.

   Le sens de chacun est donne en clair, parce qu'un essai de
   licence qu'on ne comprend pas est un essai qu'on desactivera
   au premier faux positif.
   ============================================================ */
console.log('\nl\'essai se compte en soirees\n');

function soir(quoi, jours, soirees, ouvert) {
  fs.rmSync(racine, { recursive: true, force: true });
  fs.mkdirSync(MAISON, { recursive: true });
  fs.mkdirSync(DONNEES, { recursive: true });
  decalage = 0;
  const l0 = new License(LIC);
  l0.soirees = () => soirees;
  l0.ensureTrial();                       /* jour 0 : l'essai demarre */
  decalage += jours * JOUR;
  const l = new License(LIC);
  l.soirees = () => soirees;
  l.ensureTrial();
  const reste = l.trialLeft();
  const ok = (reste > 0) === ouvert;
  if (!ok) echecs++;
  console.log('  %s %s %s',
    ok ? 'ok  ' : 'RATE', quoi.padEnd(56),
    (reste > 0 ? 'ouvert (' + reste + ')' : 'ferme'));
  return l;
}

/* Le plancher : les sept jours sont un minimum, jamais un
   maximum. Jouer ses deux soirees des le premier week-end ne
   doit PAS raccourcir l'essai — ce serait punir celui qui se
   sert de l'app. */
soir('deux soirees des le 3e jour : l\'essai continue', 3, 5, true);

/* Le cas qui motive tout : le DJ de mariage. Il installe un
   mardi, sa date est dans trois semaines. Avant, son essai se
   fermait avant qu'il ait ouvert l'app en cabine une seule fois. */
soir('8 jours, aucune soiree jouee : l\'essai reste ouvert', 8, 0, true);
soir('30 jours, une seule soiree : l\'essai reste ouvert', 30, 1, true);

/* Et il se ferme des que le DJ a pu juger. */
soir('8 jours, deux soirees jouees : l\'essai se ferme', 8, TRIAL_SOIREES, false);
soir('40 jours, trois soirees jouees : ferme', 40, 3, false);

/* La butee. Quelqu'un qui installe et n'ouvre jamais son logiciel
   de mix n'essaie rien : il stocke. Elle protege aussi de la
   boucle infinie si la detection des decks echoue sur sa
   machine — sans elle, un bug de detection donnerait un essai a
   vie. */
soir('61 jours sans une seule soiree : la butee ferme', TRIAL_PLAFOND_J + 1, 0, false);
soir('59 jours sans soiree : encore ouvert, de justesse', TRIAL_PLAFOND_J - 1, 0, true);

/* Ce que l'interface lit pour choisir entre « 5 j » et « encore
   une soiree ». Afficher « 1 jour » pendant trois semaines
   d'affilee serait faux, et cesserait d'etre cru. */
{
  const a = soir('pendant les 7 jours : on compte en jours', 2, 0, true);
  const ok1 = a.trialRaison() === 'jours';
  if (!ok1) echecs++;
  console.log('  %s %s %s', ok1 ? 'ok  ' : 'RATE',
    'et la raison annoncee est « jours »'.padEnd(56), a.trialRaison());

  const b = soir('apres les 7 jours : on compte en soirees', 9, 0, true);
  const ok2 = b.trialRaison() === 'soirees';
  if (!ok2) echecs++;
  console.log('  %s %s %s', ok2 ? 'ok  ' : 'RATE',
    'et la raison annoncee est « soirees »'.padEnd(56), b.trialRaison());
  const ok3 = b.status().trialSoireesRequis === TRIAL_SOIREES;
  if (!ok3) echecs++;
  console.log('  %s %s', ok3 ? 'ok  ' : 'RATE',
    'le statut porte le nombre de soirees attendu'.padEnd(56));
}

/* Un compteur de soirees casse ne doit JAMAIS fermer la porte a
   un client : il rend zero, donc l'essai reste ouvert. L'erreur
   coute une semaine d'essai de trop, pas un client perdu. */
{
  fs.rmSync(racine, { recursive: true, force: true });
  fs.mkdirSync(MAISON, { recursive: true }); fs.mkdirSync(DONNEES, { recursive: true });
  decalage = 0;
  const l0 = new License(LIC); l0.ensureTrial();
  decalage += 9 * JOUR;
  const l = new License(LIC);
  l.soirees = () => { throw new Error('journal illisible'); };
  l.ensureTrial();
  const ok = l.trialLeft() > 0;
  if (!ok) echecs++;
  console.log('  %s %s', ok ? 'ok  ' : 'RATE',
    'un compteur de soirees en panne laisse l\'essai ouvert'.padEnd(56));
}

/* ---------- menage ---------- */
Date.now = vraiNow;
os.homedir = vraiHome;
fs.rmSync(racine, { recursive: true, force: true });

if (echecs) {
  console.error('\n' + echecs + ' cas d\'essai en echec.');
  process.exit(1);
}
console.log('\nessai : 9 fraudes essayees, la protection tient, et il se compte en soirees.');
