'use strict';
/* Fil d'execution separe : l'analyse de structure ne doit jamais
   figer le widget pendant un set. */
const { parentPort } = require('worker_threads');
const { structure } = require('./structure');

parentPort.on('message', async msg => {
  try {
    const r = await structure(msg.path, msg.bpm);
    parentPort.postMessage({ id: msg.id, ok: true, result: r });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: e.message });
  }
});
