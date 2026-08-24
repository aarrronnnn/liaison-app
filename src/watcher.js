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
      if (err || !stdout) return resolve([]);
      resolve(stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    });
  });
}

function detectFrom(lines) {
  const hay = lines.join('\n');
  const found = [];
  for (const app of APPS) {
    if (app.match.some(re => re.test(hay))) found.push(app);
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
    const lines = await listProcesses();
    const found = detectFrom(lines);
    const ids = new Set(found.map(a => a.id));

    for (const app of found) {
      if (!this.running.has(app.id)) {
        this.running.set(app.id, app);
        this.emit('open', app);
      }
    }
    for (const id of Array.from(this.running.keys())) {
      if (!ids.has(id)) {
        const app = this.running.get(id);
        this.running.delete(id);
        this.emit('close', app);
      }
    }
    this.emit('tick', Array.from(this.running.values()));
  }
  start() { this.stop(); this.tick(); this.timer = setInterval(() => this.tick(), this.interval); return this; }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  current() { return Array.from(this.running.values()); }
}

module.exports = { AppWatcher, APPS, detectFrom, listProcesses };
