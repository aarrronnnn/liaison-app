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

const SAUVE_MS = 5000;         /* on n'ecrit jamais plus souvent que ca */
const RELANCE_MS = 60000;      /* delai avant de reessayer un fichier absent */

/* ------------------------------------------------------------
   Le cache sur disque.

   Cle = chemin + taille + date de modification. Un morceau
   re-tague dans Serato est donc reanalyse, un morceau simplement
   deplace aussi — c'est le prix d'une cle qu'on peut calculer
   sans lire le fichier.
   ------------------------------------------------------------ */
class AnalysisCache {
  constructor(file) {
    this.file = file;
    this.data = this._load();
    this.sale = false;
    this.timer = null;
  }
  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')) || {}; }
    catch (e) { return {}; }
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
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
      this.sale = false;
    } catch (e) { /* on reessaiera au prochain lot */ }
  }
  get taille() { return Object.keys(this.data).length; }
}

/* ------------------------------------------------------------
   La file.
   ------------------------------------------------------------ */
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
    this.workers = [];
    this.libres = [];
    this.arrete = false;
    this.dernierRapport = 0;
    this.rapportTimer = null;
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
      setTimeout(() => { this.workers.length = 0; this.libres.length = 0; this._demarrerWorkers(); this._pousser(); }, 1500);
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
      if (c) { Object.assign(t, c); t.analyzed = true; caches++; continue; }
      this.file.set(t.id, { priorite: 0, stamp: st });
    }

    this.total = this.file.size;
    this._rapport(true);
    return { caches: caches, aFaire: this.total };
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
    while (this.libres.length) {
      const id = this._suivant();
      if (id == null) return;
      const t = this.tracks.get(id);
      const e = this.file.get(id);
      if (!t || !e) { this.file.delete(id); continue; }

      /* le disque est-il revenu ? */
      const st = AnalysisCache.stamp(t.path);
      if (st === null) {
        t.offline = true;
        this.absents.set(id, Date.now() + RELANCE_MS);
        continue;
      }
      if (t.offline) { t.offline = false; this.absents.delete(id); }
      e.stamp = st;

      /* une derniere chance au cache : le fichier a pu etre
         analyse par une autre session entre-temps */
      const c = this.cache.get(t.path, st);
      if (c) { Object.assign(t, c); t.analyzed = true; this.file.delete(id); this.faits++; this._rapport(); continue; }

      const w = this.libres.pop();
      w.job = id;
      this.encours.add(id);
      w.postMessage({ id: id, path: t.path, seconds: 90 });
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

      /* Ce que le logiciel de mix affirme prime toujours : sa
         tonalite a ete posee par le DJ ou par un analyseur dedie,
         et son BPM a servi a caler la grille. Notre mesure ne
         remplace donc rien — elle comble les trous, et elle
         signale les desaccords.

         Combler : un morceau sans tonalite est invisible pour la
         roue de Camelot, un morceau sans BPM est invisible tout
         court. Mieux vaut une estimation qu'un vide.

         Signaler : quand les deux valeurs existent et divergent,
         on ne tranche pas — on marque, et la jauge de sante le
         montre au DJ, qui ira reanalyser dans SON logiciel. */
      if (!t.key && patch.mKey && patch.mKeyConf >= 0.6) { t.key = patch.mKey; t.keyDeduite = true; }
      if (!(t.bpm > 0) && patch.mBpm > 40) { t.bpm = Math.round(patch.mBpm * 10) / 10; t.bpmDeduit = true; }
      t.analyzed = true;
      t.offline = false;
      if (e && e.stamp) this.cache.set(t.path, e.stamp, patch);
      this.onTrack(t);
    } else if (t) {
      /* un fichier illisible ne doit pas revenir toutes les
         minutes : on lui donne ses valeurs par defaut et on
         l'oublie */
      if (t.energy == null) t.energy = 5;
      if (!t.timbre) t.timbre = [5, 5, 5];
      if (t.vocal == null) t.vocal = 0;
      t.analyzed = true;
      t.illisible = true;
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

    let horsLigne = 0;
    for (const id of this.file.keys()) {
      const t = this.tracks.get(id);
      if (t && t.offline) horsLigne++;
    }
    const restants = Math.max(0, this.file.size - horsLigne);
    const total = Math.max(0, this.total - horsLigne);

    this.onProgress({
      phase: 'analyse',
      done: total - restants,
      total: total,
      restants: restants,
      offline: horsLigne,
      fils: this.workers.length,
      /* fini veut dire : plus rien a faire avec ce qui est branche */
      fini: restants === 0
    });
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

module.exports = { AnalysisService, AnalysisCache };
