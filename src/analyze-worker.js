'use strict';
/* ============================================================
   Fil d'analyse.

   Le calcul d'energie et de timbre est une FFT sur 90 secondes
   d'audio : environ deux secondes de processeur par morceau. Fait
   dans le processus principal, il gele la fenetre — et sur une
   bibliotheque de 20 000 titres, il la gele pendant des heures.

   Ce fichier est le meme calcul, mais dans un fil separe. Le
   processus principal n'y envoie que des chemins et n'en recoit
   que des resultats : il reste libre de repondre au DJ pendant
   que ca tourne.
   ============================================================ */
const { parentPort } = require('worker_threads');
const { analyze } = require('./analyze');

if (!parentPort) return;

parentPort.on('message', async job => {
  /* job = { id, path, seconds } */
  try {
    const r = await analyze(job.path, { seconds: job.seconds || 90 });
    parentPort.postMessage({
      id: job.id, ok: true,
      patch: {
        energy: r.energy,
        timbre: r.timbre,
        vocal: r.vocalish >= 5 ? 1 : 0,
        /* Ce que Liaison mesure lui-meme, garde a part de ce que dit
           le logiciel de mix. On ne remplace pas l'un par l'autre :
           on les compare, et c'est cette comparaison qui revele les
           morceaux mal tagues. */
        mBpm: r.bpm || 0,
        mKey: r.key || null,
        mKeyConf: r.keyConfidence || 0
      }
    });
  } catch (e) {
    parentPort.postMessage({ id: job.id, ok: false, error: String(e && e.message || e) });
  }
});
