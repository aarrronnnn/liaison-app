'use strict';
/* ============================================================
   UN FICHIER ABIME NE DOIT NI GELER LA SOIREE, NI EFFACER LE
   TRAVAIL DU DJ.

   Audit du 5 octobre 2026. Ce que le DJ voyait :

   1. sets.json lisible mais de travers (« null », un objet, une
      entree sans « played ») : setlog.play() jetait a CHAQUE
      changement de morceau. Le widget restait sur l'ancien titre
      toute la nuit, sans une suggestion — seul un « Incident note »
      passait.
   2. soirees.json et gout.json ne passaient pas par ecrire.js :
      un fichier tronque, et la prochaine ecriture effacait toutes
      les fiches de soiree preparees (listes du client comprises),
      ou tout ce que Liaison avait appris du DJ — sans jamais
      regarder la copie de secours.
   3. ecrire.js copiait le fichier principal sur la copie de secours
      AVANT d'ecrire, meme quand ce fichier etait illisible : une
      copie saine remplacee par une copie morte.
   4. Une ecriture qui echoue (dossier en lecture seule, OneDrive
      qui verrouille, disque plein) ne disait rien a personne.
   5. Le serveur des invites qui n'a pas pu demarrer (port pris) se
      declarait « en marche ».
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

let echecs = 0, cas = 0;
function verifier(quoi, condition, detail) {
  cas++;
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(66), detail ? '  — ' + detail : '');
}
function sansJeter(fn) {
  try { return { ok: true, v: fn() }; } catch (e) { return { ok: false, e: String(e && e.message || e) }; }
}

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'lz-abime-'));
const ecrire = require('../src/ecrire.js');
const { SetLog, GuestServer } = require('../src/session.js');
const { Soirees } = require('../src/soirees.js');
const { Gout } = require('../src/gout.js');

(async () => {
  console.log('\n- donnees abimees : rien ne gele, rien ne s\'efface -\n');

  /* ---------- 1. sets.json de travers ---------- */
  const formes = [
    ['null', 'null'],
    ['un objet', '{}'],
    ['une entree nulle', '[null]'],
    ['un set sans « played »', '[{"id":1,"name":"Vieux"}]'],
    ['des morceaux nuls dans « played »', '[{"id":2,"name":"Abime","played":[null,{"id":7,"title":"X","at":1}]}]'],
    ['« played » qui est un texte', '[{"id":3,"name":"Texte","played":"abc"}]']
  ];
  for (const [nom, texte] of formes) {
    const f = path.join(dossier, 'sets-' + cas + '.json');
    fs.writeFileSync(f, texte);
    const log = new SetLog(f);
    const morceau = { id: 7, title: 'One More Time', artist: 'Daft Punk', bpm: 123 };
    const r1 = sansJeter(() => log.play(morceau, null));
    const r2 = sansJeter(() => log.lastPlay(7, { track: morceau }));
    const r3 = sansJeter(() => { log.list(); log.soireesJouees(); log.tracklist(); log.hydrate(2, [morceau]); log.get(99); });
    verifier('sets.json = ' + nom + ' : le morceau suivant passe quand meme',
             r1.ok && r2.ok && r3.ok, [r1, r2, r3].filter(r => !r.ok).map(r => r.e).join(' | '));
  }

  /* ---------- 2a. soirees.json tronque, copie de secours saine ---------- */
  {
    const f = path.join(dossier, 'soirees.json');
    const s = new Soirees(f);
    s.creer({ nom: 'Mariage Lea & Sam', voulus: ['Gala - Freed from Desire'] });
    s.creer({ nom: 'Anniversaire 20 ans' });          /* deuxieme ecriture : la copie existe */
    s.creer({ nom: 'Bar du jeudi' });
    const plein = fs.readFileSync(f, 'utf8');
    fs.writeFileSync(f, plein.slice(0, Math.floor(plein.length / 2)));   /* coupure de courant */
    const relue = new Soirees(f);
    verifier('soirees.json tronque : les fiches reviennent de la copie', relue.liste().length >= 2,
             relue.liste().length + ' fiche(s) relue(s)');
    relue.creer({ nom: 'Nouvelle' });
    const apres = new Soirees(f);
    verifier('... et la fiche suivante ne les efface pas', apres.liste().length >= 3,
             apres.liste().map(x => x.nom).join(', '));
  }

  /* ---------- 2b. gout.json tronque, copie de secours saine ---------- */
  {
    const f = path.join(dossier, 'gout.json');
    const g = new Gout(f);
    g.d.n = 240; g.d.pris = 120;
    g.ecrireMaintenant();
    g.ecrireMaintenant();                             /* la copie existe et elle est saine */
    fs.writeFileSync(f, '{"v":1,"ema":{"h":0.1');      /* ecriture interrompue */
    const relu = new Gout(f);
    verifier('gout.json tronque : l\'apprentissage revient de la copie', relu.d.n === 240, 'n = ' + relu.d.n);
    relu.ecrireMaintenant();
    const bak = ecrire.lireJSON(f + '.bak', null);
    verifier('... et la copie de secours n\'est pas ecrasee par du vide', !!(bak && bak.n === 240),
             'copie : n = ' + (bak && bak.n));
  }

  /* ---------- 3. ecrire.js ne remplace pas une copie saine par une morte ---------- */
  {
    const f = path.join(dossier, 'config.json');
    ecrire.ecrireJSON(f, { listes: ['a'], v: 1 });
    ecrire.ecrireJSON(f, { listes: ['a', 'b'], v: 2 });     /* copie = v1 */
    fs.writeFileSync(f, '{"listes":["a","b"');              /* le principal s'abime */
    ecrire.ecrireJSON(f, { autre: true });                  /* une ecriture ailleurs dans l'app */
    const bak = ecrire.lireJSON(f + '.bak', null);
    verifier('principal illisible : la copie saine reste en place', !!(bak && bak.v === 1),
             JSON.stringify(bak));
    fs.writeFileSync(f, Buffer.alloc(64));                  /* rempli de zeros (coupure sur certains disques) */
    ecrire.ecrireJSON(f, { autre: 2 });
    const bak2 = ecrire.lireJSON(f + '.bak', null);
    verifier('principal rempli de zeros : idem', !!(bak2 && bak2.v === 1), JSON.stringify(bak2));
  }

  /* ---------- 4. une ecriture ratee se fait entendre ---------- */
  {
    const vus = [];
    const r0 = sansJeter(() => ecrire.surEchec((fichier, err) => vus.push([fichier, err])));
    const bloque = path.join(dossier, 'pas-un-dossier');
    fs.writeFileSync(bloque, 'je suis un fichier');
    const f = path.join(bloque, 'sets.json');               /* son « dossier » est un fichier */
    const ok = ecrire.ecrireJSON(f, [1, 2, 3]);
    verifier('ecriture impossible : ecrireJSON rend faux', ok === false);
    verifier('... et le signale une fois a qui ecoute', r0.ok && vus.length === 1 && vus[0][0] === f,
             r0.ok ? vus.length + ' signalement(s)' : r0.e);
    ecrire.ecrireJSON(f, [4]);
    verifier('... sans le repeter a chaque tentative', vus.length === 1, vus.length + ' signalement(s)');
    if (r0.ok) sansJeter(() => ecrire.surEchec(null));
  }

  /* ---------- 5. le serveur des invites qui n'a pas demarre ---------- */
  {
    const occupe = net.createServer();
    await new Promise(r => occupe.listen(0, '0.0.0.0', r));
    const port = occupe.address().port;
    const g = new GuestServer();
    let rejet = null;
    try { await g.start({ port: port, onRequest: () => {}, getTop: () => [], search: () => [] }); }
    catch (e) { rejet = e; }
    verifier('port deja pris : le demarrage est refuse', !!rejet, rejet ? rejet.code : 'demarre ?!');
    verifier('... et le serveur ne se dit pas « en marche »', g.enMarche() === false);
    try { g.stop(); } catch (e) {}
    occupe.close();
  }

  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (cas - echecs) + ' / ' + cas + ' controles.');
  if (echecs) { console.error(echecs + ' controle(s) en echec.'); process.exit(1); }
  console.log('donnees abimees : la soiree continue, le travail du DJ reste.');
})().catch(e => { console.error(e); process.exit(1); });
