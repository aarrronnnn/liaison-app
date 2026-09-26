'use strict';
/* ============================================================
   LE RELAIS DES INVITES — liaisondj.app/d/<code>.

   Pourquoi il existe. La page servie par l'ordinateur du DJ ne
   s'ouvre que pour les telephones connectes au MEME Wi-Fi. Or dans
   un mariage ou un bar, les invites sont en 4G, et l'ordinateur du
   DJ n'est souvent meme pas sur le Wi-Fi du lieu. Et un QR imprime
   a l'avance porte une adresse locale qui change d'un lieu a l'autre.

   Le relais regle les deux : le QR pointe vers liaisondj.app, qui
   sert la meme page, garde la file des demandes, et publie l'etat de
   la soiree. L'application y passe toutes les quatre secondes :
   elle depose l'etat, elle releve les demandes.

   Ce qui ne change pas :
     — il ne sert QUE pendant une session invites ouverte par le DJ ;
     — sans internet, l'application retombe d'elle-meme sur la page
       locale, et le reste de Liaison ne voit aucune difference ;
     — rien ne part que l'index (titres et artistes, sans un seul
       chemin de fichier) et l'etat de la soiree ;
     — aucun appel ne bloque : tout est asynchrone, borne a six
       secondes, et une panne ne remonte jamais jusqu'au DJ.
   ============================================================ */
const https = require('https');
const http = require('http');

const CADENCE_MS = 4000;          /* depot de l'etat + releve des demandes */
const CADENCE_CALME_MS = 10000;   /* apres dix minutes sans une seule demande */

function requete(base, chemin, corps, secret, delaiMs) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(chemin, base); } catch (e) { return resolve({ code: 0, erreur: 'adresse' }); }
    const mod = u.protocol === 'http:' ? http : https;
    const data = corps ? Buffer.from(JSON.stringify(corps), 'utf8') : null;
    const req = mod.request({
      method: data ? 'POST' : 'GET', hostname: u.hostname, port: u.port || undefined,
      path: u.pathname + u.search,
      headers: Object.assign({ 'Accept': 'application/json', 'User-Agent': 'Liaison-relais' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {},
        secret ? { 'X-Liaison-Secret': secret } : {})
    }, res => {
      const bouts = [];
      res.on('data', c => bouts.push(c));
      res.on('end', () => {
        let j = null;
        try { j = JSON.parse(Buffer.concat(bouts).toString('utf8') || 'null'); } catch (e) {}
        resolve({ code: res.statusCode, corps: j });
      });
      res.on('error', () => resolve({ code: 0, erreur: 'lecture' }));
    });
    req.on('error', e => resolve({ code: 0, erreur: e && e.code || 'reseau' }));
    req.setTimeout(delaiMs || 6000, () => { req.destroy(new Error('delai')); });
    if (data) req.write(data);
    req.end();
  });
}

class Relais {
  /**
   * @param {object} o { base, code, secret, getEtat, getIndex, onDemandes, onEtat }
   */
  constructor(o) {
    this.o = o;
    this.base = o.base;
    this.code = o.code;
    this.secret = o.secret;
    this.actif = false;
    this.timer = null;
    this.indexEnvoye = null;
    this.derniereDemande = Date.now();
    this.statut = { ok: false, depuis: 0, erreur: null, dernier: 0 };
  }

  url() { return this.base.replace(/\/$/, '') + '/d/' + this.code; }
  _api(f) { return '/api/soiree?c=' + encodeURIComponent(this.code) + '&f=' + f; }

  _noter(ok, erreur) {
    const avant = this.statut.ok;
    this.statut = { ok: !!ok, erreur: ok ? null : (erreur || 'inconnu'),
                    dernier: Date.now(), depuis: ok === avant ? this.statut.depuis : Date.now() };
    if (ok !== avant && this.o.onEtat) { try { this.o.onEtat(this.statut); } catch (e) {} }
  }

  /** Reserve le code (la premiere fois) et verifie que le relais repond. */
  async reserver() {
    const r = await requete(this.base, this._api('reserver'), { secret: this.secret }, null, 6000);
    if (r.code === 200 && r.corps && r.corps.ok) return { ok: true };
    if (r.code === 409) return { ok: false, pris: true };
    return { ok: false, erreur: r.erreur || ('http ' + r.code) };
  }

  async _envoyerIndex() {
    let ix = null;
    try { ix = this.o.getIndex ? this.o.getIndex() : null; } catch (e) {}
    if (!ix || !ix.v || this.indexEnvoye === ix.v) return true;
    for (let i = 0; i < ix.parts.length; i++) {
      const r = await requete(this.base, this._api('index'),
        { v: ix.v, i: i, n: ix.parts.length, part: ix.parts[i] }, this.secret, 20000);
      if (!(r.code === 200 && r.corps && r.corps.ok)) return false;
    }
    this.indexEnvoye = ix.v;
    return true;
  }

  async _tour() {
    if (!this.actif) return;
    let etat = {};
    try { etat = this.o.getEtat ? this.o.getEtat() : {}; } catch (e) {}
    const okIndex = await this._envoyerIndex();
    const r = await requete(this.base, this._api('sync'), { etat: etat }, this.secret, 6000);
    if (r.code === 200 && r.corps && r.corps.ok) {
      this._noter(okIndex, okIndex ? null : 'index');
      const dem = Array.isArray(r.corps.demandes) ? r.corps.demandes : [];
      if (dem.length) {
        this.derniereDemande = Date.now();
        if (this.o.onDemandes) { try { this.o.onDemandes(dem); } catch (e) {} }
      }
    } else {
      this._noter(false, r.erreur || ('http ' + r.code));
    }
  }

  _planifier(ms) {
    clearTimeout(this.timer);
    if (!this.actif) return;
    this.timer = setTimeout(async () => {
      try { await this._tour(); } catch (e) { this._noter(false, 'tour'); }
      const calme = Date.now() - this.derniereDemande > 600000;
      /* En panne : on espace, sans jamais abandonner. */
      const pause = !this.statut.ok ? Math.min(30000, CADENCE_MS * 3) : calme ? CADENCE_CALME_MS : CADENCE_MS;
      this._planifier(pause);
    }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  demarrer() {
    this.actif = true;
    this.derniereDemande = Date.now();
    this._planifier(0);
  }

  /* Au plus vite : une demande, un morceau qui change, la soiree qui
     ferme — les telephones le voient au tour suivant, pas dix secondes
     plus tard. */
  bientot() { if (this.actif) this._planifier(300); }

  /* Fermer : un dernier depot « ferme », pour que les telephones le
     disent au lieu de rester en attente. */
  async arreter(etatFinal) {
    this.actif = false;
    clearTimeout(this.timer);
    if (etatFinal) {
      try { await requete(this.base, this._api('sync'), { etat: etatFinal }, this.secret, 5000); } catch (e) {}
    }
  }
}

module.exports = { Relais, requete, CADENCE_MS };
