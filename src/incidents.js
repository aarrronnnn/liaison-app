'use strict';
/* ============================================================
   LES PANNES, RENDUES VISIBLES — SANS TRAHIR LA PROMESSE.

   Liaison ecrit deja ses pannes dans un pannes.log local. Ce
   fichier ne quitte jamais la machine. Concretement : un DJ dont
   l'app plante un samedi soir ne le dira jamais, il desinstallera
   le dimanche. Chaque defaut ne remonte que si quelqu'un est
   assez agace pour ecrire un mail — c'est-a-dire presque jamais,
   et jamais les defauts moyens.

   Mais tout l'argument de Liaison est que rien ne part de la
   machine. On ne peut donc pas poser une telemetrie ordinaire
   sans se contredire. Ce fichier existe pour tenir les deux
   bouts, et il repose sur quatre regles qui ne se negocient pas.

   1. RIEN SANS ACCORD. Aucun envoi tant que le DJ n'a pas dit
      oui. La question est posee au moment de la panne, pas au
      premier lancement : a ce moment-la elle est concrete, et
      la reponse est informee.

   2. JAMAIS PENDANT UN SET. La file est videe AU DEMARRAGE de
      l'application, avant qu'un logiciel de mix soit ouvert.
      « Aucune requete reseau pendant le set » reste vrai au mot
      pres.

   3. RIEN QUI DESIGNE QUELQU'UN. Pas d'identifiant de machine,
      pas de cle de licence, pas de nom de fichier, pas de titre.
      Les traces d'appel contiennent des chemins absolus — donc
      le prenom du DJ dans /Users/<prenom>/ — et c'est
      exactement le genre de fuite qu'on ne voit pas parce
      qu'on ne la cherche pas. anonymiser() est teste pour ca.

   4. CA NE DOIT JAMAIS GENER. Pas de reessai agressif, pas
      d'attente au demarrage, une file plafonnee, et le moindre
      echec est avale en silence. Un rapport de panne qui fait
      ramer l'app est un defaut de plus.
   ============================================================ */
const path = require('path');
const os = require('os');

/* La file est petite par dessein : au-dela, ce n'est plus un
   incident, c'est une boucle, et vingt copies de la meme trace
   n'apprennent rien de plus que deux. */
const FILE_MAX = 20;
/* Un envoi qui traine ne doit pas retarder l'ouverture du widget. */
const DELAI_MS = 4000;

/* ------------------------------------------------------------
   ANONYMISER UNE TRACE D'APPEL.

   Une trace ressemble a :

     Error: ENOENT
       at Object.openSync (node:fs:601:3)
       at /Users/marie/Music/rekordbox/master.db:12
       at /Applications/Liaison.app/Contents/Resources/app/src/library.js:88

   Deux choses a en retirer :

     - le dossier personnel, qui porte le prenom ;
     - tout ce qui vient de la bibliotheque du DJ : noms de
       fichiers musicaux, chemins de bases, titres.

   Ce qu'on GARDE : les chemins internes a Liaison, parce que
   c'est la seule information qui sert a corriger, et le nom des
   modules Node.

   La regle est volontairement brutale — on remplace d'abord, on
   verifie ensuite qu'il ne reste rien qui ressemble a un chemin
   personnel. Perdre un detail utile est sans gravite ; laisser
   passer le nom de quelqu'un ne l'est pas.
   ------------------------------------------------------------ */
const EXT_AUDIO = /\.(mp3|m4a|aac|wav|aiff?|flac|ogg|wma|alac)\b/gi;

function anonymiser(texte) {
  let t = String(texte == null ? '' : texte);

  /* 1. Le dossier personnel, sous toutes ses formes. On le fait
        en premier : les regles suivantes s'appliquent alors a un
        texte deja debarrasse du prenom. */
  let maison = '';
  try { maison = os.homedir() || ''; } catch (e) {}
  if (maison) {
    t = t.split(maison).join('~');
    /* Windows melange les separateurs selon qui construit le
       chemin : on couvre les deux ecritures. */
    t = t.split(maison.replace(/\\/g, '/')).join('~');
  }

  /* 2. Les racines de profil, meme quand homedir() n'a pas
        repondu — une trace peut venir d'un autre compte, ou
        d'un processus fils. */
  t = t.replace(/(\/Users\/)[^/\s:)"']+/g, '$1~');
  t = t.replace(/(\/home\/)[^/\s:)"']+/g, '$1~');
  t = t.replace(/([A-Za-z]:\\Users\\)[^\\\s:)"']+/gi, '$1~');

  /* 3. Tout chemin de fichier audio devient <audio>. Un nom de
        morceau est une donnee du DJ, pas un indice de panne.

        LES CHEMINS CONTIENNENT DES ESPACES. La premiere version
        de cette regle s'arretait au premier blanc : sur
        « /Volumes/USB/Sets/Bella Ciao - Hugel.mp3 » elle ne
        mangeait que « Hugel.mp3 » et laissait passer le titre du
        morceau. C'est precisement le genre de fuite qu'on ne
        voit pas, parce qu'on teste avec des noms sans espace.

        On avale donc tout ce qui precede l'extension, espaces
        compris, en ne s'arretant qu'aux caracteres qui ne
        peuvent pas appartenir a un chemin dans une trace :
        parentheses, guillemets, retour a la ligne. Et on
        n'apostrophe PAS l'extension a la fin — la reecrire
        laissait « .mp3 » dans le texte, donc propre() rejetait
        le rapport entier et on n'envoyait plus rien du tout.

        La regle deborde volontairement : « erreur sur Bella
        Ciao.mp3 » devient « <audio> ». Perdre un bout de phrase
        est sans gravite ; laisser passer la bibliotheque de
        quelqu'un ne l'est pas. */
  t = t.replace(/[^\n()"']*\.(?:mp3|m4a|aac|wav|aiff?|flac|ogg|wma|alac)\b/gi, '<audio>');

  /* 4. Les bases des logiciels de mix : le chemin exact ne dit
        rien de plus que le nom du logiciel. */
  t = t.replace(/[^\s:)"']*[\\/](rekordbox|Serato|Traktor|VirtualDJ|Music)[\\/][^\s:)"']*/gi,
                '<bibliotheque:$1>');

  /* 5. Adresses e-mail et cles de licence, au cas ou l'une
        d'elles se serait glissee dans un message d'erreur. */
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<courriel>');
  t = t.replace(/\bLSN-[A-Z0-9-]{4,}/gi, '<cle>');

  /* 6. Les adresses IP locales, qui designent un reseau. */
  t = t.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, '<ip>');

  return t;
}

/* Reste-t-il quelque chose qui ressemble a un chemin personnel ?
   C'est la ceinture apres les bretelles : si anonymiser() a
   laisse passer quelque chose, on prefere ne RIEN envoyer plutot
   qu'envoyer a moitie propre. */
function propre(texte) {
  const t = String(texte || '');
  if (/\/Users\/(?!~)[^/\s]/.test(t)) return false;
  if (/\/home\/(?!~)[^/\s]/.test(t)) return false;
  if (/[A-Za-z]:\\Users\\(?!~)[^\\\s]/i.test(t)) return false;
  if (EXT_AUDIO.test(t)) { EXT_AUDIO.lastIndex = 0; return false; }
  EXT_AUDIO.lastIndex = 0;
  return true;
}

/* La signature d'une panne : ce qui permet de dire « c'est la
   meme que l'autre fois ». On prend le message et les deux
   premieres lignes de pile, sans les numeros de ligne — sinon un
   decalage d'une ligne entre deux versions ferait deux incidents
   distincts pour un seul defaut. */
function signature(quoi, trace) {
  const lignes = String(trace || '').split('\n').map(x => x.trim()).filter(Boolean);
  const util = lignes.slice(0, 3).join(' | ').replace(/:\d+(:\d+)?/g, '');
  let h = 5381;
  const s = String(quoi || '') + '::' + util;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------
   LA FILE.

   Elle vit sur le disque, a cote du reste : une panne qui tue le
   processus ne doit pas emporter son propre rapport. Chaque
   entree porte un compteur — la meme panne dix fois de suite
   reste une entree qui dit « dix fois ».
   ------------------------------------------------------------ */
function fichierFile(dossier) { return path.join(dossier, 'incidents.json'); }

function empiler(ecrire, dossier, incident) {
  const f = fichierFile(dossier);
  let file = [];
  try { file = ecrire.lireJSON(f, []) || []; } catch (e) { file = []; }
  if (!Array.isArray(file)) file = [];
  const sig = incident.sig;
  const deja = file.find(x => x && x.sig === sig);
  if (deja) { deja.n = (deja.n | 0) + 1; deja.vu = incident.vu; }
  else if (file.length < FILE_MAX) file.push(incident);
  else return file;                      /* pleine : on laisse tomber, en silence */
  try { ecrire.ecrireJSON(f, file); } catch (e) {}
  return file;
}

function vider(ecrire, dossier) {
  try { ecrire.ecrireJSON(fichierFile(dossier), []); } catch (e) {}
}

function lire(ecrire, dossier) {
  try {
    const f = ecrire.lireJSON(fichierFile(dossier), []);
    return Array.isArray(f) ? f : [];
  } catch (e) { return []; }
}

/* Fabrique l'objet envoye. Il ne contient que ces champs-la :
   toute addition future doit passer par anonymiser() et par les
   essais de ce module. */
function batir(quoi, err, version, plateforme) {
  const brut = err && err.stack ? err.stack : String(err);
  const trace = anonymiser(brut).split('\n').slice(0, 12).join('\n').slice(0, 1800);
  if (!propre(trace)) return null;
  return {
    sig: signature(quoi, trace),
    quoi: anonymiser(String(quoi || 'inconnu')).slice(0, 120),
    trace: trace,
    v: String(version || '?'),
    os: String(plateforme || process.platform) + '/' + process.arch,
    n: 1,
    vu: Date.now()
  };
}

/* ------------------------------------------------------------
   L'ENVOI.

   Volontairement minuscule : une requete, un delai court, aucun
   reessai. Un rapport de panne qui insiste est un rapport de
   panne qui devient lui-meme le probleme — et la file survit au
   redemarrage, donc ce qui n'est pas parti ce soir partira la
   prochaine fois, sans rien demander a personne.

   On ne se sert pas du module reseau de la licence : celui-ci
   porte une cle et une identite de machine, et un rapport
   anonyme n'a rien a faire sur le meme chemin.
   ------------------------------------------------------------ */
function envoyer(url, charge, delaiMs) {
  return new Promise(resolve => {
    let fini = false;
    const fin = v => { if (!fini) { fini = true; resolve(v); } };
    let u;
    try { u = new URL(url); } catch (e) { return fin({ code: 0 }); }
    const mod = u.protocol === 'http:' ? require('http') : require('https');
    let corps = '';
    try { corps = JSON.stringify(charge); } catch (e) { return fin({ code: 0 }); }
    try {
      const req = mod.request({
        hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) }
      }, res => {
        res.resume();                       /* on ne lit pas la reponse : elle ne sert a rien */
        res.on('end', () => fin({ code: res.statusCode }));
      });
      req.on('error', () => fin({ code: 0 }));
      req.setTimeout(delaiMs || DELAI_MS, () => { req.destroy(); fin({ code: 0 }); });
      req.end(corps);
    } catch (e) { fin({ code: 0 }); }
  });
}

module.exports = { anonymiser, propre, signature, batir, empiler, vider, lire, envoyer,
                   FILE_MAX, DELAI_MS };
