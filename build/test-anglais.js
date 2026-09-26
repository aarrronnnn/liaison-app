'use strict';
/* ============================================================
   LIAISON EN ANGLAIS.

   Le traducteur (src/ui/i18n.js) et son dictionnaire (i18n-en.js).
   On verifie la mecanique — phrases fixes, phrases fabriquees,
   nombres, ce qui ne doit JAMAIS etre traduit — puis on ouvre le
   vrai widget en anglais et on cherche du francais qui depasse.
   ============================================================ */
const path = require('path');
const fs = require('fs');
const I = require('../src/ui/i18n.js');
const EN = require('../src/ui/i18n-en.js');
const T = I.creer(EN);

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(62) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
console.log('interface anglaise\n');

/* ---------- 1. la mecanique ---------- */
const cas = [
  ['Afficher le widget', 'Show widget'],
  ['Reglages…', 'Settings…'],
  ['22 000 titres', '22,000 tracks'],
  ['121,4', '121.4'],
  ['−1,5 %', '−1.5%'],
  ['4,95 €', '€4.95'],
  ['LIEU', 'VENUE'],
  ['· Cut sur le drop', '· Cut on the drop'],
  ['Licence : Essai (5 j)', 'License: Trial (5 d)']
];
for (const [fr, en] of cas) {
  const r = T.traduire(fr);
  verifier('« ' + fr + ' » → « ' + en + ' »', r === en, r);
}
const f = T.traduire('340 titres retires : fichier introuvable');
verifier('phrase fabriquee : les nombres suivent', /340/.test(f || '') && !/titres|retires/.test(f || ''), f);
verifier('une phrase inconnue n\'est pas massacree', T.traduire('Around the World') == null);

/* ---------- 2. le dictionnaire ---------- */
{
  const mauvais = [];
  for (const [k, v] of Object.entries(EN)) {
    if (typeof v !== 'string') { mauvais.push(k + ' (valeur non texte)'); continue; }
    const pk = new Set((k.match(/\{\d+\}/g) || []));
    for (const p of (v.match(/\{\d+\}/g) || [])) if (!pk.has(p)) mauvais.push(k + ' → ' + p + ' inconnu');
  }
  verifier('chaque {n} anglais existe dans la phrase francaise', mauvais.length === 0, mauvais.slice(0, 3).join(' | '));
  verifier('dictionnaire fourni (plus de 1 300 phrases)', Object.keys(EN).length > 1300, Object.keys(EN).length);
}

/* ---------- 3. le vrai widget, en anglais ---------- */
let chromium = null;
try { chromium = require('playwright').chromium; } catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) {} }
(async () => {
  if (!chromium) { console.log('  (playwright absent — rendu anglais non verifie)'); return fin(); }
  let b;
  for (const essai of [undefined, process.env.CHROMIUM, '/opt/pw-browsers/chromium',
                       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (essai !== undefined && !essai) continue;
    try { b = await chromium.launch(essai ? { executablePath: essai } : undefined); break; } catch (e) {}
  }
  if (!b) { console.log('  (navigateur absent — rendu anglais non verifie)'); return fin(); }
  /* Le faux pont est celui de test-widget.js, repris tel quel. */
  const src = fs.readFileSync(path.join(__dirname, 'test-widget.js'), 'utf8');
  const debut = src.indexOf('await p.addInitScript(');
  const finI = src.indexOf('}, { styles: STYLES });', debut);
  const init = src.slice(debut + 'await p.addInitScript('.length, finI + 1);
  const p = await b.newPage({ viewport: { width: 344, height: 700 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(eval('(' + init + ')'), { styles: [] });
  await p.goto('file://' + path.join(__dirname, '..', 'src', 'ui', 'widget.html') + '?lang=en');
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    window.__ecoute.now && window.__ecoute.now({ id: 1, title: 'Around the World', artist: 'Daft Punk',
      key: '8A', bpm: 121.4, energy: 7, how: 'deck', mesure: true });
    renderSug([{ id: 2, title: 'Voyage voyage', artist: 'Desireless', key: '8B', bpm: 132, energy: 8,
      total: 73, transition: 'Cut sur le drop', why: 'x', delta: 1.5, trend: 75, client: true, cloture: true,
      horsBulle: true, relance: true, deja: { texte: 'DEJA PASSE', grave: true } }]);
  });
  await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    const fr = /[éèêàùçôîœ]|\b(le|la|les|des|une|pour|avec|pas|ton|ta|tes|dans|morceaux?|titres?|soir[ée]es?|r[ée]glages|biblioth[èe]que|essai|licence)\b/i;
    const out = [];
    const w = document.createTreeWalker(document.body, 4);
    let n;
    while ((n = w.nextNode())) {
      const t = n.nodeValue.trim();
      if (!t || !fr.test(t)) continue;
      let e = n.parentElement, brut = false;
      while (e) { if (e.hasAttribute('data-brut') || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') { brut = true; break; } e = e.parentElement; }
      if (!brut) out.push(t);
    }
    return { reste: out, lang: document.documentElement.lang,
             titre: document.querySelector('#list .n') && document.querySelector('#list .n').textContent,
             badges: document.querySelector('#list .mm') && document.querySelector('#list .mm').textContent };
  });
  verifier('le widget s\'ouvre en anglais sans erreur', errs.length === 0 && r.lang === 'en', errs[0]);
  verifier('aucun texte francais visible', r.reste.length === 0, r.reste.slice(0, 4).join(' | '));
  verifier('le titre du morceau n\'est jamais traduit', r.titre === 'Voyage voyage', r.titre);
  verifier('les etiquettes passent en anglais', /CLOSER/.test(r.badges) && /REQUESTED/.test(r.badges) && /Cut on the drop/.test(r.badges), r.badges);
  await b.close();
  fin();
})().catch(e => { console.error(e); process.exit(1); });

function fin() {
  console.log('\n' + (ko ? ko + ' RATE(S)' : 'anglais : l\'interface parle anglais, et ne touche pas a la musique du DJ.'));
  process.exit(ko ? 1 : 0);
}
