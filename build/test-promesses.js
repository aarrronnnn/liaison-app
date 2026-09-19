'use strict';
/* ============================================================
   CE QUE L'INTERFACE PROMET, COMPARE A CE QUE LE CODE FAIT.

   La fenetre de preparation annoncait « Quatorze jours, toutes
   fonctions ouvertes » et affichait une pastille « 14 JOURS »,
   alors que license.js compte TRIAL_DAYS = 7. Un DJ voyait donc
   son essai se fermer une semaine avant la date promise par
   l'ecran qui lui avait vendu l'essai.

   Personne n'avait menti : le chiffre a change dans le code, la
   phrase est restee. C'est exactement le genre de decalage
   qu'aucune relecture ne rattrape et qu'un essai attrape en
   trente millisecondes. Le site a deja le sien
   (liaison-web/outils/verifier-balisage.js) ; l'app n'en avait
   pas, et c'est l'app qui a derive.

   On verifie ici les promesses CHIFFREES, celles qu'on peut
   confronter a une constante :

     - la duree d'essai annoncee = TRIAL_DAYS,
     - les prix cites en dur dans l'interface = TARIFS_REPLI,
     - le nombre de suggestions annonce par formule = TIERS.

   Une promesse qu'on ne peut pas confronter a une constante n'a
   rien a faire ici : ce fichier ne juge pas la prose.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const lic = require('../src/license.js');

const UI = path.join(__dirname, '..', 'src', 'ui');
let ko = 0;
function verifier(nom, ok, detail) {
  console.log((ok ? '  ok   ' : '  ECHEC') + ' ' + nom + (ok || !detail ? '' : '   — ' + detail));
  if (!ok) ko++;
}

const fichiers = fs.readdirSync(UI).filter(f => f.endsWith('.html'))
  .map(f => ({ nom: f, txt: fs.readFileSync(path.join(UI, f), 'utf8') }));

/* On ne lit que ce qui s'affiche : les commentaires expliquent
   souvent l'ancienne valeur et la nouvelle cote a cote, et les
   compter reviendrait a s'interdire d'ecrire l'histoire d'une
   correction dans le fichier qui la porte. */
const sansCommentaires = t => t
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ');

/* ---------- 1. la duree d'essai ---------- */
const J = lic.TRIAL_DAYS;
const MOTS = { 7: 'sept', 14: 'quatorze', 30: 'trente' };
const AUTRES = Object.entries(MOTS).filter(([n]) => Number(n) !== J);

for (const f of fichiers) {
  const t = sansCommentaires(f.txt);
  for (const [n, mot] of AUTRES) {
    const chiffre = new RegExp('(^|[^\\d])' + n + '\\s*jours?\\b', 'i');
    const lettre = new RegExp('\\b' + mot + '\\s+jours?\\b', 'i');
    verifier(f.nom + ' n\'annonce pas ' + n + ' jours d\'essai',
             !chiffre.test(t) && !lettre.test(t),
             'TRIAL_DAYS vaut ' + J);
  }
}
verifier('la duree d\'essai est bien une constante', typeof J === 'number' && J > 0, String(J));

/* ---------- 2. les prix ecrits en dur ---------- */
/* Les prix doivent venir de tarifs(), pas du HTML. On tolere le
   pass — il est cite dans les explications, il ne bouge pas, et
   il est le seul montant qu'on assume d'ecrire — mais aucun
   autre montant du bareme ne doit apparaitre en dur, sinon il
   survivra a un changement de tarif. */
const bareme = lic.TARIFS_REPLI.plans;
const EN_DUR_TOLERES = new Set([bareme.pass.euro]);
for (const f of fichiers) {
  const t = sansCommentaires(f.txt);
  for (const [plan, p] of Object.entries(bareme)) {
    if (!p.euro || EN_DUR_TOLERES.has(p.euro)) continue;
    const re = new RegExp('(^|[^\\d,.])' + p.euro.replace(/[,.]/g, '[,.]') + '\\s*(&euro;|€)');
    verifier(f.nom + ' n\'ecrit pas le prix « ' + plan + ' » en dur',
             !re.test(t), p.euro + ' € trouve dans le HTML');
  }
}

/* ---------- 3. le nombre de suggestions par formule ---------- */
const T = lic.TIERS;
verifier('Resident ouvre bien 5 suggestions', T.resident.suggestions === 5, String(T.resident.suggestions));
verifier('Collectif en ouvre bien 7', T.collectif.suggestions === 7, String(T.collectif.suggestions));
const reg = fichiers.find(f => f.nom === 'settings.html');
if (reg) {
  const t = sansCommentaires(reg.txt);
  const m = t.match(/(\d)\s*suggestions\s+au\s+lieu\s+de\s+(\d)/i);
  verifier('« 7 suggestions au lieu de 5 » dit vrai',
           !!m && Number(m[1]) === T.collectif.suggestions && Number(m[2]) === T.resident.suggestions,
           m ? m[0] : 'phrase absente');
  /* Le nombre de machines, meme regle. */
  const mm = t.match(/(\d)\s*machines,\s*rejeu/i);
  verifier('« 2 machines » pour Resident dit vrai',
           !!mm && Number(mm[1]) === T.resident.seats, mm ? mm[0] : 'phrase absente');
  const mc = t.match(/(\d)\s*machines,\s*\d\s*suggestions/i);
  verifier('« 5 machines » pour Collectif dit vrai',
           !!mc && Number(mc[1]) === T.collectif.seats, mc ? mc[0] : 'phrase absente');
}

console.log(ko ? '\n' + ko + ' PROMESSE(S) NON TENUE(S)'
                : '\npromesses : l\'interface dit ce que le code fait.');
process.exit(ko ? 1 : 0);
