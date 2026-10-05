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
const { match, search, keyOf, chansonDe } = require('./engine');

/* L'adresse que les telephones des invites peuvent joindre.
   La premiere IPv4 venue pouvait etre une carte virtuelle (WSL,
   VirtualBox, Docker), un VPN (Tailscale 100.x, NordLynx) ou un pont :
   le QR pointait dans le vide. On ecarte ces cartes, et on prefere le
   Wi-Fi puis l'Ethernet sur une plage privee. */
const VIRTUELLE = /vethernet|virtualbox|vmware|vmnet|wsl|docker|hyper-?v|utun|tun\d|tap|tailscale|zerotier|nordlynx|wireguard|wg\d|bridge|awdl|llw|vboxnet|loopback|npcap/i;
function privee(a) {
  return /^192\.168\./.test(a) || /^10\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
}
function lanIP() {
  const ifs = os.networkInterfaces();
  const cands = [];
  for (const name of Object.keys(ifs)) {
    for (const i of ifs[name] || []) {
      if (i.family !== 'IPv4' && i.family !== 4) continue;
      if (i.internal) continue;
      if (/^169\.254\./.test(i.address)) continue;            /* pas d'adresse attribuee */
      if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(i.address)) continue;   /* VPN / CGNAT */
      let note = 0;
      if (!VIRTUELLE.test(name)) note += 4;
      if (privee(i.address)) note += 2;
      if (/wi-?fi|wlan|wireless|en0|airport/i.test(name)) note += 2;
      else if (/ethernet|eth\d|en\d/i.test(name)) note += 1;
      if (/^192\.168\.56\./.test(i.address)) note -= 3;     /* VirtualBox host-only */
      cands.push({ name, addr: i.address, note });
    }
  }
  cands.sort((a, b) => b.note - a.note);
  return (cands[0] || { addr: '127.0.0.1' }).addr;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

/* ============================================================
   LE SERVEUR DES INVITES, SUR L'ORDINATEUR DU DJ.

   Il sert la page (ui/invites.html — la meme que celle du relais
   liaisondj.app), l'etat de la soiree, l'index de la bibliotheque, et
   il recoit les demandes. C'est le chemin des invites connectes au
   meme Wi-Fi que l'ordinateur ; le relais (relais.js) sert tous les
   autres, en 4G. Les deux alimentent la meme file.

   Il tourne dans le processus principal : rien ici ne doit couter.
   La recherche se fait sur le telephone ; l'etat est fabrique par
   main.js et garde deux secondes ; l'index est prepare une fois.
   ============================================================ */
const PAGE = path.join(__dirname, 'ui', 'invites.html');
const POLICES = path.join(__dirname, 'ui', 'fonts');

class GuestServer {
  constructor() {
    this.requests = new Map();
    this.devices = new Map();          /* identifiant de telephone -> historique */
    this.server = null; this.port = 0; this.token = '';
    this.cooldown = 90;                /* secondes entre deux demandes */
    this.maxPerDevice = 5;             /* pour toute la soiree */
    this.masques = new Set();
  }

  start(opts) {
    const self = this;
    this.opts = opts || {};
    this.getLibrary = opts.getLibrary || (() => []);
    this.sessionName = opts.sessionName || 'Soirée';
    this.token = opts.token || crypto.randomBytes(9).toString('base64url');
    if (opts.cooldown != null) this.cooldown = Math.max(0, opts.cooldown);
    if (opts.maxPerDevice != null) this.maxPerDevice = Math.max(1, opts.maxPerDevice);
    const port = opts.port || 7373;

    this.server = http.createServer((req, res) => {
      let u;
      try { u = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
      const json = (o, code) => {
        res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(o));
      };
      const deny = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Lien invalide'); };

      /* Les polices du site : publiques, sans jeton. */
      if (u.pathname.indexOf('/fonts/') === 0) {
        const f = path.basename(u.pathname);
        if (!/^[a-z0-9-]+\.woff2$/.test(f)) return deny();
        try {
          const b = fs.readFileSync(path.join(POLICES, f));
          res.writeHead(200, { 'Content-Type': 'font/woff2', 'Cache-Control': 'public, max-age=604800' });
          return res.end(b);
        } catch (e) { return deny(); }
      }

      /* Le jeton du QR est la seule cle d'entree : sans lui, rien ne repond.
         Sinon n'importe qui sur le wifi du lieu lirait la bibliotheque et
         pourrait bourrer les demandes. Comparaison a duree constante. */
      const given = u.pathname.indexOf('/s/') === 0 ? u.pathname.slice(3).replace(/\/.*$/, '') : (u.searchParams.get('t') || '');
      if (!self.tokenOk(given)) return deny();

      /* Identite du telephone : un cookie anonyme pose a la premiere
         visite. Il ne sert qu'a compter — une demande par personne,
         et un delai avant la suivante. Rien n'en sort de la machine. */
      let dev = (req.headers.cookie || '').match(/(?:^|;\s*)lsn=([A-Za-z0-9_-]{10,32})/);
      dev = dev ? dev[1] : null;
      const fresh = !dev;
      /* Sans cookie, on derive une identite de l'adresse reseau plutot
         que d'en tirer une neuve : sinon il suffit de ne pas renvoyer le
         cookie pour repartir a zero a chaque requete. Sur le wifi d'un
         club, plusieurs invites peuvent partager une adresse : c'est pour
         ca que le cookie reste prioritaire, et que cette voie n'est
         qu'un filet. */
      if (!dev) dev = 'a' + crypto.createHmac('sha256', self.token)
        .update(self._adresse(req)).digest('base64url').slice(0, 20);
      const setCookie = () => 'lsn=' + dev + '; Path=/; Max-Age=86400; SameSite=Lax; HttpOnly';

      if (u.pathname === '/api/etat') {
        let e = {};
        try { e = self.opts.getEtat ? self.opts.getEtat() : {}; } catch (err) { e = {}; }
        return json(Object.assign({ ouvert: true }, e, { enLigne: true, mode: 'local' }));
      }
      if (u.pathname === '/api/index') {
        let ix = null;
        try { ix = self.opts.getIndex ? self.opts.getIndex() : null; } catch (err) {}
        const i = Number(u.searchParams.get('i')) | 0;
        if (!ix || !ix.parts || !ix.parts[i]) return deny();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=86400' });
        return res.end(ix.parts[i]);
      }
      if (u.pathname === '/api/demande' && req.method === 'POST') {
        let body = '';
        req.on('data', d => { body += d; if (body.length > 4096) req.destroy(); });
        req.on('end', () => {
          let out;
          try {
            const b = JSON.parse(body || '{}');
            /* L'identifiant tire par le telephone passe devant le cookie :
               derriere certains Wi-Fi, tous les telephones sortent par la
               meme adresse et auraient partage un seul quota. Un plafond
               par adresse et par heure garde le filet contre qui viderait
               son stockage pour recommencer. */
            const id = /^[A-Za-z0-9_-]{12,40}$/.test(String(b.d || '')) ? 'p' + b.d : dev;
            if (!self._parAdresse(req)) out = { ok: false, code: 'trop', error: 'Trop de demandes depuis ce réseau.' };
            else out = self.accept({ title: b.t, artist: b.a }, id);
          } catch (e) { out = { ok: false, code: 'invalide', error: 'Demande illisible' }; }
          if (out.ok && self.opts.onRequest) { try { self.opts.onRequest(self.top()); } catch (e) {} }
          res.writeHead(out.ok ? 200 : 429, {
            'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': setCookie(), 'Cache-Control': 'no-store'
          });
          res.end(JSON.stringify(out));
        });
        return;
      }

      if (u.pathname.indexOf('/s/') !== 0) return deny();
      let page;
      try { page = fs.readFileSync(PAGE); } catch (e) { return deny(); }
      const head = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
                     'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
      if (fresh) head['Set-Cookie'] = setCookie();
      res.writeHead(200, head);
      res.end(page);
    });

    /* Un demarrage rate (port pris) ne laisse pas un serveur fantome :
       enMarche() le disait vivant, et au reveil de veille le DJ
       recevait « verifie le lien des invites » pour un lien mort. */
    const srv = this.server;
    return new Promise((resolve, reject) => {
      let ecoute = false;
      srv.on('error', e => {
        if (ecoute) return;                 /* apres demarrage : on ne tombe pas pour autant */
        if (this.server === srv) this.server = null;
        try { srv.close(); } catch (e2) {}
        reject(e);
      });
      srv.listen(port, '0.0.0.0', () => { ecoute = true; this.port = port; resolve(this.url()); });
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
  /* Il n'y a AUCUN relais devant ce serveur : il tourne sur le
     portable du DJ. X-Forwarded-For etait donc ecrit par le client
     lui-meme — en le changeant a chaque requete, un seul telephone
     devenait mille, et passait le delai, le plafond de cinq demandes
     et la limite de recherche. Seule l'adresse du socket fait foi. */
  _adresse(req) {
    return (req.socket && req.socket.remoteAddress) || 'inconnu';
  }

  /* Soixante demandes par heure et par adresse, tous telephones confondus. */
  _parAdresse(req) {
    const ip = this._adresse(req), n = Date.now();
    if (!this._adresses) this._adresses = new Map();
    const e = this._adresses.get(ip);
    if (!e || n - e.t > 3600000) { this._adresses.set(ip, { t: n, c: 1 }); return true; }
    e.c++;
    return e.c <= 60;
  }

  /* Trois recherches par seconde et par adresse (garde pour les bancs
     et les appels directs ; la page cherche desormais sur le telephone). */
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
    const title = String(b && b.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    const artist = String(b && b.artist || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    if (title.length < 2) return { ok: false, code: 'invalide', error: 'Il manque le titre' };
    if (this.ferme) return { ok: false, code: 'ferme', error: 'Les demandes sont fermées.' };

    const now = Date.now();
    const d = this.devices.get(device) || { last: 0, n: 0, voted: new Set() };

    if (d.n >= this.maxPerDevice)
      return { ok: false, code: 'quota', error: 'Tu as utilisé tes ' + this.maxPerDevice + ' demandes. Laisse la place aux autres.' };

    /* Le doublon se verifie AVANT le delai. Dans l'autre ordre, on
       repond « attends 90 secondes » a quelqu'un dont la demande
       sera refusee de toute facon. */
    const k = keyOf({ artist: artist, title: title });
    if (d.voted.has(k))
      return { ok: false, code: 'deja', error: 'Tu as déjà demandé ce morceau — il est dans la liste.' };

    const since = (now - d.last) / 1000;
    if (d.last && since < this.cooldown)
      return { ok: false, code: 'attente', reste: Math.ceil(this.cooldown - since),
               error: 'Encore un instant avant la prochaine.' };

    this._compter(k, title, artist, now);
    d.last = now; d.n++; d.voted.add(k);
    this.devices.set(device, d);
    return { ok: true, n: this.requests.get(k).n, cooldown: this.cooldown, restantes: this.maxPerDevice - d.n };
  }

  /* Une demande arrivee par le relais : les regles ont deja ete
     appliquees la-bas (delai, plafond, doublon par telephone). On la
     compte, sans la juger une seconde fois. */
  ajouterRelayee(r) {
    const title = String(r && r.t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    const artist = String(r && r.a || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
    if (title.length < 2) return false;
    this._compter(keyOf({ artist: artist, title: title }), title, artist, Number(r.at) || Date.now());
    return true;
  }

  _compter(k, title, artist, now) {
    /* La file ne grossit pas indefiniment : deux cents lignes suffisent
       tres largement a « ce que la salle reclame » ; au-dela, on oublie
       les plus anciennes et les moins demandees. */
    if (this.requests.size >= 200 && !this.requests.has(k)) {
      const vieilles = Array.from(this.requests.entries())
        .sort((a, b) => (a[1].n - b[1].n) || (a[1].at - b[1].at))
        .slice(0, 20);
      for (const [cle] of vieilles) this.requests.delete(cle);
    }
    const cur = this.requests.get(k) || { title: title, artist: artist, n: 0, at: now, first: now, k: k };
    cur.n++; cur.at = Math.max(cur.at, now);
    this.requests.set(k, cur);
  }

  /* Le DJ ecarte une demande (deplacee, deja jouee autrement, ou qui
     n'a rien a faire la) : elle disparait de son widget ET des
     telephones. Elle reste comptee, pour qu'un doublon ne la ramene pas. */
  masquer(k) { if (k) this.masques.add(k); }
  demasquer(k) { this.masques.delete(k); }

  top() {
    return Array.from(this.requests.values())
      .filter(r => !this.masques.has(r.k))
      .sort((a, b) => b.n - a.n || b.at - a.at);
  }
  clear() { this.requests.clear(); this.devices.clear(); this.masques.clear(); }
  stop() { if (this.server) try { this.server.close(); } catch (e) {} this.server = null; }
  /* Le serveur tourne-t-il ? Utilise au reveil de veille, pour ne
     signaler le lien des invites que s'il y a un lien a signaler. */
  enMarche() { return !!this.server; }
}

/* ---------- QR et partage ---------- */
async function qrPNG(url) { return QR.toDataURL(url, { margin: 1, width: 512, color: { dark: '#0E1013', light: '#FFFFFF' } }); }
async function qrSVG(url) { return QR.toString(url, { type: 'svg', margin: 1, color: { dark: '#0E1013', light: '#FFFFFF' } }); }

function shareLinks(url, sessionName) {
  const msg = 'Demande ton morceau pour ' + (sessionName || 'la soirée') + ' : ' + url;
  return {
    url: url,
    text: msg,
    whatsapp: 'https://wa.me/?text=' + encodeURIComponent(msg),
    telegram: 'https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(msg),
    sms: 'sms:?&body=' + encodeURIComponent(msg),
    mail: 'mailto:?subject=' + encodeURIComponent(sessionName || 'Soirée') + '&body=' + encodeURIComponent(msg)
  };
}

/* ---------- journal de set ---------- */
/* Les deux seuils qui definissent une vraie soiree. Voir
   soireesJouees() plus bas pour le raisonnement. */
const SOIREE_TITRES = 8;
const SOIREE_MINUTES = 45;
const PAUSE_MAX_MS = 4 * 3600 * 1000;

class SetLog {
  constructor(file) { this.file = file; this.sets = this._load(); }
  /* ------------------------------------------------------------
     Le journal relu est remis d'aplomb UNE fois, ici.

     Audit du 5 octobre 2026 : un sets.json lisible mais de travers
     — « null », un objet, une entree nulle, un set sans « played » —
     faisait jeter play() et lastPlay() a CHAQUE changement de
     morceau. Le widget restait sur l'ancien titre toute la nuit,
     sans une suggestion. list() se protegeait deja ; les autres
     methodes, non. Plutot que de garder chaque lecture, on garantit
     la forme a l'entree : un tableau de sets, chacun avec un
     tableau « played » de morceaux.
     ------------------------------------------------------------ */
  _load() {
    const brut = ecrire.lireJSON(this.file, []);
    return (Array.isArray(brut) ? brut : [])
      .filter(s => s && typeof s === 'object' && !Array.isArray(s))
      .map(s => {
        s.played = (Array.isArray(s.played) ? s.played : [])
          .filter(p => p && typeof p === 'object' && !Array.isArray(p));
        return s;
      });
  }
  /* Ecriture atomique : ce fichier est reecrit a chaque morceau joue.
     Une coupure au mauvais moment effacait toute la nuit. */
  /* ------------------------------------------------------------
     Ecrire l'historique complet a chaque morceau, avec vidage disque
     force, sur le fil qui tient le widget.

     ecrireJSON fait copie de sauvegarde + ecriture + fsync + rename,
     le tout synchrone. Et « this.sets » porte TOUT l'historique, sans
     elagage. Pour un resident au bout d'un an — une cinquantaine de
     sets de cent vingt morceaux — c'est plusieurs mega-octets ecrits
     a chaque changement de titre, pendant que le meme fil sert la
     page des invites et lit les paquets Pro DJ Link. Ca ne casse pas
     le premier soir : ca empire chaque semaine.

     Deux corrections. On regroupe les ecritures — au plus une toutes
     les quinze secondes — et on borne l'historique a soixante sets.
     Le set en cours n'est jamais perdu : on ecrit aussi a la
     fermeture et a l'arret de l'application.
     ------------------------------------------------------------ */
  _save(tout_de_suite) {
    if (this.sets.length > 60) this.sets.length = 60;
    if (tout_de_suite) {
      if (this._minuteur) { clearTimeout(this._minuteur); this._minuteur = null; }
      this._enAttente = false;
      ecrire.ecrireJSON(this.file, this.sets);
      return;
    }
    if (this._minuteur) { this._enAttente = true; return; }
    ecrire.ecrireJSON(this.file, this.sets);
    this._minuteur = setTimeout(() => {
      this._minuteur = null;
      if (this._enAttente) { this._enAttente = false; this._save(); }
    }, 15000);
    if (this._minuteur.unref) this._minuteur.unref();
  }
  /* Appelee avant de quitter : on n'attend pas le regroupement. */
  vider() { try { this._save(true); } catch (e) {} }

  open(name, pack, soiree) {
    this.current = { id: Date.now(), name: name, pack: pack, at: new Date().toISOString(), played: [] };
    /* La fiche de soiree armee au moment ou le set commence : c'est
       ce qui relie « Mariage Lea & Sam » a ce qui y a ete joue, meme
       si la fiche est renommee ensuite. */
    if (soiree) this.current.soiree = soiree;
    this.sets.unshift(this.current); this._save(true); return this.current;
  }
  /* ------------------------------------------------------------
     Une soiree finit. Rien ne refermait `current` : l'app vit dans
     la barre de menus et le Mac dort au lieu de s'eteindre, donc la
     « soiree » de samedi durait jusqu'a jeudi. Le filtre « deja passe
     ce soir » couvrait la semaine, le badge annoncait « joue il y a
     4 320 min » comme une faute de ce soir, et une mise a jour ne
     proposait plus jamais de redemarrer (« un set est en cours »).

     Quatre heures sans un seul morceau : ce n'est plus la meme
     soiree. Une pause entre deux sets ne dure pas ca.
     ------------------------------------------------------------ */
  derniereActivite() {
    const c = this.current;
    if (!c) return 0;
    const last = c.played[c.played.length - 1];
    return last && last.at ? last.at : (Date.parse(c.at) || c.id || 0);
  }
  fermerSiPerimee(now) {
    if (!this.current) return false;
    const t = this.derniereActivite();
    if (t && (now || Date.now()) - t > PAUSE_MAX_MS) { this.current = null; return true; }
    return false;
  }
  play(track, transition) {
    /* `nommer`, quand main.js le fournit, dit comment s'appelle la
       soiree EN COURS (la fiche armee) : un set ouvert tout seul par
       un morceau detecte portait jusqu'ici le nom « Session », et
       l'historique d'une fiche restait vide. Sans lui, rien ne
       change. */
    const n = typeof this.nommer === 'function' ? (() => { try { return this.nommer() || null; } catch (e) { return null; } })() : null;
    if (this.current && this.fermerSiPerimee()) {
      if (n) this.open(n.name || 'Session', n.pack || null, n.soiree);
      else this.open(this.sets[0] && this.sets[0].name || 'Session', this.sets[0] && this.sets[0].pack || null);
    }
    if (!this.current) this.open(n && n.name || 'Session', n && n.pack || null, n && n.soiree);
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
  /* `played` est lu depuis un fichier JSON sur le disque du DJ. Il
     peut etre absent — un set ouvert et jamais joue — ou abime :
     coupure de courant pendant l'ecriture, disque plein, edition
     a la main. `s.played.length` jetait alors, et depuis que
     l'essai se compte en soirees cette fonction porte le calcul
     de la LICENCE : un journal abime aurait pu verrouiller une
     app payee. On traite donc l'absence comme une session vide,
     ce qui est la lecture genereuse et la seule sans risque. */
  list() { return (this.sets || []).map(s => {
    const j = Array.isArray(s && s.played) ? s.played : [];
    return { id: s && s.id, name: s && s.name, pack: s && s.pack, at: s && s.at, n: j.length,
             soiree: (s && s.soiree) || null,
             duree: j.length > 1 ? Math.round((j[j.length - 1].at - j[0].at) / 60000) : 0 };
  }); }

  /* ============================================================
     QU'EST-CE QU'UNE VRAIE SOIREE ?

     La question n'est pas rhetorique : c'est elle qui decide
     quand l'essai se termine.

     Jusqu'ici on comptait `setlog.list().length` — le nombre de
     sessions OUVERTES. Or une session s'ouvre toute seule des
     qu'un morceau est detecte sur un deck. Brancher son
     controleur cinq minutes un mardi pour verifier que Liaison
     capte bien, c'est une session. Le DJ de mariage qui faisait
     trois essais a la maison arrivait donc au bout de son essai
     en ayant « joue trois soirees » — et sans avoir jamais vu
     l'app en cabine, la ou elle sert.

     Une vraie soiree, c'est DEUX conditions ensemble :

       - au moins 8 titres. En dessous, on n'a pas enchaine,
         on a teste.
       - au moins 45 minutes entre le premier et le dernier.
         Huit titres en dix minutes, c'est qu'on a cliqué.

     Les deux ensemble, parce que chacune seule se franchit par
     accident : on peut laisser tourner une playlist deux heures
     sans mixer (duree seule), et on peut charger huit morceaux
     d'affilee pour les ecouter (nombre seul).

     Ces deux seuils sont le seul reglage de ce mecanisme, et ils
     sont volontairement genereux : mieux vaut offrir une soiree
     de trop que fermer la porte au nez de quelqu'un qui n'a pas
     encore pu juger.
     ============================================================ */
  soireesJouees() {
    let n = 0;
    for (const s of this.list()) {
      if ((s.n | 0) >= SOIREE_TITRES && (s.duree | 0) >= SOIREE_MINUTES) n++;
    }
    return n;
  }
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
    /* La meme chanson dans un autre fichier (« Extended Mix », copie sur
       le disque externe) est la meme chanson pour la salle : le moteur
       la penalise deja comme telle, la pastille doit dire pareil. */
    const chanson = opt.track ? chansonDe(opt.track) : '';
    const memeLieu = opt.sameName ? String(opt.sameName).trim().toLowerCase() : null;
    const now = Date.now();
    let ceSoir = null, avant = null;

    for (const s of this.sets) {
      const courant = this.current && s.id === this.current.id;
      if (memeLieu && !courant && String(s.name || '').trim().toLowerCase() !== memeLieu) continue;
      for (let i = s.played.length - 1; i >= 0; i--) {
        const p = s.played[i];
        if (p.id !== trackId && !(chanson && chansonDe(p) === chanson)) continue;
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
        ? (ceSoir.min < 1 ? 'À l’instant' : 'Joué il y a ' + ceSoir.min + ' min')
        : (avant.jours === 1 ? 'Joué hier — ' + avant.set
           : avant.jours < 30 ? 'Joué il y a ' + avant.jours + ' jours — ' + avant.set
           : 'Joué il y a ' + Math.round(avant.jours / 30) + ' mois — ' + avant.set),
      /* ce soir, c'est bloquant ; une autre soiree, c'est consultatif */
      grave: !!ceSoir
    };
  }

  /** Les chansons deja passees ce soir (artiste + titre sans la version). */
  playedSongs() {
    const out = new Set();
    if (this.current) for (const p of this.current.played) { const c = chansonDe(p); if (c) out.add(c); }
    return out;
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
    const head = ['N', 'Date', 'Lieu / soirée', 'Heure', 'Titre', 'Interprète',
                  'Durée (mm:ss)', 'BPM', 'Tonalité', 'Enchaînement'];
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

module.exports = { GuestServer, SetLog, qrPNG, qrSVG, shareLinks, lanIP,
                   SOIREE_TITRES, SOIREE_MINUTES };
