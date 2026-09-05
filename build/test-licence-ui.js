'use strict';
/* La fenetre de licence, rendue pour de vrai.

   Trois vues, trois etats de licence. On verifie qu'aucune ne jette,
   qu'aucun bouton ne se retrouve sous le bas de la fenetre, et que la
   hauteur demandee correspond bien au contenu. C'est exactement le
   defaut qu'on vient de corriger : une hauteur ecrite en dur qui
   coupait le bouton « Commencer ». */
const path = require('path');
const { chromium } = require('/home/claude/.npm-global/lib/node_modules/playwright');

const FICHIER = 'file://' + path.join(__dirname, '..', 'src', 'ui', 'licence.html');

const CAS = [
  { nom: 'accueil, essai neuf', v: null,
    st: { tier: 'trial', label: 'Essai', trialLeft: 7, key: null },
    bilan: { sets: 0, heures: 0, enchainements: 0, pris: 0, titres: 0 },
    attend: 'v-welcome', bouton: '#goTrial' },
  { nom: 'fin d\'essai, avec bilan', v: 'plans',
    st: { tier: 'expire', label: 'Essai termine', trialLeft: 0, key: null },
    bilan: { sets: 4, heures: 11, enchainements: 213, pris: 145, titres: 22180 },
    attend: 'v-plans', bouton: '#alreadyPaid', bilanVisible: true },
  { nom: 'fin d\'essai, sans usage', v: 'plans',
    st: { tier: 'expire', label: 'Essai termine', trialLeft: 0, key: null },
    bilan: { sets: 0, heures: 0, enchainements: 1, pris: 0, titres: 300 },
    attend: 'v-plans', bouton: '#alreadyPaid', bilanVisible: false },
  { nom: 'code', v: 'code',
    st: { tier: 'trial', label: 'Essai', trialLeft: 9, key: null },
    bilan: { sets: 1, heures: 2, enchainements: 30, pris: 12, titres: 900 },
    attend: 'v-code', bouton: '#key' }
];

(async () => {
  const b = await chromium.launch();
  let ko = 0;
  for (const c of CAS) {
    const p = await b.newPage({ viewport: { width: 460, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.addInitScript(({ st, bilan }) => {
      window.__hauteur = 0;
      window.liaison = {
        iconDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=',
        licenseStatus: async () => st,
        bilan: async () => bilan,
        tarifs: async () => ({ lancement: true, moisOfferts: 3, plans: {
          pass: { euro: '4,95' }, resident: { euro: '14,95' },
          resident_an: { euro: '134', euroPlein: '149', parMois: '11,17', barre: true },
          collectif: { euro: '44,95' }, collectif_an: { euro: '404', euroPlein: '449', barre: true } } }),
        setHeight: h => { window.__hauteur = h; },
        closeLicence: () => {}, licenseBuy: () => {}, licenseActivate: async () => ({ ok: true }),
        on: () => {},
        platform: 'darwin', openExternal: () => {}
      };
    }, { st: c.st, bilan: c.bilan });
    await p.goto(FICHIER + (c.v ? '?v=' + c.v : ''));
    await p.waitForTimeout(700);

    const r = await p.evaluate((c) => {
      const vue = document.querySelector('.view.on');
      const bt = document.querySelector(c.bouton);
      const bil = document.getElementById('bilan');
      return {
        vue: vue && vue.id,
        h: window.__hauteur,
        contenu: Math.ceil(vue.getBoundingClientRect().bottom + window.scrollY +
                   (parseFloat(getComputedStyle(document.body).paddingBottom) || 0)),
        boutonBas: bt ? Math.ceil(bt.getBoundingClientRect().bottom) : -1,
        bilanVisible: !!(bil && !bil.hidden),
        bilanTexte: bil ? bil.textContent : '',
        defile: getComputedStyle(document.body).overflowY === 'auto'
      };
    }, { bouton: c.bouton });

    const dit = [];
    if (errs.length) dit.push('erreur JS : ' + errs[0]);
    if (r.vue !== c.attend) dit.push('vue ' + r.vue + ' au lieu de ' + c.attend);
    if (r.boutonBas < 0) dit.push('bouton ' + c.bouton + ' absent');
    else if (r.boutonBas > r.h && !r.defile) dit.push('le bouton ' + c.bouton + ' est ' +
      (r.boutonBas - r.h) + ' px SOUS le bas de la fenetre (' + r.h + ' px demandes), et la fenetre ne defile pas');
    if (r.h < r.contenu - 2 && !r.defile) dit.push('fenetre trop courte : ' + r.h + ' px pour ' + r.contenu + ' px de contenu');
    if (c.bilanVisible !== undefined && r.bilanVisible !== c.bilanVisible)
      dit.push('bilan ' + (r.bilanVisible ? 'affiche' : 'absent') + ' alors qu\'on attendait l\'inverse');
    if (c.bilanVisible && !/213 enchaînements/.test(r.bilanTexte))
      dit.push('le bilan ne reprend pas les chiffres reels : « ' + r.bilanTexte + ' »');

    if (dit.length) { ko += dit.length; console.log('  ECHEC  ' + c.nom + '\n      ' + dit.join('\n      ')); }
    else console.log('  ok     ' + c.nom.padEnd(26) + ' ' + String(r.h).padStart(3) + ' px');
    await p.close();
  }
  await b.close();
  if (ko) { console.log('\n' + ko + ' probleme(s).'); process.exit(1); }
  console.log(CAS.length + ' vues de la fenetre de licence : rien ne deborde, rien ne jette.');
})();
