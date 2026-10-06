'use strict';
/* ============================================================
   CE QUI TOURNE SUR LA PLATINE : SERATO, TRAKTOR, VIRTUALDJ.

   Audit du 6 octobre 2026. Le mail de prospection promettait que
   Liaison « lit ce qui tourne sur Serato, Traktor ou VirtualDJ ».
   Aucune de ces trois sources n'avait d'essai, et deux ne
   pouvaient pas marcher :

     — TRAKTOR attendait le titre sur /admin/metadata et jetait le
       flux. Traktor diffuse en Ogg Vorbis et met le titre DANS le
       flux (commentaires Vorbis). Aucun titre, jamais.
     — VIRTUALDJ lisait Documents/VirtualDJ/Tracklists, un dossier
       que VirtualDJ n'ecrit pas : son historique est dans History,
       en .m3u. Aucun titre, jamais.
     — SERATO oubliait le fichier trouve : la boucle s'arretait
       pendant 30 s apres chaque relecture du dossier.

   Ce banc fabrique ce que ces logiciels produisent vraiment — un
   flux Ogg octet par octet, un historique .m3u de VirtualDJ, une
   session Serato — et verifie que le titre arrive, et vite.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(66) + (ok || detail == null ? '' : '  — ' + detail));
  if (!ok) ko++;
}
const attendre = ms => new Promise(r => setTimeout(r, ms));
async function jusqua(cond, ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await attendre(25); }
  return cond();
}
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const temp = nom => fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-' + nom + '-'));

/* ============================================================
   OGG : de quoi fabriquer un vrai flux de diffusion.
   ============================================================ */
function paginer(flux, paquets, segParPage) {
  const max = segParPage || 255;
  const segs = [];
  for (const p of paquets) {
    let i = 0;
    while (p.length - i >= 255) { segs.push(p.subarray(i, i + 255)); i += 255; }
    segs.push(p.subarray(i));
  }
  const pages = [];
  let seq = 0, k = 0, suite = false;
  while (k < segs.length) {
    const lot = segs.slice(k, k + max);
    const t = Buffer.alloc(27 + lot.length);
    t.write('OggS', 0, 'latin1');
    t[5] = (suite ? 1 : 0) | (seq === 0 ? 2 : 0);
    t.writeUInt32LE(flux, 14);
    t.writeUInt32LE(seq, 18);
    t[26] = lot.length;
    lot.forEach((s, j) => { t[27 + j] = s.length; });
    pages.push(Buffer.concat([t].concat(lot)));
    suite = lot[lot.length - 1].length === 255;
    k += lot.length;
    seq++;
  }
  return Buffer.concat(pages);
}
const ident = () => Buffer.concat([Buffer.from([1]), Buffer.from('vorbis', 'latin1'), Buffer.alloc(23)]);
function commentaire(champs, vendeur) {
  const v = Buffer.from(vendeur || 'Traktor', 'utf8');
  const parts = [Buffer.from([3]), Buffer.from('vorbis', 'latin1'), u32(v.length), v, u32(champs.length)];
  for (const c of champs) { const b = Buffer.from(c, 'utf8'); parts.push(u32(b.length), b); }
  parts.push(Buffer.from([1]));
  return Buffer.concat(parts);
}
let graine = 7;
const hasard = n => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) { graine = (graine * 1103515245 + 12345) & 0x7fffffff; b[i] = graine & 0xff; } return b; };
const reglage = () => Buffer.concat([Buffer.from([5]), Buffer.from('vorbis', 'latin1'), hasard(3200)]);
const audio = n => { const out = []; for (let i = 0; i < n; i++) out.push(hasard(180 + (i * 37) % 600)); return out; };

/* Un morceau = un flux logique : identification, commentaires,
   reglages, puis du son. C'est ce que Traktor envoie a chaque
   changement de titre. */
function morceau(flux, artiste, titre, opt) {
  const o = opt || {};
  return paginer(flux, [ident(), commentaire(['ARTIST=' + artiste, 'TITLE=' + titre, 'ALBUM=Mix'], o.vendeur),
                        reglage()].concat(audio(o.audio || 40)), o.seg);
}

(async () => {
  /* ============================================================
     1. TRAKTOR
     ============================================================ */
  console.log('\n- Traktor : le titre est dans le flux -\n');
  const T = require('../src/sources/traktor.js');

  {
    const flux = Buffer.concat([
      morceau(11, 'Stromae', 'Alors on danse'),
      /* un fournisseur de 70 000 octets : le paquet de commentaires
         court sur deux pages, et chaque page est petite */
      morceau(12, 'Кино', 'Группа крови', { vendeur: 'x'.repeat(70000), seg: 40 }),
      morceau(13, 'Daft Punk', 'One More Time')
    ]);
    const vus = [];
    const l = T.lecteurOgg(p => { const t = T.texteDe(T.commentaires(p)); if (t) vus.push(t); });
    for (let i = 0; i < flux.length; i++) l.pousser(flux.subarray(i, i + 1));
    verifier('les titres arrivent, octet par octet, dans l\'ordre',
      vus.join(' | ') === 'Stromae - Alors on danse | Кино - Группа крови | Daft Punk - One More Time',
      vus.join(' | '));

    /* Pris en route : on se branche au milieu du premier morceau. */
    const milieu = Math.floor(morceau(11, 'Stromae', 'Alors on danse').length / 2) + 3;
    const vus2 = [];
    const l2 = T.lecteurOgg(p => { const t = T.texteDe(T.commentaires(p)); if (t) vus2.push(t); });
    l2.pousser(flux.subarray(milieu));
    verifier('branche en plein morceau : il se recale et lit les suivants',
      vus2.join(' | ') === 'Кино - Группа крови | Daft Punk - One More Time', vus2.join(' | '));

    /* Du bruit ne fait ni planter ni inventer un titre. */
    const vus3 = [];
    const l3 = T.lecteurOgg(p => { const t = T.texteDe(T.commentaires(p)); if (t) vus3.push(t); });
    let leve = null;
    try { for (let i = 0; i < 50; i++) l3.pousser(hasard(997)); l3.pousser(Buffer.from('OggSOggSOggS')); } catch (e) { leve = e; }
    verifier('du bruit : ni exception, ni titre invente', !leve && vus3.length === 0, leve ? leve.message : vus3.join(','));

    const ch = s => { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]); };
    const opus = Buffer.concat([Buffer.from('OpusTags', 'latin1'), ch('lib'), u32(2),
      ch('ARTIST=Angèle'), ch('TITLE=Balance ton')]);
    const c = T.commentaires(opus);
    verifier('les commentaires Opus se lisent aussi', T.texteDe(c) === 'Angèle - Balance ton', T.texteDe(c));
  }

  /* --- le vrai serveur, sur une vraie prise --- */
  {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const textes = [], statuts = [];
    let src = T.start({ port }, { onText: t => textes.push(t), onStatus: s => statuts.push(s) });
    await jusqua(() => statuts.some(s => s.ok && /En écoute/.test(s.msg)), 2000);
    verifier('le serveur ecoute sur 127.0.0.1:' + port, statuts.some(s => s.ok && /En écoute/.test(s.msg)),
      JSON.stringify(statuts));

    const prise = net.connect(port, '127.0.0.1');
    let reponse = '';
    let fermee = false;
    prise.on('data', d => { reponse += d.toString('latin1'); });
    prise.on('close', () => { fermee = true; });
    prise.on('error', () => {});
    await new Promise(r => prise.on('connect', r));
    prise.write('SOURCE /liaison HTTP/1.0\r\nAuthorization: Basic c291cmNlOmxpYWlzb24=\r\n' +
                'Content-Type: application/ogg\r\nice-name: Traktor\r\n\r\n');
    await jusqua(() => /200/.test(reponse), 2000);
    verifier('Traktor recoit « 200 OK » et la connexion reste ouverte',
      /^HTTP\/1\.0 200 OK/.test(reponse) && !fermee, JSON.stringify(reponse));

    const un = morceau(21, 'Zaz', 'Je veux');
    for (let i = 0; i < un.length; i += 333) { prise.write(un.subarray(i, i + 333)); }
    await jusqua(() => textes.length >= 1, 2000);
    verifier('le premier titre arrive', textes[0] === 'Zaz - Je veux', JSON.stringify(textes));

    prise.write(morceau(22, 'Indila', 'Dernière danse'));
    await jusqua(() => textes.length >= 2, 2000);
    verifier('au changement de morceau, le nouveau titre arrive',
      textes[1] === 'Indila - Dernière danse', JSON.stringify(textes));
    verifier('et la diffusion est annoncee au widget',
      statuts.some(s => s.ok && /Traktor diffuse/.test(s.msg)));
    verifier('la connexion de Traktor n\'a jamais ete coupee', !fermee);

    /* L'ancien canal, pour les diffusions en MP3. */
    const r2 = await new Promise(res => {
      const q = net.connect(port, '127.0.0.1', () => q.write('GET /admin/metadata?mode=updinfo&song=Gims%20-%20Bella HTTP/1.0\r\n\r\n'));
      let d = ''; q.on('data', x => { d += x; }); q.on('close', () => res(d)); q.on('error', () => res(d));
    });
    await jusqua(() => textes.length >= 3, 1000);
    verifier('/admin/metadata marche toujours', /200 OK/.test(r2) && textes[2] === 'Gims - Bella', JSON.stringify(textes));

    /* Arreter la source pendant que Traktor diffuse : le port doit
       se liberer, sinon le prochain demarrage tombe sur EADDRINUSE. */
    src.stop();
    await jusqua(() => fermee, 1000);
    const statuts2 = [];
    src = T.start({ port }, { onText: () => {}, onStatus: s => statuts2.push(s) });
    await jusqua(() => statuts2.length > 0, 2000);
    verifier('arretee en pleine diffusion, la source rend le port',
      statuts2.some(s => s.ok) && !statuts2.some(s => !s.ok), JSON.stringify(statuts2));
    src.stop();
  }

  /* ============================================================
     2. VIRTUALDJ
     ============================================================ */
  console.log('\n- VirtualDJ : l\'historique, la ou il est ecrit -\n');
  const V = require('../src/sources/virtualdj.js');
  {
    const m3u = '#EXTVDJ:<time>21:02</time><lastplaytime>1791300000</lastplaytime><filesize>8123456</filesize>' +
      '<artist>Daft Punk</artist><title>One More Time</title>\r\n/Users/dj/Music/one-more-time.mp3\r\n' +
      '#EXTVDJ:<time>21:06</time><filesize>9000000</filesize><artist>Simon &amp; Garfunkel</artist>' +
      '<title>Mrs. Robinson</title><remix>Edit</remix>\r\nC:\\Musique\\Simon & Garfunkel - Mrs Robinson.mp3\r\n';
    const e = V.derniereEntree('\uFEFF' + m3u, '2026-10-06.m3u');
    verifier('m3u : artiste et titre de la derniere entree, entites decodees',
      e && e.texte === 'Simon & Garfunkel - Mrs. Robinson', e && e.texte);
    verifier('m3u : le chemin du fichier est rendu aussi',
      e && e.chemin === 'C:\\Musique\\Simon & Garfunkel - Mrs Robinson.mp3', e && e.chemin);

    const nu = V.derniereEntree('/Users/dj/Music/Angèle - Balance ton quoi.mp3\n', 'h.m3u');
    verifier('m3u sans #EXTVDJ : le nom du fichier sert de texte',
      nu && nu.texte === 'Angèle - Balance ton quoi', nu && nu.texte);

    const txt = V.derniereEntree('21:02 : Daft Punk - One More Time\n21:06 : Gala - Freed from Desire\n', 'tracklist.txt');
    verifier('tracklist texte : l\'heure est retiree',
      txt && txt.texte === 'Gala - Freed from Desire' && txt.chemin === '', txt && txt.texte);

    /* Les dossiers cherches : Documents, Application Support (Mac),
       LOCALAPPDATA (Windows). */
    /* os.homedir() lit HOME sur Mac et Linux, USERPROFILE sous
       Windows : on pose les deux, pour que le banc tienne sur les
       trois machines du CI. */
    const avant = { HOME: process.env.HOME, U: process.env.USERPROFILE, D: process.env.LIAISON_DOCUMENTS, L: process.env.LOCALAPPDATA };
    const maison = temp('maison');
    process.env.HOME = maison;
    process.env.USERPROFILE = maison;
    process.env.LIAISON_DOCUMENTS = path.join(maison, 'Documents');
    process.env.LOCALAPPDATA = path.join(maison, 'AppData', 'Local');
    const ds = V.dossiers();
    verifier('dossiers : Documents/VirtualDJ/History',
      ds.includes(path.join(maison, 'Documents', 'VirtualDJ', 'History')));
    verifier('dossiers : ~/Library/Application Support/VirtualDJ/History (Mac)',
      ds.includes(path.join(maison, 'Library', 'Application Support', 'VirtualDJ', 'History')));
    verifier('dossiers : %LOCALAPPDATA%\\VirtualDJ\\History (Windows)',
      ds.includes(path.join(maison, 'AppData', 'Local', 'VirtualDJ', 'History')));

    /* En direct : VirtualDJ ecrit dans Application Support, comme sur
       un Mac recent. */
    const hist = path.join(maison, 'Library', 'Application Support', 'VirtualDJ', 'History');
    fs.mkdirSync(hist, { recursive: true });
    const f = path.join(hist, '2026-10-06.m3u');
    fs.writeFileSync(f, '#EXTVDJ:<time>22:00</time><artist>Gala</artist><title>Freed from Desire</title>\n/m/freed.mp3\n');
    const vus = [], metas = [], st = [];
    const s = V.start({}, { onText: (t, m) => { vus.push(t); metas.push(m); }, onStatus: x => st.push(x) });
    await jusqua(() => vus.length >= 1, 2500);
    verifier('au demarrage, le morceau en cours est lu', vus[0] === 'Gala - Freed from Desire', JSON.stringify(vus));
    verifier('avec son chemin, pour le retrouver sans ambiguite', metas[0] && metas[0].chemin === '/m/freed.mp3',
      JSON.stringify(metas[0]));
    fs.appendFileSync(f, '#EXTVDJ:<time>22:04</time><artist>Céline Dion</artist><title>Pour que tu m\'aimes encore</title>\n/m/celine.mp3\n');
    const t0 = Date.now();
    await jusqua(() => vus.length >= 2, 4000);
    verifier('morceau suivant : lu en moins de 4 s',
      vus[1] === 'Céline Dion - Pour que tu m\'aimes encore', JSON.stringify(vus) + ' en ' + (Date.now() - t0) + ' ms');
    s.stop();

    /* Un historique de la veille n'est pas « en cours ». */
    const hier = Date.now() / 1000 - 20 * 3600;
    fs.utimesSync(f, hier, hier);
    const vus2 = [];
    const s2 = V.start({}, { onText: t => vus2.push(t), onStatus: () => {} });
    await attendre(1700);
    verifier('historique de la veille : rien n\'est annonce au demarrage', vus2.length === 0, JSON.stringify(vus2));
    fs.appendFileSync(f, '#EXTVDJ:<artist>Indila</artist><title>Tourner dans le vide</title>\n/m/indila.mp3\n');
    await jusqua(() => vus2.length >= 1, 4000);
    verifier('mais le premier morceau joue ce soir l\'est', vus2[0] === 'Indila - Tourner dans le vide', JSON.stringify(vus2));
    s2.stop();

    /* Aucun historique nulle part : on dit quoi regler. */
    const vide = temp('vide');
    const st3 = [];
    const s3 = V.start({ dir: path.join(vide, 'History') }, { onText: () => {}, onStatus: x => st3.push(x) });
    await attendre(100);
    s3.stop();
    verifier('aucun historique : le message nomme le reglage writeHistory',
      st3.some(x => !x.ok && /writeHistory/.test(x.msg)), JSON.stringify(st3));

    for (const [k, v] of [['HOME', avant.HOME], ['USERPROFILE', avant.U], ['LIAISON_DOCUMENTS', avant.D], ['LOCALAPPDATA', avant.L]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }

  /* ============================================================
     3. SERATO
     ============================================================ */
  console.log('\n- Serato : sans demi-minute de retard -\n');
  const S = require('../src/sources/serato.js');
  {
    const d = temp('serato');
    const f = path.join(d, '42.session');
    fs.writeFileSync(f, 'x');
    const a = S.newest(d), b = S.newest(d), c = S.newest(d);
    verifier('newest() rend le meme fichier trois fois de suite (plus de null)',
      a === f && b === f && c === f, JSON.stringify([a, b, c]));

    const be32 = n => { const x = Buffer.alloc(4); x.writeUInt32BE(n >>> 0); return x; };
    const utf16 = s => { const x = Buffer.from(s, 'utf16le'); for (let i = 0; i < x.length; i += 2) { const t = x[i]; x[i] = x[i + 1]; x[i + 1] = t; } return x; };
    const champ = (id, v) => Buffer.concat([be32(id), be32(v.length), v]);
    const bloc = (tag, corps) => Buffer.concat([Buffer.from(tag, 'ascii'), be32(corps.length), corps]);
    const entree = (titre, artiste) => bloc('oent', bloc('adat', Buffer.concat([
      champ(1, be32(7)), champ(2, utf16('/Users/dj/Music/' + titre + '.mp3')),
      champ(6, utf16(titre)), champ(7, utf16(artiste)), champ(31, be32(1))])));

    const d2 = temp('serato-live');
    const f2 = path.join(d2, '43.session');
    fs.writeFileSync(f2, Buffer.concat([Buffer.from('vrsn', 'ascii'), be32(4), Buffer.from([0, 0, 0, 2]), entree('Freed from Desire', 'Gala')]));
    const vus = [];
    const s = S.start({ dir: d2 }, { onText: t => vus.push(t), onStatus: () => {} });
    await jusqua(() => vus.length >= 1, 2500);
    verifier('Serato : le morceau en cours est lu', /Freed from Desire/.test(vus[0] || ''), JSON.stringify(vus));
    fs.appendFileSync(f2, entree('One More Time', 'Daft Punk'));
    const t0 = Date.now();
    await jusqua(() => vus.some(v => /One More Time/.test(v)), 5000);
    const delai = Date.now() - t0;
    verifier('Serato : le morceau suivant est lu en moins de 4 s (et non 30)',
      vus.some(v => /One More Time/.test(v)) && delai < 4000, delai + ' ms, ' + JSON.stringify(vus));
    s.stop();
  }

  console.log(ko ? '\n' + ko + ' cas en echec.\n'
                 : '\nplatines : Serato, Traktor et VirtualDJ annoncent ce qui tourne, et vite.\n');
  process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
