'use strict';
/* ============================================================
   LES DEMANDES DES INVITES, DE BOUT EN BOUT.

   Un vrai telephone (Chromium en taille iPhone, en francais puis en
   anglais) ouvre la vraie page, cherche dans la vraie bibliotheque,
   demande un morceau — et on verifie que le DJ la recoit, que les
   regles tiennent, et que le telephone voit « passe ✓ » quand le
   morceau part.

   Deux chemins :
     A. le Wi-Fi du lieu : la page servie par l'ordinateur du DJ ;
     B. le relais liaisondj.app : la page du site, l'API du site (avec
        un magasin en memoire), et le client relais de l'application
        qui depose l'etat et releve les demandes — comme en vrai.
        Joue seulement si liaison-web est a cote (ou LIAISON_WEB).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { GuestServer } = require('../src/session');
const inv = require('../src/invites');
const { Relais } = require('../src/relais');
const { keyOf } = require('../src/engine');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(64) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
console.log('demandes des invites\n');

/* ---------- 0. la meme mise a plat des deux cotes ---------- */
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'invites.html'), 'utf8');
{
  const src = PAGE.match(/function plat\(s\) \{[\s\S]*?\n\}/);
  const ctx = {};
  vm.runInNewContext(src[0] + '; this.plat = plat;', ctx);
  const cas = ['Voyage, Voyage !', 'Cœur de pirate', 'Beyoncé — Crazy in Love', 'Æon Flux', '  ÉTÉ 2024  '];
  verifier('page et application mettent a plat pareil', cas.every(c => ctx.plat(c) === inv.plat(c)),
           cas.map(c => ctx.plat(c) + '/' + inv.plat(c)).join(' ; '));
}

/* ---------- 1. l'index ---------- */
const LIB = [];
for (let i = 0; i < 3000; i++) LIB.push({ id: i, title: 'Titre numero ' + i, artist: 'Artiste ' + (i % 70), path: '/secret/Users/dj/Music/f' + i + '.mp3', bpm: 120, key: '8A' });
LIB.push({ id: 9001, title: 'Voyage voyage', artist: 'Desireless', path: '/Volumes/SSD/Desireless.mp3' });
LIB.push({ id: 9002, title: 'Around the World', artist: 'Daft Punk', path: '/Volumes/SSD/atw.mp3' });
LIB.push({ id: 9003, title: 'Alexandrie Alexandra', artist: 'Claude François', path: '/x.mp3' });
const IX = inv.construireIndex(LIB);
{
  const tout = IX.parts.join('');
  verifier('l\'index ne contient aucun chemin de fichier', tout.indexOf('/Volumes') < 0 && tout.indexOf('.mp3') < 0);
  verifier('ni tempo ni tonalite', tout.indexOf('8A') < 0 && tout.indexOf('"bpm"') < 0);
  const j = JSON.parse(tout);
  verifier('tous les titres y sont', j.t.length === LIB.length, j.t.length);
  const gros = inv.construireIndex(Array.from({ length: 60000 }, (_, i) => ({ title: 'Un titre assez long numero ' + i, artist: 'Artiste ' + (i % 5000) })));
  verifier('une grosse bibliotheque est decoupee en morceaux de 600 Ko', gros.n > 1 && gros.parts.every(p => p.length <= inv.TAILLE_MORCEAU), gros.n + ' morceaux');
  verifier('meme bibliotheque, meme version (cache des telephones)', inv.construireIndex(LIB).v === IX.v);
}

/* L'etat, fabrique comme main.js le fabrique (en plus court). */
function etatDe(g, joues, ouvert) {
  const top = [], kJ = [], kM = [], jA = {};
  for (const r of g.top()) {
    const t = LIB.find(x => keyOf({ title: x.title, artist: x.artist }) === r.k) ||
              LIB.find(x => inv.plat(x.title) === inv.plat(r.title));
    const kr = inv.cle(r.title, r.artist);
    if (!t) { kM.push(kr); continue; }
    const kt = inv.cle(t.title, t.artist);
    if (joues.has(t.id)) { kJ.push(kr, kt); jA[kr] = joues.get(t.id); jA[kt] = joues.get(t.id); }
    top.push({ t: t.title, a: t.artist, n: r.n, k: kt });
  }
  return { v: 1, nom: 'Mariage Léa & Sam', ouvert: ouvert !== false, soiree: 'soir-1',
           now: { t: 'Around the World', a: 'Daft Punk' }, top, joues: kJ, jouesA: jA, maintenant: Date.now(), manques: kM,
           regles: { cooldown: g.cooldown, max: g.maxPerDevice }, idx: { v: IX.v, n: IX.n } };
}

let chromium = null;
try { chromium = require('playwright').chromium; } catch (e) { try { chromium = require('playwright-core').chromium; } catch (e2) {} }

async function navigateur() {
  for (const essai of [undefined, process.env.CHROMIUM, '/opt/pw-browsers/chromium',
                       '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (essai !== undefined && !essai) continue;
    try { return await chromium.launch(essai ? { executablePath: essai } : undefined); } catch (e) {}
  }
  return null;
}

/* Un parcours d'invite, identique sur les deux chemins. */
async function parcours(b, adresse, langue, nomCapture) {
  const ctx = await b.newContext({ locale: langue, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
                                   isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(adresse);
  await p.waitForFunction(() => /\d/.test(document.getElementById('info').textContent), null, { timeout: 8000 }).catch(() => {});
  const info = await p.textContent('#info');
  await p.fill('#q', 'voyag desirel');
  await attendre(250);
  const premier = await p.textContent('#res .r b').catch(() => '');
  await p.click('#res .go');
  await p.waitForSelector('#msg.on', { timeout: 4000 }).catch(() => {});
  const toast = await p.textContent('#msg');
  await attendre(400);
  const mes = await p.textContent('#mes').catch(() => '');
  const jauge = await p.textContent('#jaugeT').catch(() => '');
  if (nomCapture) await p.screenshot({ path: nomCapture, fullPage: true });
  return { ctx, p, errs, info, premier, toast, mes, jauge };
}

(async () => {
  if (!chromium) { console.log('  (playwright absent — parcours des telephones non joues)'); return fin(); }
  const b = await navigateur();
  if (!b) { console.log('  (navigateur absent — parcours des telephones non joues)'); return fin(); }
  const captures = process.env.CAPTURES || '';

  /* ================= A. le Wi-Fi du lieu ================= */
  {
    const g = new GuestServer();
    const joues = new Map();
    let ouvert = true, demandes = 0;
    const url = await g.start({ port: 7471, token: 'jeton-essai-123', cooldown: 60, maxPerDevice: 3,
      getLibrary: () => LIB, getEtat: () => etatDe(g, joues, ouvert), getIndex: () => IX,
      onRequest: () => demandes++ });
    const adresse = url.replace(/^http:\/\/[^/]+/, 'http://127.0.0.1:7471');
    console.log('  A. Wi-Fi du lieu');
    const r = await parcours(b, adresse, 'fr-FR', captures && path.join(captures, 'invites-local-fr.png'));
    verifier('la page s\'ouvre sans erreur', r.errs.length === 0, r.errs[0]);
    verifier('la bibliotheque arrive sur le telephone', /3\s?003/.test(r.info), r.info);
    verifier('recherche avec fautes : « voyag desirel » → Voyage voyage', r.premier === 'Voyage voyage', r.premier);
    verifier('le telephone dit que c\'est parti', /envoy/i.test(r.toast), r.toast);
    verifier('le DJ la recoit', demandes === 1 && g.top()[0] && g.top()[0].title === 'Voyage voyage');
    verifier('« Tes demandes » la montre en attente', /Voyage voyage/.test(r.mes) && /attente/i.test(r.mes), r.mes);
    verifier('la jauge compte le delai et ce qui reste', /Prochaine/.test(r.jauge) && /2 demandes restantes/.test(r.jauge), r.jauge);

    /* Le DJ joue le morceau : le telephone le voit passer. */
    joues.set(9001, Date.now());
    await r.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await r.p.waitForFunction(() => /Passé/.test(document.getElementById('mes').textContent), null, { timeout: 6000 }).catch(() => {});
    const apres = await r.p.textContent('#mes');
    const t2 = await r.p.textContent('#msg');
    verifier('morceau joue : « Passé ✓ » sur le telephone', /Passé/.test(apres), apres);
    verifier('et un message qui fait plaisir', /ta demande/i.test(t2), t2);

    /* Le plus demande porte le titre du DJ, jamais un texte libre. */
    g.cooldown = 0;                      /* un second invite, sans delai pour l'essai */
    const r2 = await parcours(b, adresse, 'fr-FR');
    await attendre(1100);
    await r2.p.fill('#q', 'mon ex est un DJ nul');
    await attendre(200);
    await r2.p.click('#res .r.libre .go');
    await attendre(300);
    await r2.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await attendre(500);
    const topTx = await r2.p.textContent('#top');
    verifier('un texte libre n\'apparait jamais aux autres invites', topTx.indexOf('DJ nul') < 0 && g.top().some(x => /DJ nul/.test(x.title)));
    verifier('« +1 » sur les plus demandes', await r2.p.$('#top .go.plus') !== null || /Passé/.test(topTx));

    /* Le DJ ferme : les telephones le disent. */
    ouvert = false; g.ferme = true;
    await r2.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await attendre(500);
    const ferme = await r2.p.textContent('body');
    verifier('session fermee : le telephone l\'annonce', /fermées|terminée/.test(ferme));

    /* En anglais, pour un telephone en anglais. */
    ouvert = true; g.ferme = false; g.cooldown = 60;
    /* Plus tard dans la nuit, quelqu'un redemande un titre DEJA passe :
       sa demande attend, elle ne doit pas lire « passe ✓ ». */
    await attendre(5500);
    const r3 = await parcours(b, adresse, 'en-US', captures && path.join(captures, 'invites-local-en.png'));
    verifier('telephone en anglais : page en anglais', /Sent/i.test(r3.toast) && /tracks in the DJ/.test(r3.info), r3.toast + ' / ' + r3.info);
    verifier('titre deja passe, redemande : la demande attend', /Pending/.test(r3.mes) && !/Played/.test(r3.mes), r3.mes);
    for (const x of [r, r2, r3]) await x.ctx.close();
    g.stop();
  }

  /* ================= B. le relais liaisondj.app ================= */
  const WEB = process.env.LIAISON_WEB || path.join(__dirname, '..', '..', 'liaison-web');
  if (!fs.existsSync(path.join(WEB, 'api', 'soiree.js'))) {
    console.log('  (liaison-web absent a cote — chemin du relais non joue)');
  } else {
    console.log('  B. relais liaisondj.app');
    const kv = require(path.join(WEB, 'lib', 'kv.js'));
    kv.fauxMagasin();
    const api = require(path.join(WEB, 'api', 'soiree.js'));
    const PUB = path.join(WEB, 'public');
    const site = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (/^\/d\/[a-z0-9]+$/.test(u.pathname)) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(path.join(PUB, 'd.html'))); }
      if (u.pathname.indexOf('/fonts/') === 0) { try { return res.end(fs.readFileSync(path.join(PUB, 'fonts', path.basename(u.pathname)))); } catch (e) { res.statusCode = 404; return res.end(); } }
      if (u.pathname === '/_vercel/insights/script.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(''); }
      if (u.pathname === '/api/soiree') {
        req.query = Object.fromEntries(u.searchParams);
        const bouts = [];
        req.on('data', c => bouts.push(c));
        req.on('end', () => {
          if (bouts.length) { try { req.body = JSON.parse(Buffer.concat(bouts).toString('utf8')); } catch (e) { req.body = {}; } }
          api(req, res);
        });
        return;
      }
      res.statusCode = 404; res.end();
    });
    await new Promise(r => site.listen(7472, '127.0.0.1', r));
    const g = new GuestServer();
    g.cooldown = 60; g.maxPerDevice = 3;
    const joues = new Map();
    let recues = 0;
    const code = inv.nouveauCode(8);
    const rel = new Relais({ base: 'http://127.0.0.1:7472', code, secret: 'secret-essai-' + 'q'.repeat(20),
      getEtat: () => etatDe(g, joues, true), getIndex: () => IX,
      onDemandes: d => { for (const x of d) if (g.ajouterRelayee(x)) recues++; } });
    const res = await rel.reserver();
    verifier('l\'application reserve son code', res.ok === true, JSON.stringify(res));
    rel.demarrer();
    await attendre(1500);
    verifier('l\'etat et l\'index sont deposes', rel.statut.ok === true && rel.indexEnvoye === IX.v, JSON.stringify(rel.statut));
    const r = await parcours(b, 'http://127.0.0.1:7472/d/' + code, 'fr-FR', captures && path.join(captures, 'invites-relais-fr.png'));
    verifier('la page du site s\'ouvre sans erreur', r.errs.length === 0, r.errs[0]);
    verifier('elle affiche « En direct »', /direct/i.test(await r.p.textContent('#etat')));
    verifier('l\'index du DJ arrive par le relais', /3\s?003/.test(r.info), r.info);
    verifier('la demande part', /envoy/i.test(r.toast), r.toast);
    rel.bientot();
    await attendre(1200);
    verifier('le DJ la releve au tour suivant', recues === 1 && g.top()[0] && g.top()[0].title === 'Voyage voyage', 'recues=' + recues);
    joues.set(9001, Date.now());
    rel.bientot();
    await attendre(900);
    await r.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await r.p.waitForFunction(() => /Passé/.test(document.getElementById('mes').textContent), null, { timeout: 6000 }).catch(() => {});
    verifier('« Passé ✓ » arrive aussi par le relais', /Passé/.test(await r.p.textContent('#mes')));
    await rel.arreter(Object.assign(etatDe(g, joues, true), { ouvert: false }));
    await r.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await attendre(500);
    verifier('fermeture : le telephone l\'annonce', /fermées|terminée/.test(await r.p.textContent('body')));
    await r.ctx.close();
    site.close();
    kv.vraiMagasin();
  }

  /* ================= C. le QR en grand, et l'affiche ================= */
  {
    console.log('  C. QR en grand et affiche');
    const QRC = require('qrcode');
    const qr = await QRC.toDataURL('https://liaisondj.app/d/abcd2345', { margin: 1, width: 300 });
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(({ qr }) => { window.liaison = { on: () => {}, qrFermerGrand: () => {},
      sessionEtat: async () => ({ ouvert: true, mode: 'relais', url: 'https://liaisondj.app/d/abcd2345', qr, nom: 'Soirée <b>test</b>' }),
      requests: async () => [{ title: 'texte libre <img src=x>', have: false },
                             { title: 'x', have: true, joue: false, match: { title: 'Voyage voyage', artist: 'Desireless' } }] }; }, { qr });
    await p.goto('file://' + path.join(__dirname, '..', 'src', 'ui', 'qr-grand.html'));
    await attendre(600);
    const txt = await p.textContent('body');
    verifier('le QR en grand s\'ouvre sans erreur', errs.length === 0, errs[0]);
    verifier('il montre les plus demandes de la bibliotheque, jamais un texte libre', /Voyage voyage/.test(txt) && !/texte libre/.test(txt));
    verifier('le nom de la soiree est echappe', (await p.$('#nom b')) === null);
    const { htmlAffiche } = require('../src/affiche');
    const svg = await QRC.toString('https://liaisondj.app/d/abcd2345', { type: 'svg', margin: 1 });
    const html = htmlAffiche({ svg, nom: 'Mariage <script>x</script>', url: 'https://liaisondj.app/d/abcd2345', en: false, local: true,
                               police: f => 'file://' + path.join(__dirname, '..', 'src', 'ui', 'fonts', f) });
    verifier('affiche : le nom est echappe', html.indexOf('<script>') < 0);
    verifier('affiche en mode Wi-Fi local : le rappel « connecte-toi au Wi-Fi »', /Wi-Fi du lieu/.test(html));
    await p.setContent(html);
    const pdf = await p.pdf({ format: 'A4', printBackground: true });
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    verifier('affiche : deux pages A4 (affiche + quatre chevalets)', pages === 2, pages + ' pages');
    await p.close();
  }

  await b.close();
  fin();
})().catch(e => { console.error(e); process.exit(1); });

function fin() {
  console.log('\n' + (ko ? ko + ' RATE(S)' : 'invites : on cherche, on demande, on sait quand ca passe — en Wi-Fi comme en 4G.'));
  process.exit(ko ? 1 : 0);
}
