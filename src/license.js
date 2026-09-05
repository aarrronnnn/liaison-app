'use strict';
/* ============================================================
   Liaison — licence cote application.
   Le serveur signe une licence en Ed25519 ; l'app la verifie
   avec la cle publique embarquee et la garde 30 jours.
   Une coupure reseau n'interrompt jamais un set.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const ecrire = require('./ecrire');

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAZDFMHUbLpG/oPPTkjqslX0sF6sp0DSwmYGxzNpOfGgM=
-----END PUBLIC KEY-----`;

/* ------------------------------------------------------------
   L'adresse du service de licence.

   Elle pointait encore sur l'ancien projet Vercel, qui a ete
   transforme en simple redirection : toutes les activations
   partaient donc vers une redirection, et POST ne suit pas les
   redirections. Personne n'aurait pu activer une cle achetee.

   La liste ci-dessous est essayee dans l'ordre : le jour ou le
   nom de domaine definitif est achete, on l'ajoute en tete et les
   applications deja installees continuent de fonctionner grace
   aux suivantes. */
const API_LISTE = (process.env.LIAISON_API ? [process.env.LIAISON_API] : []).concat([
  'https://liaisondj.app',
  'https://liaison-web-ochre.vercel.app'
]);
const API = API_LISTE[0];
const TRIAL_DAYS = 7;

/* ------------------------------------------------------------
   Ce que chaque palier ouvre.

   Il n'y a plus de formule gratuite. La porte d'entree est le pass
   soiree a 4,95 € : le DJ qui joue trois fois par an paie trois
   fois, celui qui joue toutes les semaines s'abonne des le
   troisieme pass — et il le calcule tout seul.

   Apres l'essai, l'application ne disparait pas : elle se VERROUILLE.
   Le widget reste en place, il montre le morceau en cours, et il dit
   ce qu'il faut faire pour qu'il reparle. Une app qu'on ne peut plus
   ouvrir du tout se desinstalle le soir meme, et avec elle la
   deuxieme chance.

   L'essai dure SEPT jours. C'est court, exprès. Et c'est pour ca que
   la prolongation existe : sept jours de calendrier, pour un DJ de
   mariage, font presque toujours zero soiree jouee.
   ------------------------------------------------------------ */
const TIERS = {
  expire:    { suggestions: 0, sessions: false, replay: false, trends: false, seats: 1,
               label: 'Essai termine', verrouille: true },
  trial:     { suggestions: 5, sessions: true,  replay: true,  trends: true,  seats: 1,
               label: 'Essai' },
  pass:      { suggestions: 5, sessions: true,  replay: false, trends: true,  seats: 1,
               label: 'Pass soiree' },
  resident:  { suggestions: 5, sessions: true,  replay: true,  trends: true,  seats: 2,
               label: 'Resident' },
  collectif: { suggestions: 7, sessions: true,  replay: true,  trends: true,  seats: 5,
               label: 'Collectif' },
  ami:       { suggestions: 7, sessions: true,  replay: true,  trends: true,  seats: 20,
               label: 'Ami' }
};

/* ---------- identifiant de machine ---------- */
function deviceId() {
  const ifs = os.networkInterfaces();
  let mac = '';
  for (const n of Object.keys(ifs)) {
    for (const i of ifs[n] || []) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') { mac = i.mac; break; }
    }
    if (mac) break;
  }
  const seed = [os.hostname(), os.platform(), os.arch(), mac, (os.userInfo().username || '')].join('|');
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
}
function deviceName() {
  return (os.hostname() || 'Machine').replace(/\.local$/, '').slice(0, 40);
}

/* ---------- verification de la licence signee ---------- */
function verify(token) {
  try {
    const [b, s] = String(token).split('.');
    if (!b || !s) return null;
    const body = Buffer.from(b, 'base64url');
    const ok = crypto.verify(null, body, crypto.createPublicKey(PUBLIC_KEY), Buffer.from(s, 'base64url'));
    if (!ok) return null;
    const payload = JSON.parse(body.toString('utf8'));
    if (payload.device !== deviceId()) return null;      // licence d'une autre machine
    return payload;
  } catch (e) { return null; }
}

/* ---------- appel reseau ---------- */
function post(pathname, body, timeoutMs, base) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(pathname, base || API); } catch (e) { return reject(e); }
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    const mod = url.protocol === 'http:' ? http : https;
    const req = mod.request({
      hostname: url.hostname, port: url.port || undefined, path: url.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j = {};
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
        resolve({ code: res.statusCode, body: j });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 8000, () => { req.destroy(new Error('Delai depasse')); });
    req.end(data);
  });
}

/* ------------------------------------------------------------
   Les tarifs, demandes au serveur.

   Ils etaient ecrits en dur dans la fenetre de licence. Le jour ou
   un prix change, l'app installee continue d'annoncer l'ancien et
   le DJ decouvre le vrai montant sur la page de paiement. C'est la
   pire seconde possible dans un tunnel d'achat.

   On demande donc le tarif du jour, et on garde une valeur de repli
   pour le cas ou le reseau ne repond pas — il vaut mieux un prix
   approchant qu'une fenetre vide. */
const TARIFS_REPLI = {
  lancement: false,
  plans: {
    pass:         { euro: '4,95' },
    resident:     { euro: '14,95' },
    resident_an:  { euro: '149', parMois: '12,42' },
    collectif:    { euro: '44,95' },
    collectif_an: { euro: '449' }
  }
};

function get(pathname, timeoutMs, base) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(pathname, base || API); } catch (e) { return reject(e); }
    const mod = url.protocol === 'http:' ? http : https;
    const req = mod.request({
      hostname: url.hostname, port: url.port || undefined, path: url.pathname, method: 'GET'
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) {}
        resolve({ code: res.statusCode, body: j });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 6000, () => { req.destroy(new Error('Delai depasse')); });
    req.end();
  });
}

async function tarifs() {
  for (const base of API_LISTE) {
    try {
      const r = await get('/api/tarifs', 6000, base);
      if (r.code === 200 && r.body && r.body.plans) return r.body;
    } catch (e) { /* on essaie l'adresse suivante */ }
  }
  return TARIFS_REPLI;
}

/** Essaie chaque adresse connue, dans l'ordre. */
async function postAilleurs(pathname, body, timeoutMs) {
  let derniere = null;
  for (const base of API_LISTE) {
    try {
      const r = await post(pathname, body, timeoutMs, base);
      /* une redirection n'est pas une reponse : on passe a la suivante */
      if (r.code >= 300 && r.code < 400) { derniere = r; continue; }
      return r;
    } catch (e) { derniere = { code: 0, body: { error: e.message } }; }
  }
  return derniere || { code: 0, body: { error: 'Service injoignable' } };
}

/* ============================================================
   Etat de la licence
   ============================================================ */
class License {
  constructor(file) {
    this.file = file;
    this.state = this._load();
    this.device = deviceId();
  }
  _load() { return ecrire.lireJSON(this.file, {}) || {}; }
  /* Ecriture atomique : perdre ce fichier, c'est forcer une
     reactivation alors que le siege est deja consomme cote serveur —
     donc un client qui a paye, bloque en cabine. */
  _save() { ecrire.ecrireJSON(this.file, this.state); }

  /* ============================================================
     L'essai, et les deux facons de le voler.

     1. EFFACER LE FICHIER. trialStart vivait uniquement dans
        license.json, dans un dossier que l'utilisateur peut
        ouvrir. Le supprimer redonnait quatorze jours, autant de
        fois qu'on veut.

     2. RECULER L'HORLOGE. Toutes les dates — fin d'essai, date
        d'expiration de la licence en cache — sont comparees a
        Date.now(). Reculer la pendule de l'ordinateur d'un an
        prolongeait l'essai d'autant et ressuscitait une licence
        expiree.

     Les deux corrections sont simples et n'empechent personne
     d'utiliser le produit normalement :

     — un second temoin est ecrit A COTE, sous un nom discret, et
       on retient TOUJOURS la date la plus ancienne des deux. Il
       faut donc trouver et effacer les deux fichiers, et il n'y
       a rien qui les relie ;

     — on garde la date la plus haute jamais vue. Si l'horloge
       recule, on continue de compter a partir de cette date. Une
       horloge qui avance est normale ; une horloge qui recule de
       plusieurs jours ne l'est pas.

     Aucune de ces deux mesures n'est infranchissable pour
     quelqu'un de determine — rien ne l'est cote client. Elles
     coutent trente secondes a ecrire et arretent l'immense
     majorite des abus, qui sont opportunistes.
     ============================================================ */
  _temoinFichier() {
    return path.join(path.dirname(this.file), '.liaison-init');
  }
  _lireTemoin() {
    try {
      const j = JSON.parse(Buffer.from(fs.readFileSync(this._temoinFichier(), 'utf8'), 'base64').toString('utf8'));
      return (j && typeof j.t === 'number') ? j : null;
    } catch (e) { return null; }
  }
  _ecrireTemoin(o) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this._temoinFichier(), Buffer.from(JSON.stringify(o), 'utf8').toString('base64'));
    } catch (e) {}
  }

  /** L'heure, corrigee des reculs d'horloge. */
  maintenant() {
    const n = Date.now();
    const vu = Math.max(this.state.vuMax || 0, (this._lireTemoin() || {}).v || 0);
    if (n > vu) {
      this.state.vuMax = n;
      const t = this._lireTemoin() || {};
      if (n - (t.v || 0) > 3600000) this._ecrireTemoin({ t: t.t || n, v: n });
      return n;
    }
    /* l'horloge a recule : on s'en tient a ce qu'on a deja vu */
    return vu;
  }

  /** Demarre l'essai au tout premier lancement. */
  ensureTrial() {
    const n = this.maintenant();
    const t = this._lireTemoin();
    /* la date la plus ancienne des deux temoins fait foi */
    const debuts = [this.state.trialStart, t && t.t].filter(x => typeof x === 'number' && x > 0);
    const debut = debuts.length ? Math.min.apply(null, debuts) : n;
    if (this.state.trialStart !== debut) { this.state.trialStart = debut; this._save(); }
    if (!t || t.t !== debut) this._ecrireTemoin({ t: debut, v: Math.max(n, (t && t.v) || 0) });
    return this.trialLeft();
  }
  trialLeft() {
    const t = this._lireTemoin();
    const debuts = [this.state.trialStart, t && t.t].filter(x => typeof x === 'number' && x > 0);
    if (!debuts.length) return TRIAL_DAYS;
    const debut = Math.min.apply(null, debuts);
    const used = (this.maintenant() - debut) / 86400000;
    /* La prolongation accordee a qui n'a pas encore joue de vraie
       soiree s'ajoute a la duree, pas a la date de depart : le temoin
       anti-recul reste valable tel quel. */
    const rab = this.state.prolongeJours > 0 ? Math.min(30, this.state.prolongeJours) : 0;
    return Math.max(0, Math.ceil(TRIAL_DAYS + rab - used));
  }

  /** Niveau effectif, sans reseau. */
  tier() {
    const p = this.state.license ? verify(this.state.license) : null;
    const n = this.maintenant();
    if (p && n < p.exp) {
      if ((p.plan === 'pass' || p.plan === 'ami') && p.until && n > p.until) return 'expire';
      return TIERS[p.plan] ? p.plan : 'resident';
    }
    if (this.trialLeft() > 0) return 'trial';
    /* L'essai est fini. L'app se verrouille, elle ne se ferme pas :
       le widget reste la et propose le pass. */
    return 'expire';
  }
  features() { return TIERS[this.tier()] || TIERS.expire; }

  status() {
    const t = this.tier();
    const p = this.state.license ? verify(this.state.license) : null;
    return {
      tier: t,
      label: TIERS[t].label,
      key: this.state.key || null,
      device: this.device,
      deviceName: deviceName(),
      trialLeft: this.trialLeft(),
      until: p && p.until ? p.until : null,
      cacheUntil: p && p.exp ? p.exp : null,
      subStatus: p ? p.status : null,
      lastCheck: this.state.lastCheck || null,
      features: this.features(),
      api: API
    };
  }

  /** Active cette machine avec une cle achetee. */
  async activate(key) {
    const r = await postAilleurs('/api/activate', { key: key, device: this.device, name: deviceName() });
    if (r.code !== 200 || !r.body.license) {
      return { ok: false, error: r.body.error || ('Erreur ' + r.code), devices: r.body.devices };
    }
    if (!verify(r.body.license)) return { ok: false, error: 'Licence non verifiable — cle publique incorrecte' };
    this.state.key = String(key).trim().toUpperCase();
    this.state.license = r.body.license;
    this.state.lastCheck = Date.now();
    this._save();
    return { ok: true, status: this.status() };
  }

  /** Verification discrete, au plus une fois par jour. */
  async refresh(force) {
    if (!this.state.key) return { ok: false, error: 'Aucune cle' };
    if (!force && this.state.lastCheck && Date.now() - this.state.lastCheck < 86400000)
      return { ok: true, skipped: true };
    try {
      const r = await postAilleurs('/api/validate', { key: this.state.key, device: this.device }, 6000);
      if (r.code === 200 && r.body.license && verify(r.body.license)) {
        this.state.license = r.body.license;
        this.state.lastCheck = Date.now();
        this._save();
        return { ok: true, status: this.status() };
      }
      if (r.code === 402 || r.code === 404 || r.code === 409) {
        /* le droit a disparu : on efface la licence, l'essai reprend s'il reste du temps */
        this.state.license = null;
        this.state.lastCheck = Date.now();
        this._save();
        return { ok: false, error: r.body.error || 'Licence inactive' };
      }
      return { ok: false, error: r.body.error || ('Erreur ' + r.code) };
    } catch (e) {
      /* hors ligne : on garde la licence en cache, c'est exactement le but */
      return { ok: true, offline: true, error: e.message };
    }
  }

  /** Libere le siege de cette machine. */
  async release() {
    if (!this.state.key) return { ok: false, error: 'Aucune cle' };
    try { await postAilleurs('/api/liberer', { key: this.state.key, device: this.device }); } catch (e) {}
    this.state = { trialStart: this.state.trialStart };
    this._save();
    return { ok: true };
  }
}

module.exports = { License, TIERS, deviceId, deviceName, verify, tarifs, TARIFS_REPLI,
                   API, API_LISTE, TRIAL_DAYS };
