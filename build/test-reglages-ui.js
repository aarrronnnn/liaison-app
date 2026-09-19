'use strict';
/* ============================================================
   LA FENETRE DE PREPARATION, RENDUE POUR DE VRAI.

   Jusqu'ici la seule fenetre verifiee au rendu etait celle de la
   licence. Or c'est la fenetre de preparation qui porte onze
   rubriques, quarante boutons et le panneau qui vend — et c'est
   elle qui a accumule les defauts qu'on ne voit qu'a l'ecran :
   un « i » decentre dans son cercle, deux boutons d'achat
   identiques, un prix jamais affiche, quinze actions principales
   simultanees.

   Ce fichier rend la page dans un vrai navigateur avec un faux
   window.liaison, et verifie ce qui se MESURE :

     1. aucune erreur JS au chargement,
     2. le bloc qui vend est present sans licence, absent avec,
     3. les trois prix sont ecrits, et viennent bien du canal
        tarifs() — pas du HTML,
     4. une seule action principale par panneau,
     5. la pastille « i » est centree dans son cercle, au pixel,
     6. une ligne « possede » n'a pas de bouton d'achat, une
        ligne « manquante » en a exactement un.
   ============================================================ */
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) {} }
if (!chromium) {
  console.log('reglages : playwright absent — rendu de la fenetre non verifie.');
  process.exit(0);
}

const FICHIER = 'file://' + path.join(__dirname, '..', 'src', 'ui', 'settings.html');

const TARIFS = {
  lancement: true, moisOfferts: 2,
  plans: {
    pass:         { euro: '4,95',  euroPlein: '4,95',  barre: false },
    resident:     { euro: '14,95', euroPlein: '14,95', barre: false },
    resident_an:  { euro: '134',   euroPlein: '149',   barre: true, parMois: '11,17' },
    collectif:    { euro: '44,95', euroPlein: '44,95', barre: false },
    collectif_an: { euro: '404',   euroPlein: '449',   barre: true }
  }
};

/* Un classement mele : deux titres possedes, deux absents. C'est
   exactement le cas qui n'existait pas avant — la liste ne
   montrait que les absents. */
const CLASSEMENT = {
  etat: 'ok', source: 'Last.fm', zone: 'France', depuis: Date.now() - 3600e3,
  vus: 4, deja: 2,
  tout: [
    { rang: 1, artist: 'A', title: 'Un',     a: true,  achats: [] },
    { rang: 2, artist: 'B', title: 'Deux',   a: false, achats: [
        { id: 'beatport', name: 'Beatport', url: 'https://x' },
        { id: 'qobuz',    name: 'Qobuz',    url: 'https://y' }] },
    { rang: 3, artist: 'C', title: 'Trois',  a: true,  achats: [] },
    { rang: 4, artist: 'D', title: 'Quatre', a: false, soirees: 3, poids: 9, achats: [
        { id: 'beatport', name: 'Beatport', url: 'https://z' }] }
  ]
};
CLASSEMENT.titres = CLASSEMENT.tout.filter(x => !x.a);

const CAS = [
  { nom: 'essai en cours',  tier: 'trial',     trialLeft: 5, key: null, vend: true  },
  { nom: 'essai termine',   tier: 'expire',    trialLeft: 0, key: null, vend: true  },
  { nom: 'pass soiree',     tier: 'pass',      trialLeft: 0, key: 'LSN-1111-2222-3333', vend: true },
  { nom: 'resident paye',   tier: 'resident',  trialLeft: 0, key: 'LSN-AAAA-BBBB-CCCC', vend: false },
  { nom: 'collectif paye',  tier: 'collectif', trialLeft: 0, key: 'LSN-DDDD-EEEE-FFFF', vend: false }
];

/* addInitScript ne transmet QU'UN seul argument a la fonction
   injectee : les trois qu'on passait (etat, tarifs, classement)
   arrivaient en un seul objet, `tarifs` et `classement` etaient
   donc undefined cote page. Symptome trompeur : les prix
   restaient a « — » alors que le code de rendu etait bon. */
function faux(arg) {
  const st = arg.st, tarifs = arg.tarifs, classement = arg.classement;
  const rien = async () => ({});
  const liste = async () => [];
  window.__ouvert = [];
  window.liaison = {
    on: () => {}, off: () => {},
    /* La fenetre lit l'etat de licence dans getConfig().license au
       demarrage, PAS dans licenseStatus() — c'est ce chemin-la
       qu'il faut nourrir, sinon renderLic() sort en silence et la
       moitie de l'ecran reste vide sans la moindre erreur. */
    getConfig: async () => ({
      config: { pack: 'fr-club', source: 'rekordbox', theme: 'jour' },
      packs: [], libraryCount: 22180, license: st,
      countries: [{ id: 'fr', flag: '🇫🇷', label: 'France' }],
      events: [{ id: 'club', label: 'Club' }]
    }),
    setConfig: rien, pack: async () => ({ moments: [], dna: {}, avoid: [], tips: '' }),
    librarySources: liste, runningApps: liste, scanInfo: async () => null,
    licenseStatus: async () => st, licenseActivate: async () => ({ ok: true, status: st }),
    licenseRefresh: async () => ({ status: st }), licenseRelease: rien,
    licenseBuy: p => window.__ouvert.push(p),
    tarifs: async () => tarifs,
    majEtat: async () => ({ ok: true, courante: '1.5.0', derniere: '1.5.0', aJour: true,
                            notes: '', url: '' }),
    majOuvrir: rien, openExternal: rien, openLicence: rien, copy: rien, saveQR: rien,
    /* soireesListe rend { liste, active } — pas un tableau. Un
       faux qui rend [] fait jeter soirCharger() et interrompt tout
       le demarrage juste avant renderLic(). */
    soireesListe: async () => ({ liste: [], active: null }),
    soireeCreer: rien, soireeModifier: rien, soireeSupprimer: rien,
    soireeActiver: rien, soireeDesactiver: rien, soireeDupliquer: rien,
    clientGet: async () => ({ want: [], ban: [] }), clientClear: rien,
    clientImport: rien, clientShopping: async () => ({ lignes: [] }),
    goutEtat: async () => ({ n: 0 }), goutOublier: rien,
    healthScan: async () => ({ lignes: [] }), healthReveal: async () => ({ ok: true }),
    rescanLibrary: rien, startSession: async () => ({}), requests: liste,
    listSets: liste, setDebrief: async () => ({}), tracklist: async () => ({ lignes: [] }),
    exportSet: rien, copySet: rien, replaySet: async () => ({}),
    prepareBuild: async () => ({ titres: [] }), prepareExport: rien,
    aAvoir: async () => ({
      salle: [], client: [], classement: classement, total: 0, soirees: null,
      pays: { liste: [{ code: 'france', nom: 'France' }], choisi: '', parDefaut: 'france' }
    }),
    aAvoirOublier: rien, aAvoirVider: rien
  };
}

(async () => {
  let b;
  for (const essai of [undefined, process.env.CHROMIUM, '/opt/pw-browsers/chromium',
                       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (essai !== undefined && !essai) continue;
    try { b = await chromium.launch(essai ? { executablePath: essai } : undefined); break; }
    catch (e) {}
  }
  if (!b) { console.log('reglages : navigateur de test absent — rendu non verifie.'); process.exit(0); }

  let ko = 0;
  const dire = (nom, ok, detail) => {
    console.log((ok ? '  ok   ' : '  ECHEC') + ' ' + nom + (ok || !detail ? '' : ' — ' + detail));
    if (!ok) ko++;
  };

  for (const c of CAS) {
    const p = await b.newPage({ viewport: { width: 1100, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    /* Les .woff2 ne sont pas toujours a cote du HTML quand on rend
       la page hors de l'app : une police manquante n'est pas un
       defaut de la fenetre, et la confondre avec une erreur JS
       masquerait les vraies. */
    p.on('console', m => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_FILE_NOT_FOUND/.test(t)) return;
      errs.push('console: ' + t);
    });
    await p.addInitScript(faux, {
      st: {
        tier: c.tier, label: c.tier, trialLeft: c.trialLeft, key: c.key,
        deviceName: 'Mac de test', api: 'https://liaisondj.app',
        features: { suggestions: 5, sessions: true, replay: true }
      },
      tarifs: TARIFS,
      classement: CLASSEMENT
    });
    await p.goto(FICHIER);
    await p.waitForTimeout(900);

    console.log('\n— ' + c.nom);
    dire('aucune erreur JS', errs.length === 0, errs[0]);

    const r = await p.evaluate(() => {
      const sec = document.getElementById('licVente');
      const prix = [...document.querySelectorAll('[data-prix]')].map(n => n.textContent.trim());
      /* Une action principale = un <button> sans classe de
         retrogradation, visible, dans un panneau. */
      const parPan = {};
      document.querySelectorAll('.pan').forEach(pan => {
        const n = [...pan.querySelectorAll('button')].filter(x => {
          const cl = x.className || '';
          if (/\b(g|t|tuile|rnav|theme|aarf|x|voffre|dur|f)\b/.test(cl)) return false;
          /* Un seul panneau est affiche a la fois : on ne peut pas
             se fier a offsetParent, sinon dix panneaux sur onze ne
             seraient jamais examines. On ecarte donc ce qui est
             explicitement replie (hidden), et rien d'autre. */
          return !x.closest('[hidden]');
        });
        if (n.length) parPan[pan.dataset.pan || pan.id || '?'] = n.map(x => x.id || x.textContent.trim());
      });
      return {
        vend: !!sec && !sec.hidden,
        prix: prix,
        tarifLigne: (document.getElementById('licTarifs') || {}).textContent || '',
        licGo: (document.getElementById('licGo') || {}).className,
        pan: parPan,
        aalOk: document.querySelectorAll('.aal.ok').length,
        aalManque: document.querySelectorAll('.aal.manque').length,
        buyOk: document.querySelectorAll('.aal.ok .go a.buy').length,
        buyManque: document.querySelectorAll('.aal.manque .go a.buy').length,
        dans: document.querySelectorAll('.aal.ok .go .dans').length,
        score: (document.querySelector('.aascore-t') || {}).textContent || ''
      };
    });

    dire('bloc de vente ' + (c.vend ? 'present' : 'absent'), r.vend === c.vend);
    if (c.vend) {
      dire('trois prix affiches', r.prix.length === 3 && r.prix.every(x => /\d/.test(x)),
           JSON.stringify(r.prix));
      dire('prix venus de tarifs()', r.prix.join('|').includes('14,95'), JSON.stringify(r.prix));
      dire('formule annuelle citee', /134/.test(r.tarifLigne), r.tarifLigne.slice(0, 60));
      dire('« Activer » retrograde', r.licGo === 'g', r.licGo);
    } else {
      dire('« Activer » redevient principale', !r.licGo, r.licGo);
      dire('aucun prix a l\'ecran', !/\d+,\d\d\s*€/.test(r.tarifLigne), r.tarifLigne.slice(0, 60));
    }

    const trop = Object.entries(r.pan).filter(([, v]) => v.length > 1);
    dire('une seule action principale par panneau', trop.length === 0,
         trop.map(([k, v]) => k + ' : ' + v.join(', ')).join(' | '));

    /* ------------------------------------------------------------
       LE CONTRASTE, MESURE — PAS JUGE A L'OEIL.

       Quatre defauts de cette serie n'etaient visibles d'aucune
       autre facon : une opacite de .55 sur un chiffre de 22 px
       (2,07:1), une opacite de .8 sur une mention verte de 9 px
       (3,48:1), le rouge du drapeau employe comme couleur de
       texte (3,87:1), et un --ink3 mesure sur du blanc pur alors
       qu'aucun texte de l'app n'est pose sur du blanc pur.

       Tous les quatre PASSAIENT la relecture : sur un ecran
       correctement regle, a un metre, ca se lit encore. C'est en
       cabine, sur un portable a 30 % de luminosite, que ca
       disparait. D'ou la mesure.

       La regle appliquee est celle du WCAG AA : 4,5:1 pour le
       texte courant, 3:1 au-dela de 18 px (ou 14 px en gras).
       ------------------------------------------------------------ */
    const CONTRASTES = await p.evaluate(() => {
      const lum = c => {
        const v = c.map(x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
        return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
      };
      const nb = s => s.match(/[\d.]+/g).map(Number);
      /* L'opacite se cumule sur toute la chaine des parents : une
         mention a .8 dans une carte a .9 rend 0,72. C'est cette
         valeur-la qu'il faut fondre dans le fond, pas la sienne. */
      const opac = el => { let o = 1, n = el;
        while (n && n !== document.documentElement) { o *= parseFloat(getComputedStyle(n).opacity || 1); n = n.parentElement; }
        return o; };
      const fond = el => { let n = el;
        while (n) { const c = getComputedStyle(n).backgroundColor;
          if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { const a = nb(c); if (a.length < 4 || a[3] >= 1) return a.slice(0, 3); }
          n = n.parentElement; }
        return [255, 255, 255]; };
      const mesurer = (nom, sel) => {
        const el = document.querySelector(sel);
        if (!el) return { nom, absent: true };
        const cs = getComputedStyle(el), bg = fond(el), a = opac(el);
        const fg = nb(cs.color).slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a));
        const l1 = lum(fg), l2 = lum(bg);
        const px = parseFloat(cs.fontSize), gras = +cs.fontWeight >= 700;
        return { nom,
          ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
          min: (px >= 18 || (px >= 14 && gras)) ? 3 : 4.5, px: px };
      };
      return [
        mesurer('jauge : le chiffre',        '.aascore-t b'),
        mesurer('jauge : la legende',        '.aascore-t i'),
        mesurer('jauge : le pourcentage',    '.aascore-t u'),
        mesurer('possede : le titre',        '.aal.ok .nom b'),
        mesurer('possede : le rang',         '.aal.ok .cpt'),
        mesurer('possede : « tu l\'as »',     '.aal.ok .go .dans'),
        mesurer('manquant : le titre',       '.aal.manque .nom b'),
        mesurer('manquant : le rang',        '.aal.manque .cpt'),
        mesurer('manquant : bouton d\'achat', '.aal.manque .go a.buy'),
        mesurer('bouton discret',            'button.t'),
        mesurer('offre : le prix',           '.voffre b'),
        mesurer('offre : la difference',     '.voffre s'),
        mesurer('offre : la reassurance',    '.vRass')
      ];
    });
    for (const m of CONTRASTES) {
      if (m.absent) { dire('contraste — ' + m.nom, false, 'element absent'); continue; }
      dire('contraste — ' + m.nom, m.ratio >= m.min,
           m.ratio + ':1 a ' + m.px + 'px, il en faut ' + m.min);
    }

    if (c === CAS[0]) {
      /* ------------------------------------------------------------
         LA RECHERCHE.

         Onze rubriques et une soixantaine de reglages : l'index
         est RELEVE sur la page, jamais ecrit a la main, donc le
         seul moyen de savoir qu'il est juste est de poser de
         vraies questions et de lire les reponses.

         On verifie les trois proprietes qui font la fonction :
         l'accent ne compte pas (« cle » trouve « clé »), la
         reponse dit dans quelle rubrique c'est, et ouvrir un
         resultat descend vraiment sur le reglage au lieu de
         poser le DJ en haut d'un panneau de soixante lignes.
         ------------------------------------------------------------ */
      const demander = async (q) => {
        await p.fill('#rechQ', '');
        await p.focus('#rechQ');
        await p.type('#rechQ', q, { delay: 4 });
        await p.waitForTimeout(140);
        return p.evaluate(() => {
          const b = document.getElementById('rechR');
          if (b.hidden) return [];
          return [].map.call(b.querySelectorAll('.rechl'), l => ({
            titre: l.querySelector('.q').textContent.trim(),
            ou: l.querySelector('.ou').textContent.trim()
          }));
        });
      };

      const rSpot = await demander('spotify');
      dire('recherche : « spotify » mene au Client',
           rSpot.some(x => /client/i.test(x.ou) || /client/i.test(x.titre)),
           JSON.stringify(rSpot.slice(0, 2)));

      const rCle = await demander('cle');
      dire('recherche : « cle » sans accent trouve « clé »',
           rCle.some(x => /cl[ée]/i.test(x.titre) || /licence/i.test(x.titre)),
           JSON.stringify(rCle.slice(0, 2)));

      const rSer = await demander('serato');
      dire('recherche : « serato » trouve le logiciel de mix',
           rSer.length > 0, JSON.stringify(rSer.slice(0, 2)));

      const rRes = await demander('resident');
      dire('recherche : « resident » trouve l\'offre',
           rRes.some(x => /r[ée]sident/i.test(x.titre)), JSON.stringify(rRes));

      /* Le bruit est un defaut, pas un detail : « port » renvoyait
         quatre « Exporter en… » parce que la recherche acceptait
         n'importe quelle sous-chaine. On ne cherche plus qu'au
         debut des mots. */
      const rPort = await demander('port');
      dire('recherche : « port » ne ramene aucun « Exporter »',
           !rPort.some(x => /^exporter/i.test(x.titre)),
           JSON.stringify(rPort.map(x => x.titre)));

      const rVide = await demander('zzzqqq');
      dire('recherche : un mot introuvable ne propose rien',
           rVide.length === 0, JSON.stringify(rVide));

      /* Chaque resultat dit OU il est, et jamais en repetant son
         propre nom des deux cotes. */
      const rTout = await demander('soiree');
      dire('recherche : chaque resultat nomme sa rubrique',
           rTout.length > 0 && rTout.every(x => x.ou && x.ou !== x.titre),
           JSON.stringify(rTout.slice(0, 3)));

      /* Ouvrir : la rubrique, l'endroit, le clignotement. */
      await demander('spotify');
      const saut = await p.evaluate(async () => {
        const lignes = document.querySelectorAll('#rechR .rechl');
        /* la deuxieme ligne est un REGLAGE, pas la rubrique :
           c'est celle qui doit faire descendre puis clignoter */
        const l = lignes[1] || lignes[0];
        l.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await new Promise(r => setTimeout(r, 400));
        const on = document.querySelector('.pan.on');
        return {
          pan: on && on.querySelector('.hn') ? on.querySelector('.hn').textContent.trim() : '',
          marque: !!document.querySelector('.trouve'),
          ferme: document.getElementById('rechR').hidden
        };
      });
      dire('recherche : ouvrir un resultat change de rubrique', /client/i.test(saut.pan), saut.pan);
      dire('recherche : et fait clignoter le reglage vise', saut.marque === true);
      dire('recherche : la liste se referme apres', saut.ferme === true);
      await p.fill('#rechQ', '');

      dire('le classement montre aussi ce qu\'on a', r.aalOk === 2 && r.aalManque === 2,
           r.aalOk + ' possedes / ' + r.aalManque + ' manquants');
      dire('aucun bouton d\'achat sur un titre possede', r.buyOk === 0, String(r.buyOk));
      dire('un seul bouton d\'achat par manque', r.buyManque === 2, String(r.buyManque));
      dire('la coche « tu l\'as » est la', r.dans === 2, String(r.dans));
      dire('le score compte juste', /2/.test(r.score) && /4/.test(r.score), r.score.trim());

      /* La pastille « i », mesuree. On rend le SVG en grand et on
         compare le centre de l'encre au centre du cercle. Un
         glyphe de police ne passait pas ce test : la ligne de
         base le posait deux pixels trop bas. */
      const centre = await p.evaluate(() => {
        const sv = document.querySelector('details.aide>summary svg.rd');
        if (!sv) return null;
        const c = sv.querySelector('circle[fill="none"]');
        const pt = sv.querySelector('circle[fill="currentColor"]');
        const re = sv.querySelector('rect');
        return {
          cx: +c.getAttribute('cx'), cy: +c.getAttribute('cy'),
          ptx: +pt.getAttribute('cx'),
          rx: +re.getAttribute('x') + (+re.getAttribute('width')) / 2,
          haut: +pt.getAttribute('cy') - +pt.getAttribute('r'),
          bas: +re.getAttribute('y') + (+re.getAttribute('height')),
          r: +c.getAttribute('r')
        };
      });
      if (!centre) dire('pastille « i » presente', false, 'svg absent');
      else {
        dire('« i » centre horizontalement',
             centre.ptx === centre.cx && centre.rx === centre.cx,
             'point ' + centre.ptx + ', hampe ' + centre.rx + ', cercle ' + centre.cx);
        const milieu = (centre.haut + centre.bas) / 2;
        dire('« i » centre verticalement (±0,25 px)',
             Math.abs(milieu - centre.cy) <= 0.25,
             'encre centree en ' + milieu.toFixed(2) + ', cercle en ' + centre.cy);
        dire('« i » tient dans le cercle',
             centre.haut > centre.cy - centre.r && centre.bas < centre.cy + centre.r,
             centre.haut + ' → ' + centre.bas);
      }
    }
    await p.close();
  }

  await b.close();
  console.log('\n' + (ko ? ko + ' ECHEC(S)' : 'reglages : tout est verifie.'));
  process.exit(ko ? 1 : 0);
})();
