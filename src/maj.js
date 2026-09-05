'use strict';
/* ============================================================
   Y a-t-il une version plus recente ?

   Sans ce module, la seule facon de savoir qu'une correction
   existe est d'aller voir le site — donc personne ne le sait.
   Un DJ garde une version d'il y a six mois sans se douter que
   le bug qui l'agace a ete corrige en octobre. C'est arrive ici
   meme : des heures de test sur une 0.6 pendant que la 0.9
   attendait en ligne.

   Ce que ce module NE fait pas, volontairement : telecharger,
   remplacer ou relancer quoi que ce soit tout seul. Une mise a
   jour silencieuse pendant une soiree, c'est un widget qui
   redemarre a une heure du matin devant deux cents personnes.
   On previent, discretement, et le DJ decide du moment.
   ============================================================ */
const https = require('https');
const http = require('http');

/* Compare deux numeros de version facon « 1.10.0 > 1.9.3 ».
   Une comparaison de texte donnerait l'inverse, et l'app
   annoncerait une mise a jour vers une version plus ancienne. */
function plusRecente(candidate, courante) {
  const nu = v => String(v || '0').replace(/^v/, '').split(/[-+]/)[0]
    .split('.').map(x => parseInt(x, 10) || 0);
  const pre = v => /[-+]/.test(String(v || ''));      /* 1.0.2-beta, 1.0.2+essai */
  const a = nu(candidate), b = nu(courante);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x > y;
  }
  /* Memes chiffres : une version finale l'emporte sur une preversion.
     Sans cette regle, quelqu'un reste bloque sur une 1.0.2-beta alors
     que la 1.0.2 est sortie — et rien ne le lui dit jamais. */
  return pre(courante) && !pre(candidate);
}

function lire(url, timeoutMs) {
  return new Promise(resolve => {
    let fini = false;
    const fin = v => { if (!fini) { fini = true; resolve(v); } };
    try {
      const mod = url.startsWith('http://') ? http : https;
      const req = mod.request(url, { method: 'GET', headers: { 'User-Agent': 'liaison-app' } }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location)
          return fin(lire(res.headers.location, timeoutMs));
        if (res.statusCode !== 200) { res.resume(); return fin(null); }
        let d = '';
        res.setEncoding('utf8');
        res.on('data', c => { d += c; if (d.length > 60000) req.destroy(); });
        res.on('end', () => { try { fin(JSON.parse(d)); } catch (e) { fin(null); } });
      });
      req.on('error', () => fin(null));
      req.setTimeout(timeoutMs || 4000, () => { req.destroy(); fin(null); });
      req.end();
    } catch (e) { fin(null); }
  });
}

/**
 * Interroge le site et compare avec la version qui tourne.
 * Ne leve jamais : hors ligne, on ne sait pas, et ne pas savoir
 * n'est pas une erreur a montrer au DJ.
 *
 * @param {string} courante  la version de l'application en cours
 * @param {string[]} bases   les adresses du site, dans l'ordre
 * @returns {Promise<null|{aJour:boolean, version:string, publie:string,
 *                         notes:string, page:string}>}
 */
async function verifier(courante, bases) {
  for (const base of (bases || [])) {
    const j = await lire(String(base).replace(/\/$/, '') + '/api/version', 4000);
    if (!j || !j.version) continue;
    return {
      aJour: !plusRecente(j.version, courante),
      version: String(j.version),
      publie: j.publie || '',
      notes: String(j.notes || '').slice(0, 1200),
      page: j.page || (String(base).replace(/\/$/, '') + '/telecharger')
    };
  }
  return null;
}

module.exports = { verifier, plusRecente };
