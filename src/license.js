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

const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAIBlTS+zRHjloETukaZa3Ii07GpZbEJU+0Mp5GkYmCA4=
-----END PUBLIC KEY-----`;

const API = process.env.LIAISON_API || 'https://liaison-gamma-five.vercel.app';
const TRIAL_DAYS = 14;

/* Ce que chaque niveau ouvre. */
const TIERS = {
  none:      { suggestions: 1, sessions: false, replay: false, trends: false, seats: 0,
               label: 'Essai termine' },
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
function post(pathname, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(pathname, API); } catch (e) { return reject(e); }
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

/* ============================================================
   Etat de la licence
   ============================================================ */
class License {
  constructor(file) {
    this.file = file;
    this.state = this._load();
    this.device = deviceId();
  }
  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { return {}; }
  }
  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.state, null, 1));
    } catch (e) {}
  }

  /** Demarre l'essai au tout premier lancement. */
  ensureTrial() {
    if (!this.state.trialStart) { this.state.trialStart = Date.now(); this._save(); }
    return this.trialLeft();
  }
  trialLeft() {
    if (!this.state.trialStart) return TRIAL_DAYS;
    const used = (Date.now() - this.state.trialStart) / 86400000;
    return Math.max(0, Math.ceil(TRIAL_DAYS - used));
  }

  /** Niveau effectif, sans reseau. */
  tier() {
    const p = this.state.license ? verify(this.state.license) : null;
    if (p && Date.now() < p.exp) {
      if ((p.plan === 'pass' || p.plan === 'ami') && p.until && Date.now() > p.until) return 'none';
      return TIERS[p.plan] ? p.plan : 'resident';
    }
    if (this.trialLeft() > 0) return 'trial';
    return 'none';
  }
  features() { return TIERS[this.tier()] || TIERS.none; }

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
    const r = await post('/api/activate', { key: key, device: this.device, name: deviceName() });
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
      const r = await post('/api/validate', { key: this.state.key, device: this.device }, 6000);
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
    try { await post('/api/liberer', { key: this.state.key, device: this.device }); } catch (e) {}
    this.state = { trialStart: this.state.trialStart };
    this._save();
    return { ok: true };
  }
}

module.exports = { License, TIERS, deviceId, deviceName, verify, API, TRIAL_DAYS };
