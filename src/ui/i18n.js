/* ============================================================
   Liaison en anglais — le traducteur.

   L'interface est ecrite en francais, dans le code, partout : trois
   fenetres, le processus principal qui envoie ses messages, le
   moteur qui nomme ses transitions. Plutot que de reecrire six mille
   lignes autour d'une fonction t(), on traduit ce qui ARRIVE a
   l'ecran : chaque texte pose dans la page, a l'instant ou il est
   pose, est cherche dans le dictionnaire (i18n-en.js).

     — une phrase fixe est trouvee telle quelle ;
     — une phrase fabriquee (« 340 titres retires ») est reconnue par
       son MOTIF : le dictionnaire garde « {0} titre{1} retire{2} »,
       et chaque {n} attrape ce que le code y a mis ;
     — une ligne faite de morceaux (« 8A · Accord parfait ») est
       traduite morceau par morceau.

   Ce qui vient du DJ — titres, artistes, noms de soiree, genres de
   sa bibliotheque — n'est jamais touche : tout element marque
   data-brut (et ses enfants) est ignore.

   Le traducteur s'observe lui-meme : un texte qu'il vient d'ecrire
   ne repasse pas dans la moulinette. Et une page francaise ne le
   charge meme pas.
   ============================================================ */
(function (racine) {
  'use strict';

  function fabriquer(EN) {
    const exact = new Map();
    const motifs = [];
    const plat = s => String(s).replace(/[\s\u00a0\u202f]+/g, ' ').replace(/[\u2019\u2018]/g, "'").trim();
    const sansAccents = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const k of Object.keys(EN)) {
      const v = EN[k];
      if (v == null) continue;
      const cle = plat(k);
      if (/\{\d+\}/.test(cle)) {
        /* Le motif : chaque {n} attrape n'importe quoi (le moins
           possible) ; le reste doit correspondre au caractere pres,
           accents compris ou non. */
        const morceaux = cle.split(/(\{\d+\})/);
        const noms = [];
        let src = '^';
        let fixe = '';
        for (const m of morceaux) {
          const p = /^\{(\d+)\}$/.exec(m);
          if (p) { noms.push(+p[1]); src += '(.*?)'; }
          else {
            if (m.replace(/\W/g, '').length > fixe.replace(/\W/g, '').length) fixe = m;
            /* Chaque lettre accepte ses accents : « retire » attrape
               « retiré ». On cherche dans la forme decomposee (NFD) du
               texte, et les valeurs attrapees gardent leurs accents. */
            src += sansAccents(m).split('').map(c =>
              /[A-Za-z]/.test(c) ? c + '[\\u0300-\\u036f]*'
              : c === ' ' ? '\\s+'
              : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
          }
        }
        src += '$';
        /* Un motif dont la partie fixe tient en trois lettres (« de {0} »,
           « {0} et {1} ») attraperait n'importe quel bout de phrase et le
           massacrerait : on les ecarte. */
        if (fixe.replace(/[^A-Za-z\u00c0-\u00ff]/g, '').length < 4) continue;
        try { motifs.push({ re: new RegExp(src, 's'), noms, en: v, indice: sansAccents(fixe).trim().toLowerCase() }); }
        catch (e) { /* motif illisible : on s'en passe */ }
      } else {
        exact.set(cle, v);
        const sa = sansAccents(cle);
        if (!exact.has(sa)) exact.set(sa, v);
        /* « — garde sur cet ordinateur. » se retrouve aussi sans son
           tiret, quand une ligne est decoupee sur ses separateurs. */
        const m = /^([—–·•-])\s+(.+)$/.exec(cle), mv = /^([—–·•-])\s+(.+)$/.exec(v);
        if (m && !exact.has(m[2])) exact.set(m[2], mv ? mv[2] : v);
      }
    }
    /* Les motifs les plus precis d'abord : plus de texte fixe, moins d'ambiguite. */
    motifs.sort((a, b) => b.indice.length - a.indice.length);
    return { exact, motifs, plat, sansAccents };
  }

  /* 22 000 → 22,000 · 121,4 → 121.4 : les nombres a l'anglaise. */
  function nombreEn(s) {
    const t = String(s);
    /* 22 000 (ou 22 000,5) : espaces de milliers → virgules, virgule decimale → point */
    let m = /^([-+\u2212]?)(\d{1,3}(?:[\s\u00a0\u202f]\d{3})+)(?:,(\d+))?(\s?%)?$/.exec(t);
    if (m) return m[1] + m[2].replace(/[\s\u00a0\u202f]/g, ',') + (m[3] ? '.' + m[3] : '') + (m[4] ? '%' : '');
    /* 121,4 · -1,5 % : une ou deux decimales = une virgule decimale.
       (« 22,000 » a trois chiffres : c'est deja un nombre anglais.) */
    m = /^([-+\u2212]?\d+),(\d{1,2})(\s?%)?$/.exec(t);
    if (m) return m[1] + '.' + m[2] + (m[3] ? '%' : '');
    m = /^([-+\u2212]?\d+)\s%$/.exec(t);
    if (m) return m[1] + '%';
    return t;
  }

  function creer(EN) {
    const D = fabriquer(EN);
    const memo = new Map();

    function simple(t) {
      if (D.exact.has(t)) return D.exact.get(t);
      const sa = D.sansAccents(t);
      if (D.exact.has(sa)) return D.exact.get(sa);
      /* Un mot seul, quelle que soit sa casse : « Lieu », « LIEU », « lieu ». */
      if (/^[A-Za-zÀ-ÿœ'’]+$/.test(t)) {
        const bas = t.toLowerCase();
        const v = D.exact.get(bas) || D.exact.get(D.sansAccents(bas));
        if (v != null) {
          if (t === t.toUpperCase() && t.length > 1) return v.toUpperCase();
          if (t[0] === t[0].toUpperCase()) return v.charAt(0).toUpperCase() + v.slice(1);
          return v;
        }
      }
      return null;
    }

    function parMotif(t) {
      const bas = D.sansAccents(t).toLowerCase();
      const nfd = t.normalize('NFD');
      for (const m of D.motifs) {
        if (m.indice && bas.indexOf(m.indice) < 0) continue;
        const r = m.re.exec(nfd);
        if (!r) continue;
        const valeurs = {};
        m.noms.forEach((n, i) => { valeurs[n] = (r[i + 1] || '').normalize('NFC'); });
        return m.en.replace(/\{(\d+)\}/g, (x, n) => {
          const v = valeurs[n];
          if (v == null) return '';
          const tv = v.trim() ? traduire(v, true) : null;
          return nombreEn(tv != null ? v.replace(v.trim(), tv) : v);
        });
      }
      return null;
    }

    /* Une ligne composee : « 8A · Accord parfait · 3 min ». */
    function parMorceaux(t) {
      for (const sep of [' · ', ' — ', ' – ', ' | ']) {
        if (t.indexOf(sep) < 0) continue;
        const parts = t.split(sep);
        let change = false;
        const out = parts.map(p => {
          const tp = p.trim();
          if (!tp) return p;
          const r = traduire(tp, true);
          if (r != null && r !== tp) { change = true; return p.replace(tp, r); }
          return p;
        });
        if (change) return out.join(sep);
      }
      return null;
    }

    /* « Titre : suite » — le libelle avant les deux-points. */
    function parLibelle(t) {
      const m = /^([^:]{2,40}) ?: (.+)$/.exec(t);
      if (!m) return null;
      const a = traduire(m[1].trim(), true), b = traduire(m[2].trim(), true);
      if (a == null && b == null) return null;
      return (a != null ? a : m[1]) + ': ' + (b != null ? b : m[2]);
    }

    /* Quelques abreviations trop courtes pour un motif. */
    const REGLES = [
      [/^É ?(\d[\d\s–-]*)$/, 'E $1'],
      [/^(\d+) j$/, '$1 d'],
      [/^(\d+) h (\d+)$/, '$1 h $2'],
      /* les prix : 4,95 € → €4.95 · 134 € → €134 */
      [/^(\d+),(\d{2})\s?€$/, '€$1.$2'],
      [/^(\d+)\s?€$/, '€$1'],
      [/^(\d+),(\d{2})\s?€\/mois$/, '€$1.$2/month']
    ];
    function traduire(texte, interne) {
      if (texte == null) return null;
      const t = D.plat(texte);
      if (!t || t.length > 2000) return null;
      if (!/[A-Za-zÀ-ÿ]/.test(t)) {
        /* Un nombre seul : « 121,4 », « -1,5 % » → 121.4, -1.5% ; un prix : 4,95 € → €4.95 */
        for (const [re, rep] of REGLES) if (re.test(t)) return t.replace(re, rep);
        const n = nombreEn(t);
        return n !== t ? n : null;
      }
      if (memo.has(t)) return memo.get(t);
      let r = simple(t);
      if (r == null) for (const [re, rep] of REGLES) if (re.test(t)) { r = t.replace(re, rep); break; }
      if (r == null) {
        /* « · É 9 · … » : un separateur en tete, puis le reste. */
        const m = /^([·—–•|,]\s+)?(.+?)(\s+[·—–•|,])?$/.exec(t);
        if (m && (m[1] || m[3])) { const x = traduire(m[2], true); if (x != null) r = (m[1] || '') + x + (m[3] || ''); }
      }
      if (r == null) r = parMotif(t);
      if (r == null) r = parMorceaux(t);
      if (r == null && !interne) r = parLibelle(t);
      /* Une phrase finie par un point que le dictionnaire connait sans. */
      if (r == null && /[.…!?]$/.test(t)) {
        const s = simple(t.replace(/[.…!?]+$/, ''));
        if (s != null) r = s + t.match(/[.…!?]+$/)[0];
      }
      if (memo.size > 5000) memo.clear();
      memo.set(t, r);
      return r;
    }

    return { traduire, nombreEn };
  }

  /* ---------------- dans une page ---------------- */
  function brancherPage(win, T) {
    const doc = win.document;
    const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
    const ecrits = new WeakSet();

    const ignore = el => {
      for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
        if (e.hasAttribute && (e.hasAttribute('data-brut') || e.hasAttribute('data-no-i18n'))) return true;
        const tn = e.tagName;
        if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'TEXTAREA' || tn === 'CODE') return true;

      }
      return false;
    };

    const champ = el => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    function texteNoeud(n) {
      if (ecrits.has(n)) { ecrits.delete(n); return; }
      const v = n.nodeValue;
      if (!v || !/[A-Za-zÀ-ÿ0-9]/.test(v)) return;
      if (n.parentElement && ignore(n.parentElement)) return;
      const r = T.traduire(v);
      if (r == null || r === v.trim()) return;
      const avant = /^\s*/.exec(v)[0], apres = /\s*$/.exec(v)[0];
      ecrits.add(n);
      n.nodeValue = avant + r + apres;
    }
    function attributs(el) {
      /* Un champ de saisie garde ce qu'on y tape, mais son indication
         (placeholder) et sa bulle d'aide se traduisent. */
      if (champ(el) ? (el.hasAttribute('data-brut') || el.hasAttribute('data-no-i18n') || (el.parentElement && ignore(el.parentElement))) : ignore(el)) return;
      for (const a of ATTRS) {
        const v = el.getAttribute && el.getAttribute(a);
        if (!v) continue;
        const r = T.traduire(v);
        if (r != null && r !== v) el.setAttribute(a, r);
      }
      if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) {
        const r = T.traduire(el.value);
        if (r != null) el.value = r;
      }
    }
    function parcourir(racineNoeud) {
      if (!racineNoeud) return;
      if (racineNoeud.nodeType === 3) { texteNoeud(racineNoeud); return; }
      if (racineNoeud.nodeType !== 1 && racineNoeud.nodeType !== 11) return;
      if (racineNoeud.nodeType === 1) { if (ignore(racineNoeud)) return; attributs(racineNoeud); }
      const w = doc.createTreeWalker(racineNoeud, 5 /* ELEMENT | TEXT */, {
        acceptNode: n => (n.nodeType === 1 && (n.hasAttribute('data-brut') || n.hasAttribute('data-no-i18n') ||
                          n.tagName === 'SCRIPT' || n.tagName === 'STYLE')) ? 2 : 1
      });
      let n;
      while ((n = w.nextNode())) { if (n.nodeType === 3) texteNoeud(n); else attributs(n); }
    }

    doc.documentElement.lang = 'en';
    if (doc.title) { const r = T.traduire(doc.title); if (r) doc.title = r; }
    parcourir(doc.body || doc.documentElement);
    const obs = new win.MutationObserver(liste => {
      for (const m of liste) {
        if (m.type === 'characterData') texteNoeud(m.target);
        else if (m.type === 'attributes') { if (ATTRS.includes(m.attributeName)) attributs(m.target); }
        else for (const n of m.addedNodes) parcourir(n);
      }
    });
    obs.observe(doc.documentElement, { subtree: true, childList: true, characterData: true,
                                       attributes: true, attributeFilter: ATTRS });

    localesAnglaises(win);
    win.LiaisonT = T;
  }

  /* Les dates et les nombres formates « fr-FR » dans le code. */
  function localesAnglaises(win) {
    if (win.__localesEn) return;
    win.__localesEn = true;
    const redirige = loc => (loc === 'fr-FR' || loc === 'fr' || loc === undefined) ? 'en-GB' : loc;
    const nts = win.Number.prototype.toLocaleString;
    win.Number.prototype.toLocaleString = function (loc, o) { return nts.call(this, redirige(loc), o); };
    const D = win.Date.prototype;
    for (const f of ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']) {
      const orig = D[f];
      D[f] = function (loc, o) { return orig.call(this, redirige(loc), o); };
    }
    if (win.Intl && win.Intl.DateTimeFormat) {
      const DTF = win.Intl.DateTimeFormat;
      const F = function (loc, o) { return new DTF(redirige(loc), o); };
      F.prototype = DTF.prototype;
      F.supportedLocalesOf = DTF.supportedLocalesOf;
      win.Intl.DateTimeFormat = F;
    }
    if (win.Intl && win.Intl.NumberFormat) {
      const NF = win.Intl.NumberFormat;
      const G = function (loc, o) { return new NF(redirige(loc), o); };
      G.prototype = NF.prototype;
      G.supportedLocalesOf = NF.supportedLocalesOf;
      win.Intl.NumberFormat = G;
    }
  }

  /* La langue de la page : ?lang=en dans l'adresse (pose par main.js). */
  function langueDeLaPage(win) {
    try {
      const q = new win.URLSearchParams(win.location.search);
      if (q.get('lang')) return q.get('lang');
    } catch (e) {}
    try { if (win.LIAISON_LANGUE) return win.LIAISON_LANGUE; } catch (e) {}
    return 'fr';
  }

  const api = { creer, nombreEn, brancherPage, langueDeLaPage };
  /* Pour les rares phrases qu'une page prefere construire elle-meme
     dans les deux langues (des chiffres en gras au milieu d'une phrase). */
  try { if (typeof window !== 'undefined') window.enAnglais = () => langueDeLaPage(window) === 'en'; } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    racine.LiaisonI18n = api;
    try {
      if (langueDeLaPage(racine) === 'en' && racine.LIAISON_EN) {
        const T = creer(racine.LIAISON_EN);
        localesAnglaises(racine);          /* avant que les scripts de la page formatent quoi que ce soit */
        const go = () => brancherPage(racine, T);
        if (racine.document.body) go();
        else racine.document.addEventListener('DOMContentLoaded', go, { once: true });
      }
    } catch (e) { /* un traducteur en panne ne doit jamais casser la page */ }
  }
})(typeof window !== 'undefined' ? window : this);
