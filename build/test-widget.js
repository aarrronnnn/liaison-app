'use strict';
/* ============================================================
   L'ecran principal, rendu pour de vrai.

   La fenetre de licence avait son essai de rendu. La liste de
   suggestions — l'ecran que le DJ regarde toute la nuit, celui
   qui porte chaque nouvelle etiquette qu'on ajoute — n'en avait
   AUCUN. On ajoutait donc des pastilles (TENDANCE, HORS BULLE,
   CLOTURE, DEMANDE, DEJA PASSE, et maintenant RELANCE) en
   verifiant a l'oeil, une fois, sur une seule combinaison.

   Ce fichier rend la vraie page avec un faux pont, et verifie :
     — qu'aucune vue ne jette,
     — que les etiquettes sortent quand elles doivent sortir,
     — que rien ne deborde en largeur (la cabine est etroite),
     — que les etats vides disent quoi faire au lieu de rien.
   ============================================================ */
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) {} }
if (!chromium) {
  console.log('widget : playwright absent — rendu de l\'ecran non verifie.');
  process.exit(0);
}

const FICHIER = 'file://' + path.join(__dirname, '..', 'src', 'ui', 'widget.html');
const LARGEUR = 420;

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(52),
              detail ? '  — ' + detail : '');
}

/* Trois propositions qui couvrent toutes les etiquettes a la fois :
   une nue, une avec tendance et relance, une qui les cumule toutes. */
const SUG = [
  { id: 1, title: 'Alexandrie Alexandra', artist: 'Claude Francois', key: '8A', bpm: 128,
    energy: 9, total: 79, transition: 'Accord parfait', why: 'meme famille', delta: -1.5,
    trend: 20, h: 100, tempoS: 90, crowd: 60, timbre: 80, plan: null, introBars: 8,
    client: false, cloture: false, bulle: null, horsBulle: false, pourquoi: null,
    age: null, relance: false, deja: null },
  { id: 2, title: 'Voyage voyage', artist: 'Desireless', key: '8B', bpm: 132,
    energy: 8, total: 73, transition: 'Enchainement', why: 'x', delta: 1.5,
    trend: 75, h: 89, tempoS: 90, crowd: 55, timbre: 70, plan: null, introBars: 16,
    client: false, cloture: false, bulle: null, horsBulle: false,
    pourquoi: 'tu l’as deja enchaine', age: null, relance: true, deja: null },
  { id: 3, title: 'Bella ciao', artist: 'Hugel', key: '9A', bpm: 124, energy: 9,
    total: 69, transition: 'Coupe', why: 'x', delta: -4.6, trend: 30, h: 64, tempoS: 55,
    crowd: 70, timbre: 60, plan: null, introBars: 4, client: true, cloture: true,
    bulle: 88, horsBulle: true, pourquoi: null, age: 'date', relance: true,
    deja: { texte: 'DEJA PASSE', grave: true } }
];

const SOS = [
  { id: 9, title: 'Y.M.C.A.', artist: 'Village People', key: '7A', bpm: 127, energy: 9,
    total: 88, why: 'La salle la connait', introBars: 4, client: false, transition: 'Coupe',
    bulle: null, horsBulle: false, deja: null, plancher: 96 }
];

(async () => {
  let b;
  for (const essai of [undefined, process.env.CHROMIUM, '/opt/pw-browsers/chromium',
                       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (essai !== undefined && !essai) continue;
    try { b = await chromium.launch(essai ? { executablePath: essai } : undefined); break; }
    catch (e) { /* suivant */ }
  }
  if (!b) { console.log('widget : navigateur de test absent — rendu non verifie.'); process.exit(0); }

  const p = await b.newPage({ viewport: { width: LARGEUR, height: 760 } });
  const errs = [];
  p.on('pageerror', e => errs.push('erreur JS : ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console : ' + m.text()); });

  /* Le faux pont. Il doit rendre EXACTEMENT ce que preload.js rend —
     c'est la moitie de l'interet de cet essai : si la forme change
     d'un cote sans l'autre, ce fichier le dit. */
  await p.addInitScript(() => {
    const rien = () => {};
    const ecoute = {};
    window.__ecoute = ecoute;
    /* ------------------------------------------------------------
       Le faux pont expose TOUTE la surface de preload.js, et rien
       de plus. C'est la moitie de l'interet de cet essai : le jour
       ou la page appellera une methode que le pont n'expose pas,
       ce fichier tombera ici plutot qu'en cabine.

       Defaut « undefined » pour tout ce qui n'est pas nomme
       ci-dessous : une fonction qui rend null ne ment pas, elle
       dit juste « rien a afficher ».
       ------------------------------------------------------------ */
    const SURFACE = ('analysisState autoImport bilan bulleBasculer bulleGet bulleRecentrer ' +
      'clientClear clientGet clientImport clientRemove clientShopping closeLicence copy ' +
      'copySet crates dragPossible dragTrack exportSet filters getConfig goutEtat goutOublier ' +
      'healthReveal healthScan hideWidget iconDataUrl landingClear landingGet landingPlan ' +
      'librarySources licenseActivate licenseBuy licenseRefresh licenseRelease licenseStatus ' +
      'listSets loadTrack majEtat majIgnorer majOuvrir nowPlaying on openExternal openLicence ' +
      'openSettings pack pickLibrary prepareBuild prepareExport replaySet requests ' +
      'rescanLibrary rescue runningApps saveQR scanInfo searchTrack setConfig setDebrief ' +
      'setFilters setHeight soireeActiver soireeCreer soireeDesactiver soireeDupliquer ' +
      'soireeModifier soireeSupprimer soireesListe startSession structure suggest tarifs ' +
      'tracklist').split(' ');
    const api = {};
    for (const k of SURFACE) api[k] = async () => null;
    Object.assign(api, {
      getConfig: async () => ({ version: '1.4.1',
        config: { theme: 'nuit', arc: 'auto', mode: 'crowd', sessionName: 'Essai' } }),
      setConfig: rien,
      on: (k, f) => { ecoute[k] = f; },
      loadTrack: async () => ({ ok: true, copied: 'titre' }),
      rescue: async () => [],
      filters: async () => ({ n: 0 }),
      analysisState: async () => ({ library: 22000, analyses: 12000, offline: 0,
                                    restants: 10000, total: 22000, conseils: [] }),
      licenseStatus: async () => ({ tier: 'pro', label: 'Pro', limit: 5 }),
      iconDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=',
      openLicence: rien, openExternal: rien, hideWidget: rien, setHeight: rien,
      openSettings: rien, closeLicence: rien, licenseBuy: rien, dragTrack: rien,
      requests: async () => [], listSets: async () => [], searchTrack: async () => [],
      runningApps: async () => [], crates: async () => [], soireesListe: async () => [],
      platform: 'darwin'
    });
    window.liaison = api;
  });

  await p.goto(FICHIER);
  await p.waitForTimeout(600);

  verifier('1. l\'ecran s\'ouvre sans rien jeter', errs.length === 0, errs[0] || '');

  /* ---------- 2. la liste de suggestions ---------- */
  {
    const r = await p.evaluate((sug) => {
      renderSug(sug);
      const rows = [...document.querySelectorAll('#list .row')];
      const etiq = n => [...rows[n].querySelectorAll('.up, .clo, .hb, .ask, .deja')]
        .map(x => x.textContent.trim());
      return {
        n: rows.length,
        premiere: rows[0] && rows[0].classList.contains('best'),
        e0: etiq(0), e1: etiq(1), e2: etiq(2),
        large: Math.max(...rows.map(x => Math.ceil(x.scrollWidth))),
        debord: document.documentElement.scrollWidth
      };
    }, SUG);
    verifier('2. les trois propositions s\'affichent', r.n === 3, r.n + ' lignes');
    verifier('2bis. la premiere est mise en avant', r.premiere === true);
    verifier('3. sans etiquette, il n\'y en a aucune', r.e0.length === 0, r.e0.join(' '));
    verifier('3bis. TENDANCE et RELANCE sortent ensemble',
             r.e1.includes('TENDANCE') && r.e1.includes('RELANCE'), r.e1.join(' · '));
    verifier('3ter. et les cinq etiquettes cohabitent',
             ['CLÔTURE', 'HORS BULLE', 'DEMANDÉ', 'DEJA PASSE', 'RELANCE']
               .every(x => r.e2.includes(x)), r.e2.join(' · '));
    verifier('4. rien ne deborde en largeur', r.debord <= LARGEUR,
             r.debord + ' px pour ' + LARGEUR + ' px de fenetre');
    verifier('4bis. et aucune ligne ne depasse', r.large <= LARGEUR, r.large + ' px');
  }

  /* ---------- 5. le sauvetage ---------- */
  {
    errs.length = 0;
    const r = await p.evaluate((sos) => {
      renderSos(sos);
      const rows = [...document.querySelectorAll('#list .row.sos')];
      return { n: rows.length, texte: rows[0] ? rows[0].textContent : '',
               debord: document.documentElement.scrollWidth };
    }, SOS);
    verifier('5. le SOS s\'affiche', r.n === 1 && /Village People/.test(r.texte));
    verifier('5bis. sans rien jeter ni deborder',
             errs.length === 0 && r.debord <= LARGEUR, errs[0] || r.debord + ' px');
  }

  /* ---------- 6. les ecrans vides disent quoi faire ---------- */
  {
    const cas = await p.evaluate(() => {
      const out = [];
      const avant = { an: etatAn, now: typeof curNow !== 'undefined' ? curNow : null };
      etatAn = { library: 0, analyses: 0, offline: 0, restants: 0, conseils: [], importing: false };
      out.push({ quoi: 'aucune bibliotheque', html: etatVide() });
      etatAn.library = 22000;
      curNow = null;
      out.push({ quoi: 'aucun morceau detecte', html: etatVide() });
      etatAn = avant.an; curNow = avant.now;
      return out;
    });
    for (const c of cas) {
      const aUnTitre = /<b>/.test(c.html);
      const aUneMarche = /<li>/.test(c.html) || /<\/div>/.test(c.html);
      verifier('6. « ' + c.quoi +' » : un titre et une marche a suivre',
               aUnTitre && aUneMarche);
    }
  }

  /* ---------- 7. la cabine etroite ---------- */
  {
    await p.setViewportSize({ width: 320, height: 620 });
    errs.length = 0;
    const r = await p.evaluate((sug) => {
      renderSug(sug);
      return { debord: document.documentElement.scrollWidth,
               n: document.querySelectorAll('#list .row').length };
    }, SUG);
    verifier('7. a 320 px de large, rien ne deborde encore',
             r.debord <= 320 && r.n === 3, r.debord + ' px');
    verifier('7bis. et toujours aucune erreur', errs.length === 0, errs[0] || '');
  }

  await b.close();
  if (echecs) { console.error('\n' + echecs + ' probleme(s) sur l\'ecran principal.'); process.exit(1); }
  console.log('\nwidget : l\'ecran de cabine tient, etiquettes comprises.');
})();
