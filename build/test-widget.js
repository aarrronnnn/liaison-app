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

/* ============================================================
   LES STYLES DU FAUX PONT VIENNENT DE LA VRAIE FONCTION.

   Ils etaient ecrits a la main ici : [{ tag: 'Techno', n: 770 }].
   Or genresDuDJ() ne rend pas « tag » — elle rend { cle, libelle,
   n, famille }. Le faux collait donc a ce que la PAGE croyait
   recevoir, pas a ce que le cote principal envoie vraiment.

   Consequence : cet essai affirmait « le tiroir sert les styles du
   DJ » pendant que, en cabine, le tiroir servait des pastilles
   sans texte qui ne filtraient rien. Un faux ecrit depuis
   l'hypothese du consommateur ne verifie que l'hypothese.

   On fabrique donc le faux AVEC la fonction reelle. Les deux
   cotes ne peuvent plus diverger sans que ce fichier tombe.
   ============================================================ */
const STYLES = (() => {
  const g = require('../src/genres');
  const biblio = [];
  let id = 0;
  const poser = (tag, n) => { for (let i = 0; i < n; i++) biblio.push({ id: ++id, tags: [tag] }); };
  poser('Variété française', 2840);
  poser('Disco', 1620);
  poser('Techno', 770);
  return g.genresDuDJ(biblio, 18);
})();
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
  await p.addInitScript((DONNEES) => {
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
      'copySet crates dragPossible dragTrack exportSet filterGenres filters getConfig goutEtat goutOublier ' +
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
      filters: async () => ({ crates: [{ id: 'c1', name: 'Mariage', n: 312 }],
        etat: { crate: null, skipPlayed: false, noExplicit: false, bpmMin: 0, bpmMax: 0,
                genres: [], marge: 0, energyMin: 0, energyMax: 0 },
        restants: 22000, total: 22000, vide: false, active: false, bpm: 128 }),
      setFilters: async () => ({ restants: 4120, total: 22000, vide: false, active: true,
        etat: { crate: null, skipPlayed: false, noExplicit: false, bpmMin: 0, bpmMax: 0,
                genres: ['Disco'], marge: 0, energyMin: 0, energyMax: 0 } }),
      /* Les etiquettes de style, telles que main.js les lit dans la
         bibliotheque du DJ : son orthographe, ses habitudes. */
      filterGenres: async () => DONNEES.styles,
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
  }, { styles: STYLES });

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

    /* ------------------------------------------------------------
       Et le cas qui a change : la liste vide alors que tout va
       bien. Le widget servait « Rien ne se cale — aucun titre ne
       s'enchaine sur ce tempo » quelle que soit la cause reelle.
       main.js envoie maintenant un conseil sous la cle « vide » :
       le widget doit le servir plutot que sa phrase generique.
       ------------------------------------------------------------ */
    const avecCause = await p.evaluate(() => {
      const avant = { an: etatAn, now: typeof curNow !== 'undefined' ? curNow : null };
      etatAn = { library: 22000, analyses: 900, offline: 0, restants: 0, importing: false,
                 conseils: [{ cle: 'vide-filtres', quand: 'vide',
                              titre: 'Tes filtres ne laissent presque rien',
                              texte: '14 morceaux sur 22 000 passent tes filtres (un crate).',
                              marche: ['Ouvre FILTRES en bas du widget et desserre'] }] };
      curNow = { title: 'x', artist: 'y' };
      const html = etatVide();
      etatAn = avant.an; curNow = avant.now;
      return html;
    });
    verifier('6bis. la vraie cause remplace « rien ne se cale »',
             /filtres ne laissent/.test(avecCause) && !/s.enchaine sur ce tempo/.test(avecCause),
             avecCause.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 64) + '…');

    const sansCause = await p.evaluate(() => {
      const avant = { an: etatAn, now: typeof curNow !== 'undefined' ? curNow : null };
      etatAn = { library: 22000, analyses: 900, offline: 0, restants: 0, importing: false, conseils: [] };
      curNow = { title: 'x', artist: 'y' };
      const html = etatVide();
      etatAn = avant.an; curNow = avant.now;
      return html;
    });
    verifier('6ter. et sans diagnostic, l\'ancienne phrase tient encore',
             /Rien ne se cale/.test(sansCause) && /<li>/.test(sansCause));
  }

  /* ============================================================
     8. L'EN-TETE : ce qu'on sait, ce qu'on ne sait pas encore.

     « Pourquoi il dit Daddy Cool 0 BPM, ca te semble normal ? »
     Non. « Number(null).toFixed(1) » rendait « 0.0 » : un tempo
     ABSENT s'affichait comme un tempo mesure a zero, sur la ligne
     la plus lue du widget. Et « Analyse de la structure… » restait
     affiche a vie, y compris sur un morceau analyse depuis
     longtemps.
     ============================================================ */
  {
    const etat = async (now) => p.evaluate((n) => {
      renderNow(n);
      return {
        bpm: document.getElementById('refB').textContent,
        key: document.getElementById('refK').textContent,
        energie: document.getElementById('refE').textContent,
        ref: document.getElementById('refLbl').textContent,
        ruban: document.getElementById('striplbl').textContent,
        rubanCache: document.getElementById('striplbl').hidden
      };
    }, now);

    const brut = { id: 1, title: 'Daddy Cool', artist: 'Boney M.', key: null, bpm: null,
                   energy: 5, how: 'auto', mesure: false, structure: null };
    const a = await etat(brut);
    verifier('8. un tempo absent ne s\'affiche plus « 0,0 »',
             a.bpm !== '0,0' && a.bpm !== '0.0', 'affiche « ' + a.bpm + ' »');
    verifier('8bis. il dit que la mesure arrive', a.bpm === '…' && a.energie === '…',
             'tempo « ' + a.bpm + ' », energie « ' + a.energie + ' »');
    verifier('8ter. et le ruban annonce l\'analyse en cours',
             /Analyse de la structure/.test(a.ruban));

    /* Deux secondes plus tard : Liaison a mesure. */
    const mesure = Object.assign({}, brut, { bpm: 125.4, key: '8A', energy: 8, mesure: true,
      tempoDeduit: true,
      structure: { ok: true, duration: 300, readyAt: 8, outPoint: 280, introBars: 16,
                   outroBars: 32, breaks: [] } });
    const b = await etat(mesure);
    verifier('8quater. le tempo mesure apparait', b.bpm === '125,4', 'affiche « ' + b.bpm + ' »');
    verifier('8quinquies. et Liaison dit que la mesure vient de lui',
             /mesure par Liaison/.test(b.ref), b.ref);
    verifier('8sexies. le ruban cesse d\'annoncer une analyse',
             !/Analyse de la structure/.test(b.ruban), b.ruban.slice(0, 40));

    /* Et le cas ou l'analyse a tourne sans rien trouver. */
    const rien = Object.assign({}, brut, { bpm: 128, mesure: true, structure: { ok: false } });
    const c = await etat(rien);
    verifier('8septies. structure analysee sans resultat : on le dit',
             /Pas de structure nette/.test(c.ruban), c.ruban.slice(0, 44));
    verifier('8octies. et une tonalite introuvable devient « — », pas « … »',
             c.key === '—', 'affiche « ' + c.key + ' »');
  }

  /* ============================================================
     11. LES PROPOSITIONS ARRIVENT EN CASCADE.

     « qu'elles arrivent une par une avec un petit effet »

     Cinq lignes qui apparaissent ensemble sont un
     rafraichissement ; cinq lignes qui se posent l'une apres
     l'autre sont une reponse. Toute la difference tient dans le
     decalage, et un decalage est exactement le genre de detail
     qu'une refonte de CSS emporte sans que personne le remarque
     — puisque la liste continue de s'afficher.

     On verifie donc les trois proprietes qui font l'effet, et
     pas « il y a une animation » :
       - chaque ligne demarre APRES la precedente,
       - le decalage plafonne (sept suggestions ne font pas
         attendre un tiers de seconde de plus que cinq),
       - le remplissage est `backwards`, faute de quoi les cinq
         lignes clignotent ensemble avant de se decaler.
     ============================================================ */
  {
    const a = await p.evaluate((sug) => {
      renderSug(sug);
      return [].map.call(document.querySelectorAll('#list .row'), el => {
        const cs = getComputedStyle(el);
        return { nom: cs.animationName, delai: parseFloat(cs.animationDelay),
                 duree: parseFloat(cs.animationDuration), fill: cs.animationFillMode };
      });
    }, SUG);
    verifier('11. chaque proposition a une animation d\'arrivee',
             a.length > 0 && a.every(x => x.nom === 'arrivee'),
             a.map(x => x.nom).join(', '));
    verifier('11bis. et elles arrivent l\'une APRES l\'autre',
             a.every((x, i) => i === 0 ? x.delai === 0 : x.delai > a[i - 1].delai),
             a.map(x => Math.round(x.delai * 1000) + 'ms').join(' · '));
    verifier('11ter. invisible avant son tour (backwards)',
             a.every(x => /backwards|both/.test(x.fill)), a[0] && a[0].fill);
    /* Le dernier ne doit pas se faire attendre : au-dela d'un
       quart de seconde, en cabine, on attend la liste au lieu de
       la lire. */
    const dernier = a[a.length - 1];
    verifier('11quater. la derniere ligne n\'attend pas',
             dernier && (dernier.delai + dernier.duree) <= 0.6,
             dernier ? Math.round((dernier.delai + dernier.duree) * 1000) + ' ms au total' : '');

    /* Avec sept propositions — la formule Collectif — le
       decalage doit plafonner au lieu de s'allonger. */
    const sept = await p.evaluate((sug) => {
      /* SUG n'a que trois entrees : concat + slice(0,7) en rendait
         six, et l'essai denoncait un plafond qui marchait. On
         fabrique donc VRAIMENT sept lignes. */
      const l = Array.from({ length: 7 },
                           (_, i) => Object.assign({}, sug[i % sug.length], { id: 100 + i }));
      renderSug(l);
      return [].map.call(document.querySelectorAll('#list .row'),
                         el => parseFloat(getComputedStyle(el).animationDelay));
    }, SUG);
    verifier('11quinquies. le decalage plafonne a sept propositions',
             sept.length === 7 && sept[6] === sept[5],
             sept.map(d => Math.round(d * 1000)).join(' · '));
    await p.evaluate((sug) => renderSug(sug), SUG);
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

  /* ============================================================
     9. LA DENSITE : le widget doit vraiment RETRECIR.

     « le design du widget est mauvais : bien trop gros, ca cache
       tout quand on mixe »

     Le widget se disait deja « epousant son contenu » et ne l'a
     jamais fait : le corps etait a 100 % de la hauteur de la
     fenetre, donc la mesure rendait la hauteur de la fenetre
     elle-meme et l'ajustement ne se declenchait jamais. On mesure
     donc ici ce que le DJ voit : la somme des blocs empiles, cran
     par cran. S'ils cessent de decroitre, la promesse est cassee
     et cet essai doit tomber.
     ============================================================ */
  {
    await p.setViewportSize({ width: LARGEUR, height: 760 });
    const h = {};
    for (const d of ['grand', 'cabine', 'barre']) {
      h[d] = await p.evaluate((d) => {
        poserDensite(d, false);
        let t = 2;
        for (const el of document.body.children) {
          if (getComputedStyle(el).position === 'fixed') continue;
          t += el.getBoundingClientRect().height;
        }
        return Math.ceil(t);
      }, d);
    }
    verifier('9. chaque cran est plus court que le precedent',
             h.barre < h.cabine && h.cabine < h.grand,
             'barre ' + h.barre + ' / cabine ' + h.cabine + ' / grand ' + h.grand + ' px');
    /* L'ancienne fenetre etait figee a 548 px. Le cran le plus
       serre doit tenir largement en dessous, sinon on n'a rien
       gagne la ou le DJ en a besoin. */
    verifier('9bis. la barre tient sous 340 px', h.barre <= 340, h.barre + ' px');
    verifier('9ter. et SOS garde ses trois lettres meme en barre',
             await p.evaluate(() => {
               poserDensite('barre', false);
               return getComputedStyle(document.querySelector('#btnSos .w')).display !== 'none';
             }));
    /* Le pied tient sur UNE rangee : SOS relegue en deuxieme ligne,
       c'est le bouton d'urgence a l'endroit ou on le cherche le
       plus tard. */
    const rangees = await p.evaluate(() => {
      poserDensite('cabine', false);
      const btns = [...document.querySelectorAll('.foot > .seg, .foot > .chip')];
      /* On compte des RANGEES, pas des ordonnees.

         La version precedente groupait par `top` arrondi : les
         pastilles « mini » sont deux pixels plus courtes que les
         autres et centrees dans la rangee, donc leur haut tombe a
         381 quand celui des grandes tombe a 380. Une seule rangee
         visible etait comptee deux, et l'essai denoncait un
         retour a la ligne qui n'existait pas — pendant qu'un vrai
         debordement, lui, passait ailleurs inapercu.

         Deux boutons sont sur la meme rangee s'ils se CHEVAUCHENT
         verticalement. C'est la seule definition qui resiste a
         des hauteurs differentes. */
      const boites = btns.map(b => b.getBoundingClientRect())
                         .sort((a, z) => a.top - z.top);
      let n = 0, bas = -Infinity;
      for (const b of boites) {
        if (b.top >= bas) { n++; bas = b.bottom; }
        else if (b.bottom > bas) bas = b.bottom;
      }
      return n;
    });
    verifier('9quater. le pied tient sur une seule rangee', rangees === 1, rangees + ' rangee(s)');
    await p.evaluate(() => poserDensite('cabine', false));
  }

  /* ============================================================
     10. LES FILTRES : visibles sans etre ouverts, et effacables.

     « on ne voit pas que l'on a les filtres pour chercher des sons
       plus particulier »
     ============================================================ */
  {
    errs.length = 0;
    const vu = await p.evaluate(() => {
      const r = document.querySelector('#rail');
      return { affiche: getComputedStyle(r).display !== 'none',
               pastilles: r.querySelectorAll('.p').length,
               tiroir: document.querySelector('#tiroir').classList.contains('on') };
    });
    verifier('10. le rail de filtres est visible sans rien ouvrir',
             vu.affiche && vu.pastilles === 4, vu.pastilles + ' pastilles');
    verifier('10bis. et son tiroir reste replie', vu.tiroir === false);

    /* Les styles viennent de la bibliotheque du DJ, pas d'une liste
       maison : « prend ceux de la bibliotheque du dj (itunes,
       rekordbox, etc.. car chaque dj a son habitude) ». */
    await p.click('#pGenre');
    await p.waitForTimeout(150);
    const g = await p.evaluate(() => [...document.querySelectorAll('#gWrap button[data-g]')]
                                       .map(b => b.dataset.g));
    verifier('10ter. le tiroir sert les styles du DJ',
             g.includes('Variété française') && g.includes('Techno'), g.join(' · '));

    /* Une pastille allumee dit SUR QUOI elle est allumee : sinon il
       faut rouvrir le tiroir pour savoir ce qu'on a demande. */
    const pastille = await p.evaluate(() => {
      fEtat.genres = ['Disco', 'Techno']; fEtat.marge = 3;
      fEtat.energyMin = 6; fEtat.energyMax = 9;
      paintRail();
      return { g: document.querySelector('#pGenre b').textContent,
               t: document.querySelector('#pTempo b').textContent,
               e: document.querySelector('#pEnergie b').textContent,
               allume: document.querySelector('#pGenre').getAttribute('aria-pressed'),
               vider: document.querySelector('#railRaz').classList.contains('on') };
    });
    verifier('10quater. allumee, elle affiche sa valeur',
             pastille.allume === 'true' && /Disco/.test(pastille.g) &&
             /3/.test(pastille.t) && /6-9/.test(pastille.e),
             pastille.g + ' | ' + pastille.t + ' | ' + pastille.e);
    verifier('10quinquies. et « vider » apparait', pastille.vider === true);

    /* ------------------------------------------------------------
       Le coeur du reglage : « une fois que le son est joue, les
       filtres retournent par defaut ».

       C'est main.js qui efface et qui renvoie l'etat ; le widget
       doit CROIRE cet etat plutot que le sien. Sans ca, le rail
       resterait allume sur des filtres qui ne s'appliquent plus —
       le pire des deux mondes.
       ------------------------------------------------------------ */
    const apres = await p.evaluate(() => {
      window.__ecoute.filters({
        etat: { crate: null, skipPlayed: false, noExplicit: false, bpmMin: 0, bpmMax: 0,
                genres: [], marge: 0, energyMin: 0, energyMax: 0 },
        restants: 22000, total: 22000, vide: false, active: false });
      return { g: document.querySelector('#pGenre').getAttribute('aria-pressed'),
               t: document.querySelector('#pTempo').getAttribute('aria-pressed'),
               e: document.querySelector('#pEnergie').getAttribute('aria-pressed'),
               mot: document.querySelector('#pGenre b').textContent,
               vider: document.querySelector('#railRaz').classList.contains('on') };
    });
    verifier('10sexies. au morceau suivant, le rail s\'eteint tout seul',
             apres.g === 'false' && apres.t === 'false' && apres.e === 'false' &&
             apres.vider === false, apres.mot);
    verifier('10septies. sans rien jeter au passage', errs.length === 0, errs[0] || '');
    await p.evaluate(() => { if (panOuvert) ouvrirPan(panOuvert); });
  }

  await b.close();
  if (echecs) { console.error('\n' + echecs + ' probleme(s) sur l\'ecran principal.'); process.exit(1); }
  console.log('\nwidget : l\'ecran de cabine tient, etiquettes comprises.');
})();
