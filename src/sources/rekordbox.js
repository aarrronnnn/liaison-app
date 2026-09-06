'use strict';
/* ============================================================
   rekordbox, sans materiel.

   Le probleme, remonte par un vrai test : rekordbox tourne, un
   morceau joue, et le widget affiche « en attente du deck » sans
   fin. Ce n'est pas une panne. Pro DJ Link — le seul protocole
   qui annonce ce qui est charge sur un deck — est diffuse par le
   MATERIEL : un CDJ, un XDJ, un DJM. rekordbox lance seul sur un
   portable n'emet rien. Le DJ qui essaie Liaison chez lui, donc
   presque tout le monde le premier soir, ne voit jamais rien.

   rekordbox ne publie pas non plus le morceau en cours : Pioneer
   l'a confirme sur son propre forum, il n'existe aucune fonction
   pour cela dans le logiciel. Sa bibliotheque et son historique
   vivent dans une base chiffree, qu'on ne dechiffrera pas : il
   faudrait pour cela une cle extraite du logiciel de Pioneer, ce
   qui n'a pas sa place dans un produit qu'on vend.

   Reste ce que le systeme d'exploitation dit de lui-meme : quels
   FICHIERS rekordbox tient ouverts. Charger un morceau sur un
   deck, c'est ouvrir son fichier. On lit donc la liste des
   descripteurs du processus — la meme information que donne le
   moniteur d'activite — et on garde les fichiers audio qui sont
   dans la bibliotheque.

   Ce que ca vaut, honnetement :

     — c'est une DEDUCTION, pas une annonce. rekordbox ne nous dit
       rien ; on observe. Un fichier ouvert pour un apercu dans le
       navigateur ressemble a un fichier charge sur un deck.
     — d'ou la regle de prudence ci-dessous : un candidat doit
       tenir DEUX relevés consecutifs avant d'etre retenu. Les
       apercus de navigation ne durent pas six secondes.
     — ca ne marche pas sous Windows, ou lister les fichiers
       ouverts d'un autre processus demande un outil qu'on ne peut
       pas embarquer. On le dit, on ne fait pas semblant.

   Avec du materiel, Pro DJ Link reste meilleur : il donne le deck,
   le BPM et l'etat de lecture. Cette source-ci est le filet pour
   le portable seul.
   ============================================================ */
const { execFile } = require('child_process');
const path = require('path');

const AUDIO = /\.(mp3|wav|aiff?|flac|m4a|aac|ogg|wma)$/i;
const INTERVALLE = 3000;
/* Deux relevés : assez pour ecarter un apercu, assez court pour
   que le morceau soit reconnu avant la fin de son intro. */
const CONFIRMATIONS = 2;

const dispo = process.platform !== 'win32';

function run(cmd, args, cb) {
  try {
    execFile(cmd, args, { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => cb(err ? '' : String(out || '')));
  } catch (e) { cb(''); }
}

/** Les processus rekordbox en cours. */
function pids(cb) {
  run('pgrep', ['-i', '-f', 'rekordbox'], out => {
    const l = out.split('\n').map(s => s.trim()).filter(s => /^\d+$/.test(s));
    cb(l.slice(0, 4));
  });
}

/** Les fichiers audio qu'un processus tient ouverts. */
function fichiersAudio(pid, cb) {
  /* -Fn : une ligne par champ, les noms prefixes par « n ».
     Format stable, et bien plus simple a lire que le tableau. */
  run('lsof', ['-p', String(pid), '-Fn'], out => {
    const set = [];
    for (const ligne of out.split('\n')) {
      if (ligne.charCodeAt(0) !== 110 /* n */) continue;
      const p = ligne.slice(1);
      if (p && AUDIO.test(p)) set.push(p);
    }
    cb(set);
  });
}

function tousLesFichiers(cb) {
  pids(list => {
    if (!list.length) return cb(null);          /* rekordbox n'est pas lance */
    let reste = list.length;
    const acc = [];
    for (const pid of list) {
      fichiersAudio(pid, fs => {
        for (const f of fs) if (acc.indexOf(f) < 0) acc.push(f);
        if (--reste === 0) cb(acc);
      });
    }
  });
}

/**
 * @param opts.resoudre  (chemin) => morceau de la bibliotheque, ou null
 * @param cb  { onLoad({path, track}), onStatus(s) }
 */
function start(opts, cb) {
  opts = opts || {};
  const resoudre = opts.resoudre || (() => null);

  if (!dispo) {
    /* ------------------------------------------------------------
       Windows, et la verite qu'on doit a l'utilisateur.

       Sous macOS, on deduit le morceau charge des fichiers que
       rekordbox tient ouverts. Windows ne permet pas de lister les
       fichiers ouverts d'un autre processus sans outil tiers ni
       droits administrateur — et rekordbox ne publie rien de son
       cote : Pioneer l'a confirme sur son propre forum.

       Il n'y a donc, aujourd'hui, aucun moyen honnete de lire le
       deck de rekordbox sous Windows sans materiel. On ne fait pas
       semblant de chercher : on le dit, et on montre le chemin qui
       marche — deux lettres dans la loupe, et Liaison enchaine.
       ------------------------------------------------------------ */
    cb.onStatus({ ok: false, msg: 'rekordbox sous Windows : declare le morceau a la main',
      conseil: {
        cle: 'rekordbox-windows', quand: 'deck',
        titre: 'rekordbox sous Windows, sans materiel',
        texte: 'rekordbox n\'annonce pas ce qu\'il joue, et Windows ne permet pas de le deviner. ' +
               'Ce n\'est pas une panne : c\'est une limite du logiciel de Pioneer.',
        marche: ['Clique la loupe en haut, tape deux lettres du titre',
                 'Liaison propose la suite, avec les points de mix',
                 'Une seule frappe par morceau, pas plus'],
        repli: 'Avec un CDJ, un XDJ ou un DJM sur le reseau, le deck est lu automatiquement. ' +
               'Serato, Traktor et VirtualDJ le sont aussi, sans materiel.'
      } });
    return { stop() {} };
  }

  let timer = null, vus = new Map(), courant = null, jamaisRien = 0, annonce = false;
  /* apparu : ordre d'arrivee de chaque fichier, pour savoir lequel
     vient d'etre charge. horloge : un simple compteur croissant. */
  const apparu = new Map();
  let horloge = 0;

  function tour() {
    tousLesFichiers(list => {
      if (list === null) {
        vus.clear();
        if (!annonce) { annonce = true; cb.onStatus({ ok: false, msg: 'rekordbox n\'est pas lance' }); }
        return;
      }
      annonce = false;

      /* Les candidats : les fichiers ouverts qui existent dans la
         bibliotheque. Un fichier ouvert qu'on ne connait pas ne
         sert a rien — on ne saurait pas quoi en faire. */
      const connus = [];
      for (const p of list) { const t = resoudre(p); if (t) connus.push({ p, t }); }

      /* Compteur de stabilite : +1 par relevé ou le fichier est la,
         remis a zero des qu'il disparait. */
      const presents = new Set(connus.map(c => c.p));
      for (const k of Array.from(vus.keys())) if (!presents.has(k)) { vus.delete(k); apparu.delete(k); }
      for (const c of connus) {
        vus.set(c.p, (vus.get(c.p) || 0) + 1);
        /* premiere apparition : on horodate, une fois pour toutes */
        if (!apparu.has(c.p)) apparu.set(c.p, ++horloge);
      }

      if (!connus.length) {
        jamaisRien++;
        /* ------------------------------------------------------------
           Le cas qu'on traversait en silence.

           rekordbox tient des fichiers audio ouverts, mais AUCUN ne
           correspond a un morceau de la bibliotheque de Liaison. Le
           widget restait alors « en attente », indefiniment, sans un
           mot — c'est le pire des etats : rien ne marche et rien ne
           l'explique.

           Trois causes, par ordre de frequence :
             — la bibliotheque de Liaison ne couvre pas le dossier ou
               vivent reellement les fichiers (typiquement une
               bibliotheque Musique/iTunes, alors que Liaison a
               importe un XML rekordbox qui pointe ailleurs) ;
             — les fichiers sont sur un disque externe debranche
               depuis l'import ;
             — le dossier n'est pas lisible par l'application.

           On le dit, avec le chemin reel sous les yeux : c'est la
           seule information qui permette a quelqu'un de comprendre
           en cinq secondes ce qui se passe.
           ------------------------------------------------------------ */
        if (jamaisRien === 4 && list.length > 0) {
          const exemple = list[0];
          const dossier = exemple.slice(0, exemple.lastIndexOf('/')) || exemple;
          cb.onStatus({ ok: false,
            msg: 'rekordbox joue un fichier que Liaison n\'a pas dans sa bibliotheque',
            conseil: {
              cle: 'rekordbox-hors-bibliotheque', quand: 'deck',
              titre: 'Le morceau joue n\'est pas dans ta bibliotheque Liaison',
              texte: 'rekordbox lit bien un fichier, mais il ne fait pas partie des morceaux ' +
                     'que Liaison connait. C\'est presque toujours un dossier oublie a l\'import — ' +
                     'une bibliotheque Musique ou iTunes, par exemple, alors que Liaison n\'a lu ' +
                     'que le dossier rekordbox.\n\nDossier concerne : ' + dossier,
              marche: ['Ouvre Reglages, section Bibliotheque',
                       'Ajoute le dossier ci-dessus',
                       'Relance l\'import : Liaison retrouvera le morceau tout seul'],
              repli: 'Si les fichiers sont sur un disque externe, rebranche-le avant de relancer ' +
                     'rekordbox : un chemin absent a l\'import ne peut pas etre retrouve.' } });
        }
        if (jamaisRien === 6 && list.length === 0) {
          cb.onStatus({ ok: false, msg: 'rekordbox est lance, mais ne tient aucun fichier audio ouvert',
            conseil: {
              cle: 'rekordbox-rien-ouvert', quand: 'deck',
              titre: 'rekordbox ne laisse rien voir',
              texte: 'rekordbox est bien lance, mais il ne garde aucun fichier audio ouvert : ' +
                     'Liaison ne peut pas deduire ce qui tourne.',
              marche: ['Clique la loupe en haut et tape deux lettres du titre',
                       'Liaison enchaine ensuite normalement'],
              repli: 'Avec un CDJ ou un DJM sur le reseau, Pro DJ Link donne le deck directement.' } });
        }
        return;
      }
      jamaisRien = 0;

      /* ------------------------------------------------------------
         Le dernier arrive gagne, pas le plus ancien.

         Cette regle disait « le plus stable gagne », le plus stable
         etant celui dont le compteur de presence est le plus haut.
         C'est exactement l'inverse de ce qu'il faut.

         rekordbox ne referme pas tout de suite le fichier du
         morceau precedent : il le garde ouvert un moment apres le
         changement de deck. Le morceau qu'on vient de charger
         demarre donc a 1, pendant que celui d'avant est a 12 — et
         gagnait a chaque relevé. Le widget affichait le morceau
         PRECEDENT, indefiniment, et proposait des enchainements
         pour un titre qui ne tournait plus. Un decalage constant
         d'un morceau : le defaut se voyait sans se comprendre.

         La stabilite est une PORTE, pas un classement : elle sert a
         ecarter les apercus de navigation, qui ne durent pas deux
         relevés. Une fois cette porte franchie, c'est le fichier
         apparu le plus RECEMMENT qui tourne.

         On retient donc l'ordre d'apparition, et on prend le plus
         jeune des candidats confirmes.
         ------------------------------------------------------------ */
      let best = null, bv = -1;
      for (const c of connus) {
        const n = vus.get(c.p) || 0;
        if (n < CONFIRMATIONS) continue;          /* pas encore confirme */
        const ne = apparu.get(c.p) || 0;
        if (ne > bv) { bv = ne; best = c; }       /* le plus recemment apparu */
      }
      if (!best) return;
      if (courant === best.p) return;
      courant = best.p;
      cb.onLoad({ path: best.p, track: best.t, sur: vus.get(best.p) || 0 });
    });
  }

  timer = setInterval(tour, INTERVALLE);
  tour();
  cb.onStatus({ ok: true, msg: 'rekordbox : lecture des fichiers ouverts' });

  return { stop() { if (timer) clearInterval(timer); timer = null; } };
}

module.exports = { start, dispo, fichiersAudio, pids };
