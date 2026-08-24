'use strict';
/* ============================================================
   Session de soiree : demandes des invites (page mobile + QR
   partageable), journal du set, persistance.
   ============================================================ */
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const QR = require('qrcode');
const { match, keyOf } = require('./engine');

function lanIP() {
  const ifs = os.networkInterfaces();
  const pref = [];
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family !== 'IPv4' || i.internal) continue;
      if (/^169\.254\./.test(i.address)) continue;
      pref.push({ name: name, addr: i.address });
    }
  }
  const wifi = pref.find(p => /wi-?fi|wlan|en0/i.test(p.name));
  return (wifi || pref[0] || { addr: '127.0.0.1' }).addr;
}

/* ---------- page mobile des invites ---------- */
function guestPage(sessionName, token) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(sessionName)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Instrument+Sans:wght@400;500;600&family=DM+Mono:wght@400&display=swap">
<style>
*{box-sizing:border-box}
body{margin:0;background:#0D0F12;color:#E9EBEE;font:16px/1.5 "Instrument Sans",system-ui,sans-serif;padding:22px 18px 60px}
h1{font-family:Syne,sans-serif;font-size:26px;letter-spacing:-.03em;margin:0 0 4px}
p.s{color:#79828D;font-size:14px;margin:0 0 22px}
input{width:100%;padding:15px 16px;border-radius:6px;border:1px solid #262C35;background:#14171C;color:#E9EBEE;font-size:16px;font-family:inherit}
input:focus{outline:2px solid #6E7BFF;outline-offset:1px}
.r{display:flex;align-items:center;gap:12px;padding:13px 14px;border:1px solid #22272F;border-radius:6px;margin-top:8px;background:#111419}
.r b{font-weight:600;font-size:14.5px;display:block}
.r small{color:#79828D;font-size:12.5px}
.r .go{margin-left:auto;flex:none;font-family:"DM Mono",monospace;font-size:11px;letter-spacing:.1em;padding:9px 12px;border-radius:4px;border:1px solid #6E7BFF;background:#6E7BFF;color:#fff}
.ok{padding:14px;border:1px solid #6E7BFF;border-radius:6px;margin-top:14px;font-size:14px;color:#B9C0FF}
.lbl{font-family:"DM Mono",monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#525A64;margin:26px 0 10px;display:block}
</style></head><body>
<h1>${esc(sessionName)}</h1>
<p class="s">Demande un morceau au DJ. S'il colle au moment, il passe.</p>
<input id="q" placeholder="Titre ou artiste…" autocomplete="off">
<div id="res"></div>
<span class="lbl">Les plus demandes</span>
<div id="top"></div>
<script>
const TOKEN=${JSON.stringify(String(token || ''))};
const res=document.getElementById('res'),top_=document.getElementById('top');
let t;
document.getElementById('q').addEventListener('input',e=>{
  clearTimeout(t);const v=e.target.value.trim();
  if(v.length<2){res.innerHTML='';return}
  t=setTimeout(async()=>{
    const r=await fetch('/api/search?t='+encodeURIComponent(TOKEN)+'&q='+encodeURIComponent(v));const j=await r.json();
    res.innerHTML=j.map(x=>'<div class="r"><span><b>'+esc(x.title)+'</b><small>'+esc(x.artist)+(x.have?'':' · le DJ ne l\\'a pas encore')+'</small></span><button class="go" data-t="'+esc(x.title)+'" data-a="'+esc(x.artist)+'">Demander</button></div>').join('');
  },220);
});
res.addEventListener('click',async e=>{
  const b=e.target.closest('.go');if(!b)return;
  await fetch('/api/request?t='+encodeURIComponent(TOKEN),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:b.dataset.t,artist:b.dataset.a})});
  res.innerHTML='<div class="ok">Demande envoyee au DJ. Merci !</div>';
  document.getElementById('q').value='';load();
});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function load(){
  const r=await fetch('/api/top?t='+encodeURIComponent(TOKEN));const j=await r.json();
  top_.innerHTML=j.length?j.map(x=>'<div class="r"><span><b>'+esc(x.title)+'</b><small>'+esc(x.artist)+'</small></span><span class="go" style="background:transparent;color:#79828D;border-color:#262C35">x'+x.n+'</span></div>').join(''):'<p class="s">Rien pour l\\'instant.</p>';
}
load();setInterval(load,8000);
</script></body></html>`;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------- serveur des demandes ---------- */
class GuestServer {
  constructor() { this.requests = new Map(); this.server = null; this.port = 0; this.token = ''; }

  start(opts) {
    const self = this;
    this.getLibrary = opts.getLibrary || (() => []);
    this.sessionName = opts.sessionName || 'Soiree';
    this.token = opts.token || crypto.randomBytes(9).toString('base64url');
    const port = opts.port || 7373;

    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      const deny = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Lien invalide'); };

      /* Le jeton du QR est la seule cle d'entree : sans lui, rien ne repond.
         Sinon n'importe qui sur le wifi du lieu lirait la bibliotheque et
         pourrait bourrer les demandes. Comparaison a duree constante. */
      const given = u.pathname.indexOf('/s/') === 0 ? u.pathname.slice(3) : (u.searchParams.get('t') || '');
      if (!self.tokenOk(given)) return deny();

      if (u.pathname === '/api/search') {
        const q = (u.searchParams.get('q') || '').toLowerCase();
        const lib = self.getLibrary();
        const hits = lib.filter(t => (t.title + ' ' + t.artist).toLowerCase().includes(q)).slice(0, 8)
          .map(t => ({ title: t.title, artist: t.artist, have: true }));
        if (hits.length < 3) hits.push({ title: u.searchParams.get('q'), artist: 'Demande libre', have: false });
        return json(hits);
      }
      if (u.pathname === '/api/request' && req.method === 'POST') {
        let body = '';
        req.on('data', d => (body += d));
        req.on('end', () => {
          try {
            const b = JSON.parse(body || '{}');
            const k = keyOf(b);
            const cur = self.requests.get(k) || { title: b.title, artist: b.artist, n: 0, at: Date.now() };
            cur.n++; cur.at = Date.now();
            self.requests.set(k, cur);
            if (opts.onRequest) opts.onRequest(self.top());
          } catch (e) {}
          json({ ok: true });
        });
        return;
      }
      if (u.pathname === '/api/top') return json(self.top().slice(0, 8));

      if (u.pathname.indexOf('/s/') !== 0) return deny();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(guestPage(self.sessionName, self.token));
    });

    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(port, '0.0.0.0', () => { this.port = port; resolve(this.url()); });
    });
  }

  url() { return 'http://' + lanIP() + ':' + this.port + '/s/' + this.token; }
  /** Comparaison a duree constante : pas d'attaque par chronometrage. */
  tokenOk(given) {
    const a = Buffer.from(String(given || ''), 'utf8');
    const b = Buffer.from(String(this.token || ''), 'utf8');
    if (!b.length || a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
  top() { return Array.from(this.requests.values()).sort((a, b) => b.n - a.n || b.at - a.at); }
  clear() { this.requests.clear(); }
  stop() { if (this.server) try { this.server.close(); } catch (e) {} }
}

/* ---------- QR et partage ---------- */
async function qrPNG(url) { return QR.toDataURL(url, { margin: 1, width: 512, color: { dark: '#0E1013', light: '#FFFFFF' } }); }
async function qrSVG(url) { return QR.toString(url, { type: 'svg', margin: 1, color: { dark: '#0E1013', light: '#FFFFFF' } }); }

function shareLinks(url, sessionName) {
  const msg = 'Demande ton morceau pour ' + (sessionName || 'la soiree') + ' : ' + url;
  return {
    url: url,
    text: msg,
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(msg),
    telegram: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(msg),
    sms: 'sms:?&body=' + encodeURIComponent(msg),
    mail: 'mailto:?subject=' + encodeURIComponent(sessionName || 'Soiree') + '&body=' + encodeURIComponent(msg)
  };
}

/* ---------- journal de set ---------- */
class SetLog {
  constructor(file) { this.file = file; this.sets = this._load(); }
  _load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { return []; } }
  _save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.sets, null, 1)); } catch (e) {} }
  open(name, pack) { this.current = { id: Date.now(), name: name, pack: pack, at: new Date().toISOString(), played: [] }; this.sets.unshift(this.current); this._save(); return this.current; }
  play(track, transition) {
    if (!this.current) this.open('Session', null);
    const last = this.current.played[this.current.played.length - 1];
    if (last && last.id === track.id) return;
    this.current.played.push({ id: track.id, title: track.title, artist: track.artist,
      bpm: track.bpm, key: track.key, energy: track.energy, at: Date.now(), transition: transition || null });
    this._save();
  }
  list() { return this.sets.map(s => ({ id: s.id, name: s.name, pack: s.pack, at: s.at, n: s.played.length })); }
  get(id) { return this.sets.find(s => s.id === id); }
  /** Retrouve les objets complets d'un set enregistre dans la bibliotheque courante. */
  hydrate(id, library) {
    const s = this.get(id);
    if (!s) return [];
    return s.played.map(p => {
      const byId = library.find(t => t.id === p.id && t.title === p.title);
      if (byId) return byId;
      const m = match(p.artist + ' ' + p.title, library, 0.5);
      return m ? m.track : null;
    }).filter(Boolean);
  }
}

module.exports = { GuestServer, SetLog, qrPNG, qrSVG, shareLinks, lanIP };
