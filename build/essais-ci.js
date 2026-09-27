'use strict';
/* ============================================================
   LA SUITE, UN ESSAI A LA FOIS — pour la CI.

   `npm run verifier` enchaine les essais avec && : le premier qui
   echoue arrete tout, et sur GitHub le seul message visible sans
   droits d'administration est « exit code 1 ». Sur un systeme ou
   rien n'avait jamais tourne (Windows, macOS), c'est aveugle.

   Ici, chaque essai de la liste de `verifier` tourne seul, jusqu'au
   bout, quoi qu'il arrive aux autres. Un echec devient une
   annotation GitHub (::error) avec le nom de l'essai, le systeme et
   ses dernieres lignes — lisible depuis l'API publique des
   annotations. La sortie complete est repliee dans le journal.

   Meme liste que `npm run verifier` : elle est lue dans package.json,
   jamais recopiee.
   ============================================================ */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const racine = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(racine, 'package.json'), 'utf8'));
const essais = String(pkg.scripts.verifier || '').split('&&')
  .map(s => s.trim()).map(s => (/^node\s+(\S+)$/.exec(s) || [])[1]).filter(Boolean);

const os = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
const ci = !!process.env.GITHUB_ACTIONS;
/* Une annotation tient sur une ligne : les retours sont encodes. */
const enc = s => String(s).replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A');

const rates = [];
const debut = Date.now();
for (const e of essais) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [e], { cwd: racine, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env, timeout: 10 * 60 * 1000 });
  const sortie = (r.stdout || '') + (r.stderr ? '\n' + r.stderr : '') + (r.error ? '\n' + r.error.message : '');
  const ok = r.status === 0 && !r.error;
  const duree = ((Date.now() - t0) / 1000).toFixed(1) + ' s';
  if (ci) console.log('::group::' + (ok ? 'ok   ' : 'ECHEC ') + e + ' (' + duree + ')');
  else console.log((ok ? 'ok    ' : 'ECHEC ') + e + ' (' + duree + ')');
  if (ci || !ok) console.log(sortie);
  if (ci) console.log('::endgroup::');
  if (!ok) {
    /* Les lignes utiles d'abord : celles qui disent ce qui a rate. */
    const lignes = sortie.split('\n');
    const signal = lignes.filter(l => /ECHEC|RATE|Error|error|✗|FAIL|AssertionError|at .*\.js:\d+/.test(l)).slice(0, 25);
    const fin = lignes.filter(l => l.trim()).slice(-15);
    const corps = (signal.length ? signal : []).concat(['— fin de sortie —'], fin).join('\n').slice(0, 3500);
    rates.push({ e: e, corps: corps });
    if (ci) console.log('::error title=' + enc(path.basename(e) + ' (' + os + ', code ' + r.status + ')') + '::' + enc(corps));
  }
}
const total = ((Date.now() - debut) / 1000).toFixed(0);
const bilan = essais.length - rates.length + ' / ' + essais.length + ' essais passent sur ' + os + ' (' + total + ' s)';
console.log('\n' + bilan + (rates.length ? '\nEn echec : ' + rates.map(x => x.e).join(', ') : ''));
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### ' + bilan + '\n\n' +
      rates.map(x => '#### ' + x.e + '\n```\n' + x.corps + '\n```\n').join('\n'));
  } catch (err) {}
}
process.exit(rates.length ? 1 : 0);
