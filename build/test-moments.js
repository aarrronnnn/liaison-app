'use strict';
/* Les deux moments de l'essai : douze cas, dont les quatre pieges. */
const m = require('../src/moments');
let ko = 0;
function cas(nom, e, attendu) {
  const r = m.aMontrer(e);
  const ok = r.rappel === attendu.rappel && r.fin === attendu.fin;
  if (!ok) { ko++; console.log('  ECHEC  ' + nom + ' — attendu ' + JSON.stringify(attendu) + ', obtenu ' + JSON.stringify(r)); }
}
const T = (o) => Object.assign({ tier: 'trial', trialLeft: 7, trialStart: 1, setEnCours: false }, o);

cas('debut d\'essai : rien',            T({ trialLeft: 7 }),                  { rappel: false, fin: false });
cas('J-3 : encore rien',                T({ trialLeft: 3 }),                  { rappel: false, fin: false });
cas('J-2 : le rappel',                  T({ trialLeft: 2 }),                  { rappel: true,  fin: false });
cas('J-1 : le rappel',                  T({ trialLeft: 1 }),                  { rappel: true,  fin: false });
cas('J-2 deja vu : plus rien',          T({ trialLeft: 2, vuRappel: 1 }),     { rappel: false, fin: false });
cas('J-2 pendant un set : rien',        T({ trialLeft: 2, setEnCours: true }),{ rappel: false, fin: false });
cas('essai fini : la fenetre',          T({ tier: 'expire', trialLeft: 0 }),    { rappel: false, fin: true });
cas('essai fini, deja vue : rien',      T({ tier: 'expire', trialLeft: 0, vuFin: 1 }), { rappel: false, fin: false });
cas('essai fini pendant un set : rien', T({ tier: 'expire', trialLeft: 0, setEnCours: true }), { rappel: false, fin: false });
cas('verrouille sans essai : rien',     T({ tier: 'expire', trialLeft: 0, trialStart: 0 }), { rappel: false, fin: false });
cas('client resident : rien',           T({ tier: 'resident', trialLeft: 0 }),{ rappel: false, fin: false });
cas('client collectif a J-2 : rien',    T({ tier: 'collectif', trialLeft: 2 }),{ rappel: false, fin: false });
cas('etat vide : rien',                 null,                                 { rappel: false, fin: false });

/* La phrase */
const p1 = m.phraseRappel(2, { enchainements: 213, sets: 4 });
const p2 = m.phraseRappel(1, { enchainements: 0, sets: 1 });
const p3 = m.phraseRappel(3, {});
if (!/213 enchaînements plus tard/.test(p1)) { ko++; console.log('  ECHEC  phrase : le bilan chiffre manque'); }
if (!/2 jours/.test(p1)) { ko++; console.log('  ECHEC  phrase : pluriel des jours'); }
if (!/^1 set plus tard, il te reste 1 jour /.test(p2)) { ko++; console.log('  ECHEC  phrase : singulier — ' + p2); }
if (!/^il te reste 3 jours/.test(p3)) { ko++; console.log('  ECHEC  phrase : sans bilan — ' + p3); }
if (/perd|perdre|expire/i.test(p1 + p2 + p3)) { ko++; console.log('  ECHEC  phrase : vocabulaire de la peur'); }

/* Le premier debrief offert */
function deb(nom, e, attendu) {
  const r = m.debriefAutorise(e);
  if (r.ok !== attendu.ok || r.offert !== attendu.offert) {
    ko++; console.log('  ECHEC  ' + nom + ' — attendu ' + JSON.stringify(attendu) + ', obtenu ' + JSON.stringify(r));
  }
}
deb('gratuit, premiere fois : offert',   { replay: false },                    { ok: true,  offert: true });
deb('gratuit, deja offert : ferme',      { replay: false, dejaOffert: 1 },     { ok: false, offert: false });
deb('resident : ouvert, pas offert',     { replay: true },                     { ok: true,  offert: false });
deb('resident apres une offre : ouvert', { replay: true, dejaOffert: 1 },      { ok: true,  offert: false });
deb('etat vide : offert une fois',       null,                                 { ok: true,  offert: true });

/* La prolongation d'essai */
function pro(nom, e, attendu) {
  const r = m.prolongationDue(e);
  if (r.prolonger !== attendu) {
    ko++; console.log('  ECHEC  ' + nom + ' — attendu prolonger=' + attendu + ', obtenu ' + JSON.stringify(r));
  }
}
const P = (o) => Object.assign({ tier: 'expire', trialLeft: 0, trialStart: 1, sets: 0 }, o);
pro('essai fini, aucune soiree : on prolonge',   P({ sets: 0 }), true);
pro('essai fini, une seule soiree : on prolonge',P({ sets: 1 }), true);
pro('essai fini, deux soirees : non',            P({ sets: 2 }), false);
pro('essai fini, dix soirees : non',             P({ sets: 10 }), false);
pro('essai en cours : non',                      P({ tier: 'trial', trialLeft: 5 }), false);
pro('deja prolonge : jamais deux fois',          P({ dejaProlonge: 1 }), false);
pro('client resident : non',                     P({ tier: 'resident' }), false);
pro('jamais commence l\'essai : non',            P({ trialStart: 0 }), false);
pro('etat vide : non',                           null, false);
if (m.prolongationDue(P({ sets: 0 })).jours !== 7) { ko++; console.log('  ECHEC  la prolongation ne fait pas 7 jours'); }
const q0 = m.phraseProlongation(0), q1 = m.phraseProlongation(1);
if (!/pas encore joué une seule soirée/.test(q0)) { ko++; console.log('  ECHEC  phrase prolongation 0 set — ' + q0); }
if (!/n'as joué qu'une soirée/.test(q1)) { ko++; console.log('  ECHEC  phrase prolongation 1 set — ' + q1); }
if (!/7 jours/.test(q0)) { ko++; console.log('  ECHEC  phrase prolongation : la duree manque'); }

if (ko) { console.log('\n' + ko + ' cas en echec.'); process.exit(1); }
console.log('moments : 13 cas d\'essai, 5 de phrase, 5 de debrief, 9 de prolongation — tout passe.');
