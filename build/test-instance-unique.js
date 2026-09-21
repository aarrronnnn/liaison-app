'use strict';
/* ============================================================
   UNE SEULE LIAISON A LA FOIS.

   Rapporte par le premier acheteur, sur Windows : « pour
   installer la nouvelle version j'ai du desinstaller l'ancienne
   et redemarrer le PC car il m'en ouvrait 5 ».

   Il n'y avait aucun verrou d'instance. Chaque double-clic,
   chaque relance par l'installeur NSIS — qui lance l'application
   tout seul en fin d'installation — ouvrait une application
   complete de plus.

   Cinq Liaison en meme temps, ce n'est pas cinq fenetres en trop.
   C'est cinq processus qui lisent la meme bibliotheque sur le
   meme disque, et surtout qui reecrivent le MEME config.json et
   le meme cache de scan : le dernier qui ecrit gagne.

   Et ca explique le symptome le plus deroutant du meme rapport :
   « meme avec un titre charge sur le deck, il affiche toujours
   l'ancien ». Le widget qu'il regardait appartenait a une
   instance restee sur son etat d'il y a une heure — pendant
   qu'une autre, invisible, lisait correctement le deck.

   Ce fichier verifie les deux moities de la regle :
     — une deuxieme instance se retire, et ne demarre rien ;
     — elle sert a RAMENER la premiere, parce que relancer
       l'application est le geste naturel pour retrouver un widget
       qu'on a masque.
   ============================================================ */
const path = require('path');
const { spawnSync } = require('child_process');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(58) + (ok || !detail ? '' : '  — ' + detail));
  if (!ko && !ok) {} if (!ok) ko++;
}

console.log('\n- Une seule Liaison a la fois -\n');

/* On demarre main.js dans un processus a part, avec un faux
   Electron dont on choisit la reponse au verrou. */
function demarrer(verrouObtenu) {
  const code = `
    const Module = require('module');
    const vrai = Module._load;
    const trace = { quit: 0, prets: 0, ecoutes: [] };
    global.__trace = trace;
    Module._load = function (n, p, m) {
      if (n === 'electron') {
        const faux = require(${JSON.stringify(path.join(__dirname, 'faux-electron.js'))});
        faux.app.requestSingleInstanceLock = () => ${verrouObtenu ? 'true' : 'false'};
        faux.app.quit = () => { trace.quit++; };
        const onAvant = faux.app.on ? faux.app.on.bind(faux.app) : null;
        faux.app.on = (ev, fn) => { trace.ecoutes.push(ev); return onAvant ? onAvant(ev, fn) : faux.app; };
        const wr = faux.app.whenReady;
        faux.app.whenReady = () => ({ then: (fn) => { trace.prets++; try { fn(); } catch (e) {} return { catch(){} }; } });
        return faux;
      }
      return vrai(n, p, m);
    };
    try { require(${JSON.stringify(path.join(__dirname, '..', 'src', 'main.js'))}); } catch (e) {}
    process.stdout.write(JSON.stringify(trace));
  `;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 30000 });
  try { return JSON.parse((r.stdout || '').slice((r.stdout || '').lastIndexOf('{'))); }
  catch (e) { return { erreur: (r.stderr || r.stdout || '').slice(0, 200) }; }
}

/* ---------- la premiere instance ---------- */
const premiere = demarrer(true);
verifier('la premiere instance ne se quitte pas',
  premiere.quit === 0, JSON.stringify(premiere).slice(0, 140));
verifier('et elle ecoute l\'arrivee d\'une seconde',
  (premiere.ecoutes || []).includes('second-instance'),
  (premiere.ecoutes || []).join(', '));

/* ---------- la seconde ---------- */
const seconde = demarrer(false);
verifier('une seconde instance se retire',
  seconde.quit >= 1, JSON.stringify(seconde).slice(0, 140));
verifier('et elle n\'ecoute pas l\'arrivee d\'une troisieme',
  !(seconde.ecoutes || []).includes('second-instance'),
  (seconde.ecoutes || []).join(', '));

/* ------------------------------------------------------------
   LE VERROU EST-IL PRIS ASSEZ TOT ?

   Une deuxieme instance qui lit la config avant de s'apercevoir
   qu'elle est de trop a deja pose ses valeurs par defaut dans le
   fichier de la premiere. Le verrou doit donc etre demande AVANT
   loadConfig — on verifie l'ordre dans le fichier, la seule facon
   de le tenir sans demarrer une vraie application.
   ------------------------------------------------------------ */
const fs = require('fs');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const iVerrou = src.indexOf('requestSingleInstanceLock');
const iConfig = src.indexOf('loadConfig();');
verifier('le verrou est demande avant toute lecture de configuration',
  iVerrou > 0 && iConfig > 0 && iVerrou < iConfig,
  'verrou@' + iVerrou + ' config@' + iConfig);

/* Et le corps du demarrage doit etre garde, sinon la seconde
   instance fait son travail avant que app.quit() n'aboutisse. */
verifier('le corps du demarrage est garde par le verrou',
  /whenReady\(\)\.then\(async \(\) => \{\s*(\/\*[\s\S]*?\*\/\s*)?if \(!SEULE_INSTANCE\) return;/.test(src));

console.log(ko ? '\n' + ko + ' cas en echec.\n'
               : '\ninstance : une seule Liaison demarre, la seconde ramene la premiere.\n');
process.exit(ko ? 1 : 0);
