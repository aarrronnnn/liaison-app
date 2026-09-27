'use strict';
/* ============================================================
   LA CARTE DE SOIREE (1.10).
   Elle se dessine dans tous les cas qu'une vraie soiree peut
   produire — nom interminable, une seule heure, pas de tempo, pas
   de demandes, pas d'enchainement mesure — sans lever d'erreur et
   aux dimensions attendues des stories et des publications.
   ============================================================ */
const path = require('path');
let chromium = null;
try { chromium = require('playwright').chromium; } catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) {} }
let ko = 0;
const dire = (q, ok, d) => { console.log('  ' + (ok ? 'ok   ' : 'RATE ') + q + (ok || d == null ? '' : '  — ' + d)); if (!ok) ko++; };
console.log('carte de soiree\n');
(async () => {
  if (!chromium) { console.log('  (playwright absent — carte non verifiee)'); return; }
  let b;
  for (const essai of [undefined, process.env.CHROMIUM, '/opt/pw-browsers/chromium']) {
    if (essai !== undefined && !essai) continue;
    try { b = await chromium.launch(essai ? { executablePath: essai } : undefined); break; } catch (e) {}
  }
  if (!b) { console.log('  (navigateur absent — carte non verifiee)'); return; }
  const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, '..', 'src', 'ui', 'settings.html').replace(/\\/g, '/') + '?test=carte').catch(() => {});
  await p.addScriptTag({ path: path.join(__dirname, '..', 'src', 'ui', 'carte.js') });
  const plein = { nom: 'Mariage Léa & Sam', quand: '2026-09-26T19:02:00Z', morceaux: 38, minutes: 172,
    pic: { h: 23, e: 8.6, n: 9 }, courbe: [{ h: 21, e: 5.1 }, { h: 22, e: 7.2 }, { h: 23, e: 8.6 }], artistes: 34,
    tempo: { min: 98, max: 148, median: 122 }, demandes: { recues: 23, jouees: 14 },
    variete: { top: [{ nom: 'disco', part: 28 }, { nom: 'house', part: 22 }] },
    enchainements: { medianeHarmonie: 93, meilleurs: [{ note: 98, de: 'Lady (Hear Me Tonight)', deA: 'Modjo', vers: 'Music Sounds Better With You', versA: 'Stardust', cle: '2A → 3B', tempo: 1.6, quand: '22:14' }] } };
  const cas = {
    'soiree complete': [plein, {}],
    'nom interminable': [Object.assign({}, plein, { nom: 'Anniversaire surprise des trente ans de Karim et de sa soeur jumelle au Domaine du Bois Joli' }), {}],
    'une seule heure': [Object.assign({}, plein, { courbe: [{ h: 23, e: 7 }] }), {}],
    'rien de mesure': [{ nom: '', morceaux: 3, minutes: 9, courbe: [], enchainements: {} }, {}],
    'sans titres ni nom, en anglais': [plein, { nom: false, titres: false, en: true, dj: 'DJ Un Nom Tres Tres Long Pour Voir @quelquechose' }]
  };
  for (const [nom, [d, o]] of Object.entries(cas)) for (const format of ['story', 'post']) {
    const r = await p.evaluate(([d, o]) => {
      try {
        const cv = document.createElement('canvas');
        window.LiaisonCarte.dessiner(cv, d, o);
        return { w: cv.width, h: cv.height, png: cv.toDataURL('image/png').slice(0, 22) };
      } catch (e) { return { err: e.message }; }
    }, [d, Object.assign({ format }, o)]);
    dire(nom + ' (' + format + ')', !r.err && r.w === 1080 && r.h === (format === 'post' ? 1350 : 1920) && r.png === 'data:image/png;base64,',
         r.err || (r.w + 'x' + r.h));
  }
  await b.close();
})().then(() => {
  console.log('\n' + (ko ? ko + ' echec(s).' : 'carte de soiree : elle se dessine, quoi que la nuit ait donne.'));
  process.exit(ko ? 1 : 0);
}).catch(e => { console.error(e); process.exit(1); });
