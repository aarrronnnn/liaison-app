'use strict';
/* ============================================================
   La relecture de la bibliotheque, hors du fil principal.

   Le logiciel de mix reecrit sa base des que le DJ ajoute un
   morceau — en plein set. Liaison la relisait aussitot, et tout se
   faisait sur le fil qui tient le widget : lecture d'un XML de
   50 Mo, fusion, doublons, puis un stat() par morceau pour trouver
   les fichiers disparus — 50 000 appels au disque, deux fois (le
   second dans l'analyse). Sur un disque USB ou sous Windows avec
   l'antivirus, plusieurs secondes de widget gele, detection des
   platines comprise.

   Tout ce travail vit maintenant ici. Le fil principal envoie la
   liste des sources et recoit la bibliotheque prete, avec l'etat de
   chaque fichier deja mesure : il n'a plus qu'a l'echanger.
   ============================================================ */
const { parentPort } = require('worker_threads');
const fs = require('fs');
const autolib = require('./autolibrary');
const libmod = require('./library');

if (!parentPort) return;

parentPort.on('message', async job => {
  try {
    const lists = [], rapports = [];
    let dernierProgres = 0;
    for (const src of job.sources) {
      let l = null, err = null;
      try {
        l = await autolib.readSource(src, x => {
          const n = Date.now();
          if (n - dernierProgres < 250) return;          /* pas de rafale de messages */
          dernierProgres = n;
          parentPort.postMessage({ id: job.id, progress: x });
        }, { cache: job.cache });
      } catch (e) { err = e && e.message || String(e); }
      lists.push(l || []);
      rapports.push({
        kind: src.kind, path: src.path, manuel: !!src.manuel, label: src.label, erreur: err,
        lus: (l || []).length,
        exemples: (l || []).slice(0, 3).map(t => ({
          path: t.path,
          existe: (() => { try { return !!t.path && fs.statSync(t.path).isFile(); } catch (e) { return false; } })()
        }))
      });
    }
    const merged = autolib.merge(lists);
    const sansDoublons = libmod.dedoublonner(merged);

    /* Un seul stat par fichier : il dit s'il existe ET donne
       l'empreinte (taille + date) que l'analyse utilise pour son
       cache. Le fil principal n'aura plus a toucher le disque. */
    const empreintes = new Map();
    const existe = p => {
      try {
        const s = fs.statSync(p);
        empreintes.set(p, s.size + ':' + Math.round(s.mtimeMs));
        return true;
      } catch (e) {
        empreintes.set(p, null);
        return !(e && e.code === 'ENOENT');
      }
    };
    const elagage = libmod.elaguerDisparus(sansDoublons.tracks, { existe });
    const library = libmod.finalize(elagage.gardes);
    for (const t of library) if (t.path && empreintes.has(t.path)) t._stamp = empreintes.get(t.path);

    parentPort.postMessage({
      id: job.id, ok: true, library, rapports,
      replies: sansDoublons.replies || 0,
      disparus: elagage.disparus.length,
      horsLigne: elagage.horsLigne || 0
    });
  } catch (e) {
    parentPort.postMessage({ id: job.id, ok: false, error: e && e.message || String(e) });
  }
});
