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
const ecrire = require('./ecrire');
const QR = require('qrcode');
const { match, search, keyOf } = require('./engine');

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

/* ---------- page mobile des invites ----------
   Servie depuis le portable du DJ, sur le reseau du lieu. Aucune police
   ni feuille de style distante : le telephone d'un invite n'a pas
   toujours de reseau au fond d'une salle. Tout tient dans la page. */
function guestPage(sessionName, token, opts) {
  opts = opts || {};
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#101114">
<title>${esc(sessionName)}</title>
<style>
*{box-sizing:border-box}
:root{--deep:#101114;--deep2:#17181C;--wire:#26282E;--wire2:#33363E;
--cream:#EFEAE0;--cream2:#9A9DA4;--cream3:#63666D;--blue:#4459FF;--red:#FF5A42;
--b:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,system-ui,sans-serif;
--m:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
body{margin:0;background:var(--deep);color:var(--cream);font-family:var(--b);
font-size:16px;line-height:1.5;padding:24px 18px 70px;-webkit-font-smoothing:antialiased}
.mk{display:flex;align-items:center;gap:9px;margin-bottom:22px}
.mk svg{width:19px;height:19px}
.mk span{font-family:var(--m);font-size:10px;letter-spacing:.3em;color:var(--cream3)}
h1{font-size:27px;letter-spacing:-.02em;margin:0 0 6px;font-weight:800}
p.s{color:var(--cream2);font-size:14.5px;margin:0 0 22px}
input{width:100%;padding:16px;border-radius:4px;border:1.5px solid var(--wire2);
background:var(--deep2);color:var(--cream);font-size:16px;font-family:inherit}
input:focus{outline:none;border-color:var(--blue)}
.r{display:flex;align-items:center;gap:12px;padding:13px 14px;border:1px solid var(--wire);
border-radius:4px;margin-top:8px;background:var(--deep2)}
.r b{font-weight:600;font-size:14.5px;display:block}
.r small{color:var(--cream3);font-size:12.5px}
.r .go{margin-left:auto;flex:none;font-family:var(--m);font-size:11px;letter-spacing:.1em;
padding:10px 13px;border-radius:3px;border:1.5px solid var(--blue);background:var(--blue);color:#fff;
cursor:pointer;-webkit-appearance:none}
.r .go:disabled{opacity:.4}
.n{margin-left:auto;font-family:var(--m);font-size:12px;color:var(--cream3);flex:none}
.n.hot{color:var(--red);font-weight:700}
.msg{padding:14px;border:1.5px solid var(--blue);border-radius:4px;margin-top:14px;font-size:14px;color:#C3CBFF}
.msg.warn{border-color:var(--red);color:#FFC0B4}
.lbl{font-family:var(--m);font-size:10px;letter-spacing:.2em;text-transform:uppercase;
color:var(--cream3);margin:28px 0 10px;display:block}
.foot{margin-top:30px;font-family:var(--m);font-size:10.5px;color:var(--cream3);line-height:1.8}
</style></head><body>
<div class="mk"><svg viewBox="0 0 24 24" fill="none">
<path d="M3.4 3.4 10 12l-6.6 8.6" stroke="#4459FF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M20.6 3.4 14 12l6.6 8.6" stroke="#FF5A42" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="12" cy="12" r="2.4" fill="#EFEAE0"/></svg><span>LIAISON</span></div>
<h1>${esc(sessionName)}</h1>
<p class="s">Demande un morceau au DJ. S'il colle au moment, il le passe.</p>
<input id="q" placeholder="Titre, ou artiste et titre…" autocomplete="off" enterkeyhint="search">
<div id="res"></div>
<div id="msg"></div>
<span class="lbl">Les plus demandes</span>
<div id="top"></div>
<p class="foot">Une demande a la fois, puis ${(opts.cooldown || 90)} secondes d'attente.<br>
${(opts.maxPerDevice || 5)} demandes par personne pour toute la soiree.</p>
<script>
const TOKEN=${JSON.stringify(String(token || ''))};
const res=document.getElementById('res'),top_=document.getElementById('top'),msg=document.getElementById('msg');
let t,cool=0,timer=null;
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function say(txt,warn){msg.innerHTML='<div class="msg'+(warn?' warn':'')+'">'+esc(txt)+'</div>'}
function tick(){
  if(cool<=0){msg.innerHTML='';clearInterval(timer);timer=null;return}
  say('Encore '+cool+' seconde'+(cool>1?'s':'')+' avant ta prochaine demande.');
  cool--;
}
function startCool(sec){cool=sec;if(timer)clearInterval(timer);tick();timer=setInterval(tick,1000)}
document.getElementById('q').addEventListener('input',e=>{
  clearTimeout(t);const v=e.target.value.trim();
  if(v.length<2){res.innerHTML='';return}
  t=setTimeout(async()=>{
    const r=await fetch('/api/search?t='+encodeURIComponent(TOKEN)+'&q='+encodeURIComponent(v));
    const j=await r.json();
    res.innerHTML=j.map(x=>'<div class="r"><span><b>'+esc(x.title)+'</b><small>'+esc(x.artist)+
      (x.have?'':' · le DJ ne l\'a pas, il peut quand meme noter')+'</small></span>'+
      '<button class="go" data-t="'+esc(x.title)+'" data-a="'+esc(x.artist)+'">Demander</button></div>').join('');
  },220);
});
res.addEventListener('click',async e=>{
  const b=e.target.closest('.go');if(!b)return;
  b.disabled=true;
  const r=await fetch('/api/request?t='+encodeURIComponent(TOKEN),{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({title:b.dataset.t,artist:b.dataset.a})});
  const j=await r.json().catch(()=>({}));
  res.innerHTML='';document.getElementById('q').value='';
  if(j.ok){ say('C\'est note. Le DJ voit ta demande.'); if(j.cooldown) startCool(j.cooldown); }
  else if(j.reste!=null){ startCool(j.reste); }
  else say(j.error||'Impossible pour le moment.',true);
  load();
});
async function load(){
  const r=await fetch('/api/top?t='+encodeURIComponent(TOKEN));const j=await r.json();
  top_.innerHTML=j.length?j.map(x=>'<div class="r"><span><b>'+esc(x.title)+'</b><small>'+esc(x.artist)+
    '</small></span><span class="n'+(x.n>=3?' hot':'')+'">'+x.n+' demande'+(x.n>1?'s':'')+'</span></div>').join('')
    :'<p class="s">Personne n\'a encore demande. Lance-toi.</p>';
}
load();setInterval(load,8000);
</script></body></html>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ---------- serveur des demandes ---------- */
class GuestServer {
  constructor() {
    this.requests = new Map();
    this.devices = new Map();          /* identifiant de telephone -> historique */
    this.server = null; this.port = 0; this.token = '';
    this.cooldown = 90;                /* secondes entre deux demandes */
    this.maxPerDevice = 5;             /* pour toute la soiree */
  }

  start(opts) {
    const self = this;
    this.getLibrary = opts.getLibrary || (() => []);
    this.sessionName = opts.sessionName || 'Soiree';
    this.token = opts.token || crypto.randomBytes(9).toString('base64url');
    if (opts.cooldown != null) this.cooldown = Math.max(0, opts.cooldown);
    if (opts.maxPerDevice != null) this.maxPerDevice = Math.max(1, opts.maxPerDevice);
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

      /* Identite du telephone : un cookie anonyme pose a la premiere
         visite. Il ne sert qu'a compter — une demande par personne,
         et un delai avant la suivante. Rien n'en sort de la machine. */
      let dev = (req.headers.cookie || '').match(/(?:^|;\s*)lsn=([A-Za-z0-9_-]{10,32})/);
      dev = dev ? dev[1] : null;
      const fresh = !dev;
      /* Sans cookie, on derive une identite de l'adresse reseau plutot
         que d'en tirer une neuve : sinon il suffit de ne pas renvoyer le
         cookie pour repartir a zero a chaque requete — donc plus de
         plafond de cinq demandes, plus de delai de 90 secondes, et un
         compteur qui affiche « 300 demandes » pour un seul telephone.
         Sur le wifi d'un club, plusieurs invites peuvent partager une
         adresse : c'est pour ca que le cookie reste prioritaire, et que
         cette voie n'est qu'un filet. */
      if (!dev) dev = 'a' + crypto.createHmac('sha256', self.token)
        .update(self._adresse(req)).digest('base64url').slice(0, 20);
      const setCookie = () => 'lsn=' + dev + '; Path=/; Max-Age=86400; SameSite=Lax';

      if (u.pathname === '/api/search') {
        /* Un invite tape sur un telephone : fautes, pas d'accents, mots
           dans le desordre. La recherche exacte ne trouverait rien.

           MAIS : ce serveur tourne dans le processus principal de
           l'application. Une recherche longue ne ralentit pas « la page
           invite », elle GELE le widget, la detection du deck et tout le
           reste. Sur 30 000 titres, une requete de 8 000 caracteres sans
           correspondance bloquait 22 secondes d'affilee — et il suffisait
           de la repeter pour tuer la soiree.

           Donc : la requete est coupee a 64 caracteres, et une meme
           adresse ne peut pas relancer une recherche plus de trois fois
           par seconde. Aucun invite de bonne foi ne s'en apercoit. */
        const q = String(u.searchParams.get('q') || '').slice(0, 64);
        if (!self._peutChercher(req)) { res.writeHead(429); return res.end('[]'); }
        const hits = search(q, self.getLibrary(), 6, 0.34)
          .map(h => ({ title: h.track.title, artist: h.track.artist, have: true }));
        /* On laisse toujours la porte ouverte : si le DJ ne l'a pas,
           la demande compte quand meme — elle ira dans sa liste de courses. */
        hits.push({ title: q.trim(), artist: 'Ma demande, telle que je l\'ecris', have: false });
        return json(hits);
      }
      if (u.pathname === '/api/request' && req.method === 'POST') {
        let body = '';
        req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
        req.on('end', () => {
          let out;
          try { out = self.accept(JSON.parse(body || '{}'), dev); }
          catch (e) { out = { ok: false, error: 'Demande illisible' }; }
          if (out.ok && opts.onRequest) opts.onRequest(self.top());
          res.writeHead(out.ok ? 200 : 429, {
            'Content-Type': 'application/json', 'Set-Cookie': setCookie()
          });
          res.end(JSON.stringify(out));
        });
        return;
      }
      if (u.pathname === '/api/top') return json(self.top().slice(0, 8));

      if (u.pathname.indexOf('/s/') !== 0) return deny();
      const head = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' };
      if (fresh) head['Set-Cookie'] = setCookie();
      res.writeHead(200, head);
      res.end(guestPage(self.sessionName, self.token,
        { cooldown: self.cooldown, maxPerDevice: self.maxPerDevice }));
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
  /* L'adresse de l'appelant, derriere un eventuel relais. */
  _adresse(req) {
    const x = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return x || (req.socket && req.socket.remoteAddress) || 'inconnu';
  }

  /* Trois recherches par seconde et par adresse. Une frappe au clavier
     en declenche une toutes les 220 ms : la marge est large. */
  _peutChercher(req) {
    const ip = this._adresse(req);
    const n = Date.now();
    if (!this._cherches) this._cherches = new Map();
    if (this._cherches.size > 500) this._cherches.clear();
    const e = this._cherches.get(ip);
    if (!e || n - e.t > 1000) { this._cherches.set(ip, { t: n, c: 1 }); return true; }
    e.c++;
    return e.c <= 3;
  }

  /* ============================================================
     Les regles de la file.

     Le compte affiche est un nombre de *telephones distincts*, pas de
     clics : c'est la seule mesure qui veut dire « la salle la reclame ».
     Un invite ne peut pas voter deux fois pour le meme titre, ni
     enchainer les demandes, ni en deposer quinze dans la soiree.
     ============================================================ */
  accept(b, device) {
    const title = String(b && b.title || '').trim().slice(0, 120);
    const artist = String(b && b.artist || '').trim().slice(0, 120);
    if (title.length < 2) return { ok: false, error: 'Il manque le titre' };

    const now = Date.now();
    const d = this.devices.get(device) || { last: 0, n: 0, voted: new Set() };

    if (d.n >= this.maxPerDevice)
      return { ok: false, error: 'Tu as utilise tes ' + this.maxPerDevice + ' demandes. Laisse la place aux autres.' };

    /* Le doublon se verifie AVANT le delai. Dans l'autre ordre, on
       repond « attends 90 secondes » a quelqu'un dont la demande
       sera refusee de toute facon : il attend pour rien, puis
       apprend qu'il avait deja vote. Autant le lui dire tout de
       suite — et lui laisser son delai intact pour un autre titre. */
    const k = keyOf({ artist: artist, title: title });
    if (d.voted.has(k))
      return { ok: false, error: 'Tu as deja demande ce morceau — il est dans la liste.' };

    const since = (now - d.last) / 1000;
    if (d.last && since < this.cooldown)
      return { ok: false, reste: Math.ceil(this.cooldown - since),
               error: 'Encore un instant avant la prochaine.' };

    /* La file ne grossit pas indefiniment : sur une soiree de huit
       heures, chaque titre distinct demande y reste, et rien ne l'en
       sort. Deux cents lignes suffisent tres largement a « ce que la
       salle reclame » ; au-dela, on oublie les plus anciennes et les
       moins demandees. */
    if (this.requests.size >= 200 && !this.requests.has(k)) {
      const vieilles = Array.from(this.requests.entries())
        .sort((a, b) => (a[1].n - b[1].n) || (a[1].at - b[1].at))
        .slice(0, 20);
      for (const [cle] of vieilles) this.requests.delete(cle);
    }
    const cur = this.requests.get(k) || { title: title, artist: artist, n: 0, at: now, first: now };
    cur.n++; cur.at = now;
    this.requests.set(k, cur);

    d.last = now; d.n++; d.voted.add(k);
    this.devices.set(device, d);
    return { ok: true, n: cur.n, cooldown: this.cooldown, restantes: this.maxPerDevice - d.n };
  }

  top() { return Array.from(this.requests.values()).sort((a, b) => b.n - a.n || b.at - a.at); }
  clear() { this.requests.clear(); this.devices.clear(); }
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
  _load() { return ecrire.lireJSON(this.file, []); }
  /* Ecriture atomique : ce fichier est reecrit a chaque morceau joue.
     Une coupure au mauvais moment effacait toute la nuit. */
  _save() { ecrire.ecrireJSON(this.file, this.sets); }
  open(name, pack) { this.current = { id: Date.now(), name: name, pack: pack, at: new Date().toISOString(), played: [] }; this.sets.unshift(this.current); this._save(); return this.current; }
  play(track, transition) {
    if (!this.current) this.open('Session', null);
    const last = this.current.played[this.current.played.length - 1];
    if (last && last.id === track.id) return;
    /* Les genres sont conserves. Sans eux, la penalite de saturation du
       moteur — celle qui empeche sept tech house d'affilee — recevait
       des morceaux sans tags et rendait donc TOUJOURS zero. Le defaut
       « 47 % du set dans un seul genre » que cette penalite existe pour
       corriger etait donc intact, en silence. */
    this.current.played.push({ id: track.id, title: track.title, artist: track.artist,
      bpm: track.bpm, key: track.key, energy: track.energy,
      tags: Array.isArray(track.tags) ? track.tags.slice(0, 6) : [],
      at: Date.now(), transition: transition || null });
    this._save();
  }
  list() { return this.sets.map(s => ({ id: s.id, name: s.name, pack: s.pack, at: s.at, n: s.played.length,
    duree: s.played.length > 1 ? Math.round((s.played[s.played.length - 1].at - s.played[0].at) / 60000) : 0 })); }
  get(id) { return this.sets.find(s => s.id === id); }

  /* ----------------------------------------------------------
     « Tu l'as deja passe »

     Le probleme du resident : il joue le meme bar toutes les
     semaines, devant a peu pres les memes gens, et il ne se
     souvient pas si ce titre etait la semaine derniere ou il y a
     deux mois. Le journal, lui, s'en souvient.

     On repond deux choses distinctes, parce qu'elles n'ont pas
     le meme poids : ce soir (une faute) et une autre fois (une
     information). Et on ne compare que les soirees du meme
     endroit quand on connait le nom de la session.
     ---------------------------------------------------------- */
  lastPlay(trackId, opt) {
    opt = opt || {};
    const memeLieu = opt.sameName ? String(opt.sameName).trim().toLowerCase() : null;
    const now = Date.now();
    let ceSoir = null, avant = null;

    for (const s of this.sets) {
      const courant = this.current && s.id === this.current.id;
      if (memeLieu && !courant && String(s.name || '').trim().toLowerCase() !== memeLieu) continue;
      for (let i = s.played.length - 1; i >= 0; i--) {
        const p = s.played[i];
        if (p.id !== trackId) continue;
        if (courant) { if (!ceSoir) ceSoir = { at: p.at, min: Math.round((now - p.at) / 60000) }; }
        else if (!avant) avant = { at: p.at, set: s.name || 'Session',
                                   jours: Math.max(1, Math.round((now - p.at) / 86400000)) };
        break;
      }
      if (ceSoir && avant) break;
    }

    if (!ceSoir && !avant) return null;
    return {
      ceSoir: ceSoir, avant: avant,
      /* le texte du badge : court, il tient dans une ligne du widget */
      texte: ceSoir
        ? (ceSoir.min < 1 ? 'A l’instant' : 'Joue il y a ' + ceSoir.min + ' min')
        : (avant.jours === 1 ? 'Joue hier — ' + avant.set
           : avant.jours < 30 ? 'Joue il y a ' + avant.jours + ' jours — ' + avant.set
           : 'Joue il y a ' + Math.round(avant.jours / 30) + ' mois — ' + avant.set),
      /* ce soir, c'est bloquant ; une autre soiree, c'est consultatif */
      grave: !!ceSoir
    };
  }

  /** Les identifiants deja passes ce soir — pour le filtre de cabine. */
  playedIds() {
    const out = new Set();
    if (this.current) for (const p of this.current.played) out.add(p.id);
    return out;
  }

  /** Les durees reellement laissees a chaque morceau, en secondes. */
  playedDurations() {
    if (!this.current) return [];
    const p = this.current.played, out = [];
    for (let i = 1; i < p.length; i++) {
      const d = (p[i].at - p[i - 1].at) / 1000;
      if (d > 45 && d < 900) out.push(d);        /* on jette les pauses et les faux departs */
    }
    return out;
  }

  /* ----------------------------------------------------------
     La tracklist.

     Deux formats, deux usages qui n'ont rien a voir :

     — le texte, c'est ce qu'on colle dans un message a 4 h du
       matin quand quelqu'un demande « tu peux m'envoyer ta
       tracklist ? ». Heure, artiste, titre. Rien d'autre.

     — le CSV, c'est le fichier des declarations. La SACEM
       demande, par oeuvre : le titre, l'interprete, la duree
       d'utilisation, la date et le lieu. On ecrit ces colonnes,
       plus le BPM et la tonalite qui ne servent qu'au DJ.

     Attention : ce fichier est une aide a la declaration, pas
     une declaration. Aucun format d'import officiel n'est
     publie ; c'est un CSV lisible par un humain et par un
     tableur, et c'est tout ce qu'on peut honnetement promettre.
     ---------------------------------------------------------- */
  tracklist(id) {
    const s = this.get(id) || this.current;
    if (!s || !s.played.length) return null;
    const p = s.played;
    const debut = p[0].at;
    return {
      id: s.id, name: s.name || 'Session', pack: s.pack, at: s.at,
      lignes: p.map((x, i) => {
        const fin = i + 1 < p.length ? p[i + 1].at : null;
        const sec = fin ? Math.round((fin - x.at) / 1000) : null;
        const d = new Date(x.at);
        return {
          n: i + 1,
          heure: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
          depuis: Math.round((x.at - debut) / 1000),
          title: x.title || '', artist: x.artist || '',
          bpm: x.bpm || '', key: x.key || '',
          /* la duree du dernier morceau est inconnue : il tournait
             encore quand la session s'est fermee. On ne l'invente pas. */
          secondes: sec, transition: x.transition || ''
        };
      })
    };
  }

  texte(id) {
    const t = this.tracklist(id);
    if (!t) return '';
    const d = new Date(t.at);
    const entete = t.name + ' — ' + d.toLocaleDateString('fr-FR') +
                   (t.pack ? ' — ' + t.pack : '');
    return entete + '\n' + '-'.repeat(entete.length) + '\n' +
      t.lignes.map(l => l.heure + '  ' + (l.artist ? l.artist + ' — ' : '') + l.title).join('\n') +
      '\n\n' + t.lignes.length + ' morceaux — tracklist Liaison';
  }

  csv(id) {
    const t = this.tracklist(id);
    if (!t) return '';
    const d = new Date(t.at);
    const date = d.toLocaleDateString('fr-FR');
    const q = v => {
      const s = String(v == null ? '' : v);
      return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    /* point-virgule : c'est le separateur qu'attend un tableur
       configure en francais, et ces fichiers finissent tous dans
       un tableur francais. */
    const head = ['N', 'Date', 'Lieu / soiree', 'Heure', 'Titre', 'Interprete',
                  'Duree (mm:ss)', 'BPM', 'Tonalite', 'Enchainement'];
    const rows = t.lignes.map(l => [
      l.n, date, t.name, l.heure, l.title, l.artist,
      l.secondes == null ? '' : Math.floor(l.secondes / 60) + ':' + String(l.secondes % 60).padStart(2, '0'),
      l.bpm, l.key, l.transition
    ].map(q).join(';'));
    /* le BOM : sans lui, Excel affiche « Ã© » a la place de « é » */
    return '﻿' + head.join(';') + '\n' + rows.join('\n') + '\n';
  }
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
