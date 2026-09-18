'use strict';
/* ============================================================
   Banc — la bibliotheque qui bouge.

   « Il faut que chaque son soit pris en compte, meme quand les DJ
     mettent a jour leur bibliotheque, qu'ils analysent de nouveau
     leurs sons, qu'ils ajoutent des tags — alors Liaison aussi se
     met a jour sur ces sons. »

   Une bibliotheque de DJ n'est pas un fichier, c'est un flux : il
   achete, il retague, il reanalyse dans rekordbox, il reconvertit,
   il efface. Chacun de ces gestes doit remonter jusqu'a Liaison
   TOUT SEUL — sans bouton, sans relance, sans redemarrage.

   Ce banc verifie chacun de ces gestes, un par un.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../src/library.js');
const { AnalysisService, AnalysisCache } = require('../src/analysis.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(58),
              detail ? '  — ' + detail : '');
}

const BAC = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-maj-'));
const dodo = ms => new Promise(r => setTimeout(r, ms));

(async () => {

/* ============================================================
   1. LE DJ RETAGUE UN FICHIER.

   La cle du cache de tags est « chemin + taille + date ». Retaguer
   change la date : le fichier doit etre relu, et sa nouvelle
   tonalite doit apparaitre.
   ============================================================ */
{
  const cache = path.join(BAC, 'tags.json');
  const e = {};
  const f = path.join(BAC, 'a.mp3');
  fs.writeFileSync(f, 'x');
  const st = fs.statSync(f);
  /* Une entree telle que scanFolder l'ecrit, sans tonalite. */
  e[lib.cleChemin(f)] = [st.size, Math.round(st.mtimeMs), 'Titre', 'Artiste', 'House', 128, null, 200, 2020, 0];
  lib.ecrireScanCache(cache, e);
  const relu = lib.chargerScanCache(cache);
  verifier('1. le cache de tags se relit', !!relu.e[lib.cleChemin(f)],
           'version ' + lib.VERSION_TAGS);

  /* On retague : taille et date changent. */
  fs.writeFileSync(f, 'xxxxxxxxxx');
  const st2 = fs.statSync(f);
  const c = relu.e[lib.cleChemin(f)];
  verifier('1bis. le fichier retague ne correspond plus au cache',
           !(c[0] === st2.size && c[1] === Math.round(st2.mtimeMs)),
           'taille ' + c[0] + ' -> ' + st2.size);
}

/* ============================================================
   2. UNE CORRECTION DE LECTURE DOIT ATTEINDRE LES ANCIENS CACHES.

   C'est le defaut le plus sournois du projet, et il a deja frappe
   deux fois : on corrige la facon de lire, et rien ne change chez
   le DJ parce que son cache est plein d'entrees ecrites par
   l'ancienne regle. VERSION_TAGS existe pour ca — encore faut-il
   qu'elle soit montee.
   ============================================================ */
{
  const cache = path.join(BAC, 'vieux.json');
  fs.writeFileSync(cache, JSON.stringify({ v: lib.VERSION_TAGS - 1, e: { '/m/x.mp3': [1, 2, 'T', 'A', '', 0, null, 0] } }));
  const relu = lib.chargerScanCache(cache);
  verifier('2. un cache d\'une version anterieure est ignore',
           Object.keys(relu.e).length === 0);
  verifier('2bis. et la version courante lit bien la tonalite ouverte',
           lib.toCamelot('1m') === '8A' && lib.toCamelot('12d') === '7B',
           '1m -> ' + lib.toCamelot('1m') + ', 12d -> ' + lib.toCamelot('12d'));
}

/* ============================================================
   3. LE DJ REANALYSE DANS REKORDBOX.

   Sa nouvelle grille est une source forte : elle doit primer sur
   ce que Liaison avait mesure, et la mesure ne doit pas revenir la
   contredire au rechargement suivant.
   ============================================================ */
{
  const f = path.join(BAC, 'b.mp3');
  fs.writeFileSync(f, 'audio');
  const cacheFichier = path.join(BAC, 'analyse.json');

  /* Premier soir : pas de tag, Liaison mesure 128. */
  const t1 = lib.finalize([{ path: f, title: 'B', bpm: 0, key: null, duration: 200 }])[0];
  const s1 = new AnalysisService(cacheFichier, {});
  s1.sansFils = true;
  s1.tracks.set(t1.id, t1);
  s1.file.set(t1.id, { priorite: 0, stamp: AnalysisCache.stamp(f) });
  s1.encours.add(t1.id);
  s1._resultat({ job: t1.id }, { id: t1.id, ok: true, patch: {
    energy: 7, timbre: [5, 5, 5], vocal: 0,
    mBpm: 128, mBpmConf: 0.9, mKey: '5A', mKeyConf: 0.9, mKeyMarge: 0.2 } });
  s1.cache.save(); s1.stop();
  verifier('3. sans tag, la mesure de Liaison fait foi',
           t1.bpm === 128 && t1.bpmSource === 'liaison', t1.bpm + ' (' + t1.bpmSource + ')');

  /* Deuxieme soir : le DJ a reanalyse dans rekordbox, qui annonce 100.
     Cent contre cent vingt-huit n'est ni le double ni la moitie :
     c'est un vrai desaccord, et c'est sa grille qui gagne — le DJ
     mixe dessus. 126 aurait ete le MEME rythme a deux pour cent
     pres, donc pas un desaccord du tout ; ce banc serait alors
     passe sans rien prouver. */
  const t2 = lib.finalize([{ path: f, title: 'B', bpm: 100, bpmSrc: 'rekordbox',
                             key: '8A', keySrc: 'rekordbox', duration: 200 }])[0];
  const s2 = new AnalysisService(cacheFichier, {});
  s2.sansFils = true;
  s2.charger([t2]);
  s2.stop();
  verifier('3bis. sa nouvelle grille prime sur notre mesure',
           t2.bpm === 100 && t2.bpmSource === 'rekordbox' && t2.key === '8A',
           t2.bpm + ' (' + t2.bpmSource + '), cle ' + t2.key);
  verifier('3ter. et le desaccord est signale, pas efface',
           t2.bpmDoute === true && t2.bpmMesure === 128,
           'mesure gardee : ' + t2.bpmMesure);
}

/* ============================================================
   4. LE DJ AJOUTE UNE TONALITE LA OU LIAISON EN AVAIT DEDUIT UNE.
   ============================================================ */
{
  const f = path.join(BAC, 'c.mp3');
  fs.writeFileSync(f, 'audio');
  const cacheFichier = path.join(BAC, 'analyse2.json');
  const t1 = lib.finalize([{ path: f, title: 'C', bpm: 128, key: null, duration: 200 }])[0];
  const s1 = new AnalysisService(cacheFichier, {});
  s1.sansFils = true;
  s1.tracks.set(t1.id, t1);
  s1.file.set(t1.id, { priorite: 0, stamp: AnalysisCache.stamp(f) });
  s1.encours.add(t1.id);
  s1._resultat({ job: t1.id }, { id: t1.id, ok: true, patch: {
    energy: 7, timbre: [5, 5, 5], vocal: 0,
    mBpm: 128, mBpmConf: 0.4, mKey: '5A', mKeyConf: 0.5, mKeyMarge: 0.02 } });
  s1.cache.save(); s1.stop();
  verifier('4. Liaison comble la tonalite manquante, en le disant',
           t1.key === '5A' && t1.keySource === 'liaison-incertain', t1.key + ' (' + t1.keySource + ')');

  const t2 = lib.finalize([{ path: f, title: 'C', bpm: 128, key: '11A', keySrc: 'rekordbox', duration: 200 }])[0];
  const s2 = new AnalysisService(cacheFichier, {});
  s2.sansFils = true;
  s2.charger([t2]);
  s2.stop();
  verifier('4bis. la tonalite que le DJ a posee remplace l\'estimation',
           t2.key === '11A' && t2.keySource === 'rekordbox', t2.key + ' (' + t2.keySource + ')');
}

/* ============================================================
   5. UN MORCEAU ILLISIBLE A DROIT A UNE SECONDE CHANCE.

   La premiere tentative est celle qui tombe au pire moment : le
   disque qui se reveille, le fichier encore en cours de copie.
   Un echec unique ne doit pas condamner le morceau pour la soiree.
   ============================================================ */
{
  const f = path.join(BAC, 'd.mp3');
  fs.writeFileSync(f, 'audio');
  const t = lib.finalize([{ path: f, title: 'D', bpm: 128, duration: 200 }])[0];
  const s = new AnalysisService(path.join(BAC, 'analyse3.json'), {});
  s.sansFils = true;
  s.tracks.set(t.id, t);
  s.file.set(t.id, { priorite: 0, stamp: AnalysisCache.stamp(f) });
  s.encours.add(t.id);
  s._resultat({ job: t.id }, { id: t.id, ok: false, error: 'ffmpeg : delai depasse' });
  verifier('5. un premier echec ne marque pas le morceau illisible',
           !t.illisible && s.file.has(t.id), 'encore en file : ' + s.file.has(t.id));

  s.absents.delete(t.id);
  s.encours.add(t.id);
  s._resultat({ job: t.id }, { id: t.id, ok: false, error: 'ffmpeg : delai depasse' });
  verifier('5bis. le second, si', t.illisible === true && s.rates === 1,
           'echecs comptes : ' + s.rates);

  /* Et un rechargement de bibliotheque efface l'ardoise : le DJ a pu
     reparer le fichier entre-temps. */
  const t2 = lib.finalize([{ path: f, title: 'D', bpm: 128, duration: 200 }])[0];
  s.charger([t2]);
  verifier('5ter. un rechargement rend sa chance au morceau repare',
           s.reessais.size === 0);
  s.stop();
}

/* ============================================================
   6. LE CACHE D'ANALYSE NE GROSSIT PAS INDEFINIMENT.

   Sa cle contient la date du fichier : chaque retag laisse une
   entree morte derriere lui. Sur une bibliotheque vivante, le
   fichier finit par peser plusieurs fois ce qu'il devrait — et il
   est relu en entier a chaque demarrage.
   ============================================================ */
{
  const fichier = path.join(BAC, 'analyse4.json');
  const c = new AnalysisCache(fichier);
  for (let i = 0; i < 100; i++) c.data['/parti/' + i + '.mp3|1:2'] = { energy: 5 };
  c.data['/reste/a.mp3|1:2'] = { energy: 5 };
  const biblio = [{ path: '/reste/a.mp3' }];
  const retires = c.entretenir(biblio);
  verifier('6. les entrees des fichiers disparus sont elaguees',
           retires === 100 && Object.keys(c.data).length === 1, retires + ' retirees');

  /* Mais jamais quand le cache est encore de taille raisonnable :
     un disque debranche ne doit pas se faire oublier. */
  const c2 = new AnalysisCache(path.join(BAC, 'analyse5.json'));
  c2.data['/ssd/a.mp3|1:2'] = { energy: 5 };
  c2.data['/ssd/b.mp3|1:2'] = { energy: 5 };
  verifier('6bis. et jamais sur un cache de taille normale',
           c2.entretenir([{ path: '/interne/x.mp3' }]) === 0);
}

try { fs.rmSync(BAC, { recursive: true, force: true }); } catch (e) {}
if (echecs) {
  console.error('\n' + echecs + ' cas de mise a jour en echec.');
  process.exit(1);
}
console.log('\nmise a jour : ce que le DJ change dans sa bibliotheque remonte jusqu\'a Liaison.');
})();
