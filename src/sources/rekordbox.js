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
    cb.onStatus({ ok: false, msg: 'Lecture des fichiers ouverts indisponible sous Windows',
      conseil: {
        cle: 'rekordbox-windows', quand: 'deck',
        titre: 'rekordbox sans materiel, sous Windows',
        texte: 'Liaison ne peut pas voir quels fichiers rekordbox a ouverts sous Windows.',
        marche: ['Avec un CDJ, un XDJ ou un DJM : utilise Pro DJ Link',
                 'Sinon : clique la loupe et tape deux lettres du titre'] } });
    return { stop() {} };
  }

  let timer = null, vus = new Map(), courant = null, jamaisRien = 0, annonce = false;

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
      for (const k of Array.from(vus.keys())) if (!presents.has(k)) vus.delete(k);
      for (const c of connus) vus.set(c.p, (vus.get(c.p) || 0) + 1);

      if (!connus.length) {
        if (++jamaisRien === 6 && list.length === 0) {
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

      /* Le plus stable gagne ; a egalite, le dernier apparu. */
      let best = null, bs = -1;
      for (const c of connus) {
        const n = vus.get(c.p) || 0;
        if (n >= CONFIRMATIONS && n > bs) { bs = n; best = c; }
      }
      if (!best) return;
      if (courant === best.p) return;
      courant = best.p;
      cb.onLoad({ path: best.p, track: best.t, sur: bs });
    });
  }

  timer = setInterval(tour, INTERVALLE);
  tour();
  cb.onStatus({ ok: true, msg: 'rekordbox : lecture des fichiers ouverts' });

  return { stop() { if (timer) clearInterval(timer); timer = null; } };
}

module.exports = { start, dispo, fichiersAudio, pids };
