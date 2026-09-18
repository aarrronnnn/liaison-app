'use strict';
/* ============================================================
   L'analyse, en arriere-plan et dans l'ordre utile.

   Le probleme, mesure sur une vraie bibliotheque : 22 000 titres
   a deux secondes de calcul chacun font douze heures de processeur.
   Les faire tous avant d'ouvrir le widget, c'est demander au DJ
   d'attendre une nuit. Et si l'app se ferme en route, tout est
   perdu.

   Trois decisions, dans cet ordre d'importance :

   1. LA BIBLIOTHEQUE EST UTILISABLE TOUT DE SUITE.
      Le titre, l'artiste, le BPM et la tonalite viennent deja de
      la base du logiciel de mix : ce sont les quatre champs dont
      le moteur a vraiment besoin. L'energie et le timbre affinent
      le classement — ils ne le conditionnent pas. On demarre donc
      avec des valeurs par defaut et on les remplace au fil de
      l'eau.

   2. ON ANALYSE CE QUI SERT MAINTENANT, PAS L'ORDRE ALPHABETIQUE.
      Le morceau qui tourne, puis ceux que le moteur propose, puis
      le reste. Un DJ qui joue trois heures n'aura jamais eu besoin
      des 22 000 : il aura eu besoin des deux cents autour de ce
      qu'il jouait.

   3. RIEN N'EST JAMAIS PERDU.
      Le cache est ecrit toutes les cinq secondes, par fichier
      temporaire puis renommage — une coupure de courant au pire
      moment coute cinq secondes de calcul, jamais la bibliotheque.

   S'y ajoute le cas du disque externe : un DJ debranche son SSD,
   et 18 000 fichiers deviennent illisibles. On ne veut ni bloquer,
   ni brûler la file a essayer. On marque, on passe, on reessaiera
   quand le disque reviendra.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');
const lib = require('./library');

const SAUVE_MS = 5000;         /* on n'ecrit jamais plus souvent que ca */
const RELANCE_MS = 60000;      /* delai avant de reessayer un fichier absent */

/* ------------------------------------------------------------
   Le cache sur disque.

   Cle = chemin + taille + date de modification. Un morceau
   re-tague dans Serato est donc reanalyse, un morceau simplement
   deplace aussi — c'est le prix d'une cle qu'on peut calculer
   sans lire le fichier.
   ------------------------------------------------------------ */
/* ============================================================
   LA VERSION DE LA MESURE.

   A monter des que analyze.js change sa facon de mesurer.

   Sans ce numero, une correction de l'analyse ne serait JAMAIS
   visible chez un DJ qui utilise deja Liaison — et c'est le
   defaut le plus sournois de tout le projet. La cle du cache est
   « chemin + taille + date de modification » : corriger notre
   calcul ne change aucun des trois. Les vingt-deux mille resultats
   deja ranges — energie 5 pour tout le monde, densite calculee a
   l'envers, ballades annoncees au double de leur tempo — seraient
   relus tels quels a chaque demarrage, pour toujours. Le DJ
   installerait la mise a jour et ne verrait strictement aucune
   difference.

   Quand le numero change, on repart de zero. C'est plusieurs
   heures de calcul de fond sur une grosse bibliotheque — mais le
   morceau qui tourne, lui, passe devant tout le monde et est
   mesure en quelques secondes. main.js previent le DJ.

     1 — jusqu'a 1.4.6
     2 — energie et densite refaites, fenetre d'octave a 70 BPM,
         chroma par pics : plus rien de comparable a la version 1
   ============================================================ */
const VERSION_MESURE = 2;

class AnalysisCache {
  constructor(file) {
    this.file = file;
    this.perimee = false;
    this.data = this._load();
    this.sale = false;
    this.timer = null;
  }
  _load() {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (e) { return {}; }
    if (!j || typeof j !== 'object') return {};
    if (j.__mesure === VERSION_MESURE && j.e) return j.e;
    /* Un fichier d'une autre version de mesure, ou de l'ancien
       format sans version : il a servi, il ne sert plus. */
    if (Object.keys(j).length) this.perimee = true;
    return {};
  }
  static stamp(p) {
    try { const s = fs.statSync(p); return s.size + ':' + Math.round(s.mtimeMs); }
    catch (e) { return null; }        /* null = fichier injoignable */
  }
  key(p, stamp) { return p + '|' + stamp; }
  get(p, stamp) { return this.data[this.key(p, stamp)] || null; }
  set(p, stamp, patch) {
    this.data[this.key(p, stamp)] = patch;
    this.sale = true;
    this.programmer();
  }
  /* Ecriture differee : on regroupe les resultats qui arrivent en
     rafale plutot que de reecrire un fichier de plusieurs mega a
     chaque morceau. */
  programmer() {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.save(); }, SAUVE_MS);
    if (this.timer.unref) this.timer.unref();
  }
  /* Ecriture atomique : on ecrit a cote, puis on renomme. Un
     renommage est atomique sur les trois systemes ; une ecriture
     directe interrompue laisse un JSON tronque, donc un cache
     entierement perdu au prochain demarrage. */
  save() {
    if (!this.sale) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ __mesure: VERSION_MESURE, e: this.data }));
      fs.renameSync(tmp, this.file);
      this.sale = false;
    } catch (e) { /* on reessaiera au prochain lot */ }
  }
  /* ------------------------------------------------------------
     L'ENTRETIEN — un cache qui ne fait que grandir.

     Le cache de tags a le sien depuis longtemps ; celui de l'analyse
     n'en avait aucun. Or sa cle est « chemin + taille + date » :
     chaque fois qu'un DJ retague un morceau, reconvertit un fichier
     ou le remplace par une meilleure version, l'ANCIENNE entree
     reste, pour toujours. Sur une bibliotheque vivante, le fichier
     finit par peser plusieurs fois ce qu'il devrait — et il est relu
     en entier a chaque demarrage, sur le fil qui ouvre le widget.

     On n'elague qu'au-dela de trois fois la taille de la
     bibliotheque, et on ne retire que ce dont le CHEMIN n'existe
     plus dans la bibliotheque courante. Un disque externe debranche
     n'a donc rien a craindre : ses morceaux sont toujours dans la
     bibliotheque, seulement injoignables.
     ------------------------------------------------------------ */
  entretenir(library) {
    const n = Object.keys(this.data).length;
    if (!library || !library.length || n < library.length * 3) return 0;
    const chemins = new Set();
    for (const t of library) if (t.path) chemins.add(t.path);
    let retires = 0;
    for (const cle of Object.keys(this.data)) {
      const chemin = cle.slice(0, cle.lastIndexOf('|'));
      if (!chemins.has(chemin)) { delete this.data[cle]; retires++; }
    }
    if (retires) { this.sale = true; this.programmer(); }
    return retires;
  }

  get taille() { return Object.keys(this.data).length; }
}

/* ------------------------------------------------------------
   La file.
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   Les deux regles de desaccord, identiques a celles de health.js
   qui les utilise deja pour la jauge de sante. Elles sont ici parce
   que l'analyse ne doit pas dependre de l'ecran de sante.
   ------------------------------------------------------------ */
const SUR_TEMPO = 0.55;
const SUR_TONALITE = 0.72;
const MARGE_TONALITE = 0.04;

function desaccordTempo(a, b) {
  if (!(a > 0) || !(b > 0)) return false;
  /* le double, la moitie et le tiers decrivent le meme rythme */
  for (const r of [1, 2, 0.5, 3, 1 / 3]) {
    if (Math.abs(b * r - a) / a < 0.02) return false;
  }
  return true;
}

function desaccordTonalite(a, b) {
  if (!a || !b || a === b) return false;
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  const la = String(a).slice(-1).toUpperCase(), lb = String(b).slice(-1).toUpperCase();
  if (!na || !nb) return false;
  if (na === nb) return false;                 /* relatif majeur/mineur */
  const d = Math.min((na - nb + 12) % 12, (nb - na + 12) % 12);
  return d > 1;                                /* au-dela du voisin immediat */
}

class AnalysisService {
  /**
   * @param {string} cacheFile
   * @param {object} opt { workers, onProgress, onTrack }
   */
  constructor(cacheFile, opt) {
    opt = opt || {};
    this.cache = new AnalysisCache(cacheFile);
    /* Un fil de moins que de coeurs, plafonne a 3. Au-dela, les
       ffmpeg concurrents se disputent le disque et le total ne
       descend plus — et le DJ, lui, veut sa machine pour mixer. */
    this.nWorkers = Math.max(1, Math.min((os.cpus() || { length: 2 }).length - 1, 3));
    this.onProgress = opt.onProgress || (() => {});
    this.onTrack = opt.onTrack || (() => {});

    this.tracks = new Map();      /* id -> morceau */
    this.file = new Map();        /* id -> { priorite, stamp } */
    this.encours = new Set();
    this.faits = 0;
    this.total = 0;
    this.absents = new Map();     /* id -> quand reessayer */
    this.reessais = new Map();    /* id -> tentatives deja faites */
    this.workers = [];
    this.libres = [];
    this.arrete = false;
    this.dernierRapport = 0;
    this.rapportTimer = null;
    /* ------------------------------------------------------------
       CE QUI RATE, COMPTE ET GARDE.

       Quand analyze() echouait, le morceau recevait energie 5,
       timbre [5,5,5], la marque « analyse », et le message
       d'erreur partait a la poubelle. Sur une machine ou ffmpeg
       ne demarre pas, TOUS les morceaux finissaient ainsi : le DJ
       voyait « ENERGIE 5 » partout, aucun tempo, aucune tonalite,
       et pas un mot d'explication. Il a fallu une capture d'ecran
       et une engueulade pour le decouvrir.

       On compte donc les echecs, on garde le dernier message, et
       main.js le montre des qu'il y en a assez pour que ce ne soit
       plus un accident.
       ------------------------------------------------------------ */
    this.rates = 0;
    this.reussis = 0;
    this.derniereErreur = null;
    this.mesuresUtiles = 0;   /* analyses qui ont rendu un tempo */
  }

  /* ---- fils ---- */
  _demarrerWorkers() {
    if (this.workers.length) return;
    const f = path.join(__dirname, 'analyze-worker.js').replace('app.asar', 'app.asar.unpacked');
    for (let i = 0; i < this.nWorkers; i++) {
      let w;
      try { w = new Worker(f); } catch (e) { break; }
      w.on('message', msg => this._resultat(w, msg));
      /* Un fil qui meurt ne doit pas emporter la file : on le
         remplace au prochain tour, et le morceau qu'il traitait
         retourne dans la file. */
      w.on('error', () => this._perdu(w));
      w.on('exit', () => this._perdu(w));
      w.libre = true;
      this.workers.push(w);
      this.libres.push(w);
    }
    /* Aucun fil possible (systeme verrouille, asar mal deplie) :
       on ne fait pas semblant. Le reste de l'app fonctionne avec
       les valeurs par defaut, et on le dit. */
    this.sansFils = this.workers.length === 0;
  }

  _perdu(w) {
    if (w.job != null) { this._rendre(w.job); w.job = null; }
    this.workers = this.workers.filter(x => x !== w);
    this.libres = this.libres.filter(x => x !== w);
    if (!this.arrete && this.workers.length < this.nWorkers) {
      setTimeout(() => {
        /* Vider le tableau ne tue pas les fils : il oublie seulement
           leurs references. Les fils vivants continuaient de tourner
           avec leur ffmpeg, et le morceau qu'ils traitaient restait
           bloque dans « en cours » pour toujours — donc jamais rejoue,
           et la barre de progression ne retombait jamais a zero. Sur
           trois fils remplaces, cinq restaient en vie. */
        for (const w of this.workers) {
          if (w.job != null) { this._rendre(w.job); w.job = null; }
          try { w.terminate(); } catch (e) {}
        }
        this.workers.length = 0; this.libres.length = 0;
        this._demarrerWorkers(); this._pousser();
      }, 1500);
    }
  }

  _rendre(id) {
    this.encours.delete(id);
    const e = this.file.get(id);
    if (e) e.priorite = Math.max(0, e.priorite - 1);
  }

  /**
   * Enregistre la bibliotheque. Applique immediatement ce qui est
   * deja en cache, met le reste en file.
   * @returns {{caches:number, aFaire:number}}
   */
  charger(library) {
    this.tracks.clear();
    this.file.clear();
    this.faits = 0;
    /* ------------------------------------------------------------
       Une bibliotheque qui se recharge remet les compteurs d'echec
       a zero.

       Le DJ qui voit un morceau marque illisible fait la chose la
       plus naturelle du monde : il le reconvertit, il le retague,
       il rebranche le bon disque, et il relance la lecture. Si on
       gardait le compteur de tentatives, son morceau repare
       resterait illisible pour toute la session — et il n'aurait
       aucun moyen de comprendre pourquoi.
       ------------------------------------------------------------ */
    this.reessais.clear();
    this.absents.clear();
    let caches = 0;

    for (const t of library) {
      this.tracks.set(t.id, t);
      if (!t.path) { t.analyzed = true; continue; }
      const st = AnalysisCache.stamp(t.path);
      if (st === null) {
        /* fichier injoignable : disque externe debranche, ou
           bibliotheque qui pointe un morceau efface */
        t.offline = true;
        this.absents.set(t.id, Date.now() + RELANCE_MS);
        this.file.set(t.id, { priorite: 0, stamp: null });
        continue;
      }
      const c = this.cache.get(t.path, st);
      if (c) { Object.assign(t, c); this._arbitrer(t, c); t.analyzed = true; caches++; continue; }
      this.file.set(t.id, { priorite: 0, stamp: st });
    }

    this.total = this.file.size;
    this.cache.entretenir(library);
    this._rapport(true);
    return { caches: caches, aFaire: this.total, mesurePerimee: !!this.cache.perimee };
  }

  /* ------------------------------------------------------------
     Le morceau qui joue et qui n'est pas dans la bibliotheque.

     charger() ne connait que la bibliotheque, et le service ne sait
     analyser que ce qu'il connait. Un titre achete hier, pose sur
     une cle USB ou range dans un dossier jamais importe n'avait donc
     aucun moyen d'etre mesure — alors que rekordbox nous donnait son
     chemin complet et que le fichier etait la, lisible, sous nos
     yeux.

     Il passe devant tout le monde : c'est celui que le DJ ecoute.
     ------------------------------------------------------------ */
  ajouter(t, force) {
    if (!t || t.id == null) return false;
    this.tracks.set(t.id, t);
    if (!t.path) { t.analyzed = true; return false; }
    const st = AnalysisCache.stamp(t.path);
    if (st === null) { t.offline = true; return false; }
    const c = this.cache.get(t.path, st);
    if (c) { Object.assign(t, c); this._arbitrer(t, c); t.analyzed = true; this._rapport(); return true; }
    const p = force == null ? 2 : force;
    const e = this.file.get(t.id);
    if (e) { if (p > e.priorite) e.priorite = p; }
    else { this.file.set(t.id, { priorite: p, stamp: st }); this.total++; }
    this._rapport();
    this._pousser();
    return true;
  }

  /**
   * Fait passer des morceaux devant. C'est le coeur du systeme :
   * le moteur dit ce qu'il regarde, l'analyse suit.
   * @param {Array<number>} ids
   * @param {number} force 2 = le morceau qui tourne, 1 = une suggestion
   */
  prioriser(ids, force) {
    let bouge = false;
    for (const id of ids || []) {
      const e = this.file.get(id);
      if (!e || this.encours.has(id)) continue;
      const p = force == null ? 1 : force;
      if (p > e.priorite) { e.priorite = p; bouge = true; }
    }
    if (bouge) this._pousser();
  }

  demarrer() {
    if (this.arrete) return;
    this._demarrerWorkers();
    this._pousser();
  }

  /** Choisit le prochain morceau : priorite d'abord, ordre ensuite. */
  _suivant() {
    const maintenant = Date.now();
    let best = null, bestP = -1;
    for (const [id, e] of this.file) {
      if (this.encours.has(id)) continue;
      const retry = this.absents.get(id);
      if (retry != null && retry > maintenant) continue;     /* disque encore absent */
      if (e.priorite > bestP) { bestP = e.priorite; best = id; if (bestP >= 2) break; }
    }
    return best;
  }

  _pousser() {
    if (this.arrete || this.sansFils) return;
    /* ------------------------------------------------------------
       Le disque qui s'absente ne doit pas geler la soiree.

       Sur fichier injoignable, la boucle faisait « continue » SANS
       consommer de fil : elle traversait donc toute la file. Et
       _suivant() reparcourt la Map entiere a chaque appel. Sur dix-
       huit mille morceaux restants, c'est un parcours en n carre,
       plus un statSync par morceau, sur le fil qui tient le widget.

       Scenario : le SSD externe s'endort pendant le repas, ou se
       demonte au reveil de veille. Le marquage « absent » expire au
       bout d'une minute, et prioriser() rappelle _pousser() a CHAQUE
       changement de morceau — donc la traversee complete recommence,
       toute la nuit.

       On borne donc le nombre d'echecs consecutifs par passe : au
       troisieme fichier introuvable, on arrete et on reessaiera plus
       tard. Le disque revenu, tout repart tout seul.
       ------------------------------------------------------------ */
    let echecs = 0;
    while (this.libres.length) {
      const id = this._suivant();
      if (id == null) return;
      const t = this.tracks.get(id);
      const e = this.file.get(id);
      if (!t || !e) { this.file.delete(id); if (++echecs >= 3) return; continue; }

      /* le disque est-il revenu ? */
      const st = AnalysisCache.stamp(t.path);
      if (st === null) {
        t.offline = true;
        this.absents.set(id, Date.now() + RELANCE_MS);
        if (++echecs >= 3) return;    /* le volume est parti : on n'insiste pas */
        continue;
      }
      echecs = 0;
      if (t.offline) { t.offline = false; this.absents.delete(id); }
      e.stamp = st;

      /* une derniere chance au cache : le fichier a pu etre
         analyse par une autre session entre-temps */
      const c = this.cache.get(t.path, st);
      if (c) { Object.assign(t, c); this._arbitrer(t, c); t.analyzed = true; this.file.delete(id); this.faits++; this._rapport(); continue; }

      const w = this.libres.pop();
      w.job = id;
      this.encours.add(id);
      w.postMessage({ id: id, path: t.path, seconds: 90 });
    }
  }

  /* ------------------------------------------------------------
     L'ARBITRAGE, SORTI DE _resultat().

     Il y vivait, et il n'y tournait donc QUE sur une analyse
     fraiche. Or la quasi-totalite des morceaux d'un DJ qui utilise
     deja Liaison arrive par le cache : charger() y trouve la
     mesure, la recopie sur le morceau, et l'arbitrage n'etait
     jamais joue. Consequence exacte : on corrige la regle, le DJ
     installe la mise a jour, et il ne voit strictement aucune
     difference — le meme defaut que VERSION_MESURE existe pour
     eviter, revenu par une autre porte.

     L'arbitrage est donc une methode, appelee aux TROIS endroits
     ou une mesure rencontre un morceau : le cache au chargement,
     le cache a l'ajout, et le resultat d'un fil.
     ------------------------------------------------------------ */
  _arbitrer(t, patch) {
    if (!t || !patch) return;
    /* ============================================================
       QUI A RAISON, ET SELON QUOI.

       Trois regles se sont succede ici avant celle-ci :

         1. « le tag prime toujours » — une bibliotheque iTunes de
            quinze ans passait ses erreurs au moteur ;
         2. « on corrige quand le tag ment et qu'on est sur » ;
         3. « notre mesure fait toujours foi » — coherent, mais
            elle ecrasait aussi la grille de rekordbox, sur
            laquelle le DJ a pose ses reperes et cale ses mix.

       La quatrieme, celle-ci, ne demande plus « qui mesure le
       mieux » mais « d'ou vient ce chiffre ». Un BPM pose par
       rekordbox, Serato, Traktor ou VirtualDJ vient d'une analyse
       qui a servi a construire une grille de temps : on ne le
       touche pas, on signale seulement quand on n'est pas
       d'accord. Un BPM venu d'iTunes ou d'un tag ID3 est une
       saisie : notre mesure le corrige des qu'elle est sure.

       C'est ce qui repond a Mamma Mia : 105 dans un champ iTunes
       contre 130 mesures avec confiance, la mesure gagne. Et si
       c'etait rekordbox qui disait 105, le DJ mixerait a 105 —
       c'est son beatgrid, pas le notre, et lui contredire en
       cabine ne servirait a rien.

       On garde toujours l'ancienne valeur, dans les deux sens :
       le DJ doit pouvoir voir ce que son logiciel disait, et nous
       contredire.
       ============================================================ */
    const FORT = 3;
    const rangBpm = t.bpm > 0 ? lib.fiabilite(t.bpmSrc) : 0;
    const rangKey = t.key ? lib.fiabilite(t.keySrc) : 0;

    const surTempo = patch.mBpm > 40 && patch.mBpmConf >= SUR_TEMPO;
    /* La marge compte autant que la correlation. Deux tonalites
       voisines obtiennent presque la meme note : quand elles sont
       a egalite, on n'a pas mesure une tonalite, on a tire a pile
       ou face — et ce n'est pas avec ca qu'on contredit le DJ. */
    const surTonalite = patch.mKey && patch.mKeyConf >= SUR_TONALITE
                        && (patch.mKeyMarge === undefined || patch.mKeyMarge >= MARGE_TONALITE);
    const mesureBpm = patch.mBpm > 40 ? Math.round(patch.mBpm * 10) / 10 : 0;

    /* ---------------- le tempo ---------------- */
    if (!rangBpm) {
      /* Rien du tout : n'importe quelle mesure vaut mieux qu'un
         vide, et on dit franchement laquelle des deux c'est. */
      if (mesureBpm) {
        t.bpm = mesureBpm;
        t.bpmDeduit = true;
        t.bpmSource = surTempo ? 'liaison' : 'liaison-incertain';
      }
    } else if (rangBpm >= FORT) {
      /* Une grille de temps posee par un vrai analyseur. On la
         garde — mais on ne se tait pas : health.js montre au DJ
         les morceaux ou nous ne sommes pas d'accord, pour qu'il
         aille les reanalyser dans SON logiciel. */
      t.bpmSource = t.bpmSrc;
      if (surTempo && desaccordTempo(t.bpm, mesureBpm)) {
        t.bpmDoute = true;
        t.bpmMesure = mesureBpm;
      }
    } else if (surTempo) {
      /* Une saisie, contre une mesure sure : la mesure gagne. */
      const avant = t.bpm;
      /* ------------------------------------------------------------
         L'OCTAVE DU DJ, PAS LA NOTRE.

         Un morceau a 140 peut se compter a 70 : c'est le meme
         rythme, et notre estimateur ramene d'ailleurs tout entre
         70 et 190 pour cette raison. Mais si le logiciel du DJ
         annonce 140, sa grille est calee sur 140, ses reperes
         sont a 140, et il pense a 140. Lui afficher 70 parce que
         notre peigne a resonne une octave plus bas serait juste
         en theorie et insupportable en cabine.

         Quand les deux valeurs decrivent le meme rythme mais pas
         la meme octave, on garde la sienne. Quand c'est la meme
         octave, on garde la notre : elle est plus precise au
         dixieme pres.
         ------------------------------------------------------------ */
      const memeRythme = !desaccordTempo(avant, mesureBpm);
      const memeOctave = memeRythme && Math.abs(mesureBpm - avant) / avant < 0.06;
      if (memeRythme && !memeOctave) {
        t.bpmSource = t.bpmSrc;        /* son octave, confirmee par nous */
      } else {
        t.bpm = mesureBpm;
        t.bpmSource = 'liaison';
        if (!memeRythme) { t.bpmTag = avant; t.bpmCorrige = true; }
      }
    } else {
      /* Une saisie, et rien de sur en face : on la garde. */
      t.bpmSource = t.bpmSrc;
    }

    /* ---------------- la tonalite ----------------
       « Il ne donne jamais et n'affiche jamais la cle des musiques
         alors que c'est un point hyper important. »

       Le seuil de 0,72 de correlation ne servait pas a AFFICHER
       une tonalite : il servait a en CONTREDIRE une. On l'avait
       mis aux deux endroits. Resultat : chez un DJ dont la seule
       source est iTunes — qui n'a aucun champ tonalite — la
       roue de Camelot etait vide de bout en bout, et l'axe
       harmonique du moteur ne notait rien du tout.

       Les deux questions sont maintenant separees :

         COMBLER un vide — des que la mesure rend une tonalite.
           Une estimation affichee « 8A ? » vaut infiniment mieux
           qu'un « ? » : le DJ peut la verifier a l'oreille, et le
           moteur peut s'en servir.

         CONTREDIRE une source — seulement sur une mesure sure ET
           detachee de sa suivante, et seulement contre une source
           faible. Le seuil severe reste la, a sa vraie place.
       ---------------- */
    if (!rangKey) {
      if (patch.mKey) {
        t.key = patch.mKey;
        t.keyDeduite = true;
        t.keySource = surTonalite ? 'liaison' : 'liaison-incertain';
      }
    } else if (rangKey >= FORT) {
      t.keySource = t.keySrc;
      if (surTonalite && desaccordTonalite(t.key, patch.mKey)) {
        t.keyDoute = true;
        t.keyMesuree = patch.mKey;
      }
    } else if (surTonalite) {
      const avant = t.key;
      t.key = patch.mKey;
      t.keySource = 'liaison';
      if (desaccordTonalite(avant, t.key)) { t.keyTag = avant; t.keyCorrigee = true; }
    } else {
      t.keySource = t.keySrc;
    }

  }

  _resultat(w, msg) {
    const id = msg.id;
    w.job = null;
    this.encours.delete(id);
    const t = this.tracks.get(id);
    const e = this.file.get(id);

    if (t && msg.ok) {
      const patch = msg.patch;
      Object.assign(t, patch);
      this.reussis++;
      if (patch && patch.mBpm > 40) this.mesuresUtiles++;

      this._arbitrer(t, patch);

      t.analyzed = true;
      t.offline = false;
      if (e && e.stamp) this.cache.set(t.path, e.stamp, patch);
      this.onTrack(t);
    } else if (t) {
      /* ------------------------------------------------------------
         UN ECHEC N'EST PAS TOUJOURS DEFINITIF.

         Un morceau etait declare illisible A LA PREMIERE TENTATIVE,
         pour toujours. Or la premiere tentative est justement celle
         qui tombe au pire moment : le disque externe qui se reveille,
         le fichier encore en cours de copie depuis une cle USB,
         ffmpeg qui n'a pas pu se lancer parce que trois autres
         tournaient deja. Le morceau perdait alors sa tonalite, son
         tempo mesure et son energie pour le reste de la soiree — et
         il restait marque illisible dans l'ecran de sante, ce qui
         envoyait le DJ chercher un probleme qui n'existait pas.

         On lui donne une seconde chance, une seule, apres le meme
         delai que pour un disque absent. Ce qui echoue deux fois
         echoue vraiment.
         ------------------------------------------------------------ */
      const n = (this.reessais.get(id) || 0) + 1;
      if (n === 1 && e) {
        this.reessais.set(id, n);
        this.absents.set(id, Date.now() + RELANCE_MS);
        this.encours.delete(id);
        this.libres.push(w);
        this._pousser();
        return;                       /* on ne le compte pas encore comme rate */
      }
      if (t.energy == null) t.energy = 5;
      if (!t.timbre) t.timbre = [5, 5, 5];
      if (t.vocal == null) t.vocal = 0;
      t.analyzed = true;
      t.illisible = true;
      this.rates++;
      if (msg && msg.error) this.derniereErreur = String(msg.error).slice(0, 200);
    }

    this.file.delete(id);
    this.faits++;
    this.libres.push(w);
    this._rapport();
    this._pousser();
  }

  /* On ne previent l'interface qu'une fois par seconde : a trois
     resultats par seconde, un message par morceau ne sert qu'a
     faire clignoter un chiffre.

     Les morceaux injoignables sont comptes a part, jamais dans les
     restants. Sans ca, un DJ qui debranche son SSD garde une barre
     de progression bloquee a 99 % pour le reste de la soiree —
     l'app aurait l'air en panne alors qu'elle a simplement fini
     tout ce qu'elle pouvait faire. */
  _rapport(force) {
    const now = Date.now();
    if (!force && now - this.dernierRapport < 1000) {
      /* Anti-rebond a bord de fuite. Sans ce rappel, le tout
         dernier resultat — celui qui fait passer les restants a
         zero — tombe dans la fenetre d'attente et n'est jamais
         envoye : la barre de progression reste affichee alors que
         l'analyse est finie depuis longtemps. */
      if (!this.rapportTimer) {
        this.rapportTimer = setTimeout(() => {
          this.rapportTimer = null;
          if (!this.arrete) this._rapport(true);
        }, 1000);
        if (this.rapportTimer.unref) this.rapportTimer.unref();
      }
      return;
    }
    if (this.rapportTimer) { clearTimeout(this.rapportTimer); this.rapportTimer = null; }
    this.dernierRapport = now;

    /* ------------------------------------------------------------
       UN COMPTEUR QUI NE REPART PAS DE ZERO.

       « Des que je change de son, ANALYSE / 40 000 recommence. »

       Il comptait « ce qu'on a fait DEPUIS LE DERNIER CHARGEMENT »
       sur « ce qu'il restait a faire a ce moment-la ». Or charger()
       remet le compteur a zero et reconstruit la file : la moindre
       resynchronisation de bibliotheque — et il y en a a chaque
       changement de crate — ramenait la barre a son point de
       depart, sur un travail deja fait aux trois quarts. Le DJ
       voyait une analyse sans fin qui recommencait sans cesse.

       On compte donc ce que le DJ comprend, et qui ne peut pas
       reculer : combien de SA bibliotheque est prete, sur le total.
       Les fichiers injoignables sortent des deux cotes — ils ne
       seront jamais prets et ne doivent pas plomber la barre.
       ------------------------------------------------------------ */
    let horsLigne = 0;
    for (const id of this.file.keys()) {
      const t = this.tracks.get(id);
      if (t && t.offline) horsLigne++;
    }
    const restants = Math.max(0, this.file.size - horsLigne);
    let prets = 0, total = 0;
    for (const t of this.tracks.values()) {
      if (t.offline) continue;
      total++;
      if (t.analyzed) prets++;
    }

    this.onProgress({
      phase: 'analyse',
      done: prets,
      total: total,
      restants: restants,
      offline: horsLigne,
      fils: this.workers.length,
      /* fini veut dire : plus rien a faire avec ce qui est branche */
      fini: restants === 0
    });
  }

  /* ------------------------------------------------------------
     L'etat de sante de l'analyse elle-meme.

     @returns {object|null} un probleme a montrer, ou null si tout
     va bien. On ne crie qu'au-dela de vingt tentatives : en
     dessous, un fichier abime isole ne prouve rien.
     ------------------------------------------------------------ */
  panne() {
    if (this.sansFils)
      return { cle: 'analyse-sans-fils',
        quoi: 'Liaison ne peut pas lancer ses fils d\'analyse',
        pourquoi: 'Aucun tempo, aucune tonalite et aucune energie ne seront mesures.',
        quoiFaire: ['Redemarre Liaison', 'Si ca persiste, reinstalle l\'application'] };

    const tentes = this.rates + this.reussis;
    if (tentes < 20) return null;

    if (this.rates >= tentes * 0.8)
      return { cle: 'analyse-echoue',
        quoi: 'L\'analyse echoue sur presque tous tes morceaux',
        pourquoi: this.derniereErreur
          ? 'Derniere erreur : ' + this.derniereErreur
          : 'Liaison n\'arrive pas a decoder tes fichiers audio.',
        quoiFaire: ['Lance « node build/diagnostic.js » pour savoir pourquoi',
                    'C\'est presque toujours ffmpeg qui manque ou n\'est pas executable'],
        rates: this.rates, tentes: tentes };

    /* Le cas plus vicieux : ca « reussit », mais rien n'en sort. */
    if (this.reussis >= 20 && this.mesuresUtiles < this.reussis * 0.1)
      return { cle: 'analyse-sans-resultat',
        quoi: 'L\'analyse tourne mais ne trouve aucun tempo',
        pourquoi: this.reussis + ' morceaux analyses, ' + this.mesuresUtiles + ' tempos trouves.',
        quoiFaire: ['Lance « node build/diagnostic.js » et envoie la sortie'],
        rates: this.rates, tentes: tentes };
    return null;
  }

  /** Ce morceau est-il dans la file, en attente de mesure ? */
  enAttente(id) {
    if (this.sansFils) return false;      /* aucun fil : ca n'arrivera pas */
    const e = this.file.get(id);
    if (!e) return false;
    const t = this.tracks.get(id);
    if (t && t.offline) return false;     /* fichier injoignable : jamais */
    return true;
  }

  /** Combien de morceaux sont injoignables — disque debranche. */
  compterAbsents() {
    let n = 0;
    for (const t of this.tracks.values()) if (t.offline) n++;
    return n;
  }

  stop() {
    this.arrete = true;
    if (this.rapportTimer) { clearTimeout(this.rapportTimer); this.rapportTimer = null; }
    this.cache.save();
    for (const w of this.workers) { try { w.terminate(); } catch (e) {} }
    this.workers = []; this.libres = [];
  }
}

module.exports = { desaccordTempo, desaccordTonalite, SUR_TEMPO, SUR_TONALITE, MARGE_TONALITE,
                   VERSION_MESURE, AnalysisService, AnalysisCache };
