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
    if (!mod) {
      /* ------------------------------------------------------------
         Une source qui n'existe pas ne doit pas laisser un widget muet.

         watcher.js annonce « nowSource: 'nowfile' » pour djay Pro et
         Mixxx. Ce module n'existe nulle part. Le DJ voyait « Aucun
         logiciel », un widget vide toute la soiree, et aucune raison.

         Tant que la lecture automatique n'existe pas pour ces
         logiciels, on le DIT et on montre le chemin qui marche : la
         loupe, deux lettres, et Liaison enchaine. C'est la meme
         reponse honnete que pour rekordbox sous Windows.
         ------------------------------------------------------------ */
      this.emit('status', {
        kind: kind, ok: false,
        msg: 'Ce logiciel n\'annonce pas ce qu\'il joue — declare le morceau a la main',
        conseil: {
          cle: 'source-non-lisible', quand: 'deck',
          titre: 'Ce logiciel ne publie pas le morceau en cours',
          texte: 'Liaison sait lire Serato, Traktor, VirtualDJ et rekordbox avec du materiel ' +
                 'sur le reseau. Ton logiciel, lui, n\'annonce rien : ce n\'est pas une panne, ' +
                 'c\'est une limite de son cote.',
          marche: ['Clique la loupe en haut, tape deux lettres du titre',
                   'Liaison propose la suite, avec les points de mix',
                   'Une seule frappe par morceau, pas plus'],
          repli: 'Si tu joues aussi sur Serato, Traktor ou VirtualDJ, la lecture y est ' +
                 'automatique et sans materiel.'
        }
      });
      return;
    }
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
