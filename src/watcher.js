'use strict';
/* ============================================================
   Surveillance des logiciels de mix.
   Liaison reste en veille dans la barre de menus ; le widget
   n'apparait que lorsqu'un logiciel de mix est lance, et
   disparait quand il se ferme.
   ============================================================ */
const { EventEmitter } = require('events');
const { exec } = require('child_process');

/* Chaque logiciel : ses noms de process, la source now-playing par defaut
   et la source de bibliotheque a privilegier. */
const APPS = [
  { id: 'rekordbox', label: 'rekordbox', match: [/rekordbox/i],
    nowSource: 'prolink', librarySource: 'rekordbox' },
  { id: 'serato', label: 'Serato DJ Pro', match: [/serato\s*dj/i, /seratodj/i],
    nowSource: 'serato', librarySource: 'serato' },
  { id: 'traktor', label: 'Traktor Pro', match: [/traktor/i],
    nowSource: 'traktor', librarySource: 'traktor' },
  { id: 'virtualdj', label: 'VirtualDJ', match: [/virtual\s*dj/i, /virtualdj/i],
    nowSource: 'virtualdj', librarySource: 'virtualdj' },
  { id: 'enginedj', label: 'Engine DJ', match: [/engine\s*dj/i],
    nowSource: 'prolink', librarySource: 'folder' },
  { id: 'djay', label: 'djay Pro', match: [/djay/i],
    nowSource: 'nowfile', librarySource: 'folder' },
  { id: 'mixxx', label: 'Mixxx', match: [/mixxx/i],
    nowSource: 'nowfile', librarySource: 'folder' }
];

function listProcesses() {
  return new Promise(resolve => {
    const cmd = process.platform === 'win32'
      ? 'tasklist /fo csv /nh'
      : 'ps -Ao comm=';
    exec(cmd, { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      /* null, et non [] : « la commande a echoue » n'est pas « aucun
         logiciel ne tourne ». Les confondre faisait disparaitre le
         widget en pleine soiree des qu'un « ps » ratait une fois. */
      if (err || !stdout) return resolve(null);
      resolve(stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    });
  });
}

/* ------------------------------------------------------------
   On compare le NOM du programme, pas toute la ligne.

   `ps -Ao comm=` rend le chemin complet, et on cherchait « rekordbox »
   n'importe ou dedans. Or rekordboxAgent (le service de synchro de
   rekordbox) se lance a l'ouverture de session et tourne en
   permanence : Liaison croyait rekordbox ouvert toute la journee —
   widget affiche au demarrage, et le reseau des platines jamais
   considere comme libre. Meme piege pour les assistants, les
   services de mise a jour et les rapporteurs de plantage.
   ------------------------------------------------------------ */
const ANNEXE = /(agent|helper|updater|update|crashpad|crash|service|daemon|installer|uninstall)/i;
function nomDuProgramme(ligne) {
  let x = String(ligne || '').trim();
  if (x.startsWith('"')) x = x.slice(1, x.indexOf('"', 1) > 0 ? x.indexOf('"', 1) : undefined);   /* tasklist /fo csv */
  x = x.split(/[\\/]/).pop();
  return x.replace(/\.exe$/i, '').trim();
}
function detectFrom(lines) {
  const noms = (lines || []).map(nomDuProgramme).filter(n => n && !ANNEXE.test(n));
  const found = [];
  for (const app of APPS) {
    if (noms.some(n => app.match.some(re => re.test(n)))) found.push(app);
  }
  return found;
}

class AppWatcher extends EventEmitter {
  constructor(intervalMs) {
    super();
    this.interval = intervalMs || 4000;
    this.running = new Map();
    this.timer = null;
  }
  async tick() {
    /* Un « tasklist » lent sous Windows (plusieurs secondes sur une
       machine chargee) laissait l'intervalle relancer un releve par
       dessus le precedent ; ils pouvaient revenir dans le desordre. */
    if (this._enCours) return;
    this._enCours = true;
    let lines;
    try { lines = await listProcesses(); } finally { this._enCours = false; }
    /* ------------------------------------------------------------
       Un releve rate ne ferme rien.

       A 2 h du matin, la machine est chargee : trois ffmpeg, le
       logiciel de mix, un enregistreur. Un « ps » qui echoue en
       EAGAIN, ou une sortie « tasklist » qui deborde du tampon, et
       la liste revenait vide. L'app en concluait que le logiciel de
       mix venait de se fermer : morceau en cours oublie, widget
       cache, configuration reecrite sur le disque. En plein set.

       On ignore donc purement le releve rate. Et meme quand il
       reussit, il faut DEUX disparitions consecutives avant de
       conclure a une fermeture — la meme prudence que la detection
       de deck applique deja.
       ------------------------------------------------------------ */
    if (lines === null) return;
    const found = detectFrom(lines);
    const ids = new Set(found.map(a => a.id));
    if (!this.absents) this.absents = new Map();

    for (const app of found) {
      if (!this.running.has(app.id)) {
        this.running.set(app.id, app);
        this.emit('open', app);
      }
    }
    for (const id of Array.from(this.running.keys())) {
      if (ids.has(id)) { this.absents.delete(id); continue; }
      const n = (this.absents.get(id) || 0) + 1;
      this.absents.set(id, n);
      if (n < 2) continue;                 /* premiere absence : on attend */
      const app = this.running.get(id);
      this.running.delete(id);
      this.absents.delete(id);
      this.emit('close', app);
    }
    this.emit('tick', Array.from(this.running.values()));
  }
  start() { this.stop(); this.tick(); this.timer = setInterval(() => this.tick(), this.interval); return this; }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  current() { return Array.from(this.running.values()); }
}

module.exports = { AppWatcher, APPS, detectFrom, listProcesses };
