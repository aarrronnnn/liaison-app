'use strict';
/* ============================================================
   Detection du morceau en cours, par logiciel.
   Chaque source emet { text } ; le rapprochement avec la
   bibliotheque se fait par correspondance floue (engine.match).
   ============================================================ */
const { EventEmitter } = require('events');

const serato = require('./serato');
const virtualdj = require('./virtualdj');
const traktor = require('./traktor');
const prolink = require('./prolink');

const SOURCES = { serato, virtualdj, traktor, prolink };

class NowPlaying extends EventEmitter {
  constructor() { super(); this.active = null; this.kind = null; }
  start(kind, opts) {
    this.stop();
    const mod = SOURCES[kind];
    if (!mod) { this.emit('status', { kind: kind, ok: false, msg: 'Source inconnue' }); return; }
    this.kind = kind;
    this.active = mod.start(opts || {}, {
      onText: (text, meta) => this.emit('text', text, meta || {}),
      onLoad: st => this.emit('deck', st),
      onRaw: st => this.emit('raw', st),
      onStatus: s => this.emit('status', Object.assign({ kind: kind }, s))
    });
  }
  stop() {
    if (this.active && this.active.stop) { try { this.active.stop(); } catch (e) {} }
    this.active = null; this.kind = null;
  }
}

module.exports = { NowPlaying, SOURCES };
