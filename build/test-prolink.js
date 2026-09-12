'use strict';
/* ============================================================
   « Mon bouton LINK ne repond plus. »

   Rapport de cabine, verifie : deux CDJ-2000 relies en RJ45. Le DJ
   lance rekordbox, et le bouton LINK est mort — impossible de
   connecter ses platines. Il ferme Liaison, tout remarche.

   La cause n'etait pas subtile. Pro DJ Link tient sur trois ports
   UDP, et Liaison en prenait un : le 50002. Un port UDP ne se
   partage qu'entre applications qui le demandent toutes
   explicitement ; rekordbox le veut pour lui seul. Liaison arrivant
   en premier, rekordbox echouait a l'ouvrir, en silence.

   Une application qui ecoute passivement n'a aucun droit de bloquer
   l'instrument du DJ. Ce fichier fige la regle :

     Liaison ne tient jamais un port dont le materiel a besoin.
     En cas de doute, Liaison lache.

   On simule rekordbox par un socket qui reclame le port SANS le
   partager — exactement ce que fait le vrai.
   ============================================================ */
const dgram = require('dgram');
const prolink = require('../src/sources/prolink.js');

const PORT = 50002;
let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(52),
              detail ? '  — ' + detail : '');
}
const dors = ms => new Promise(r => setTimeout(r, ms));

/** rekordbox qui reclame le reseau, comme le vrai : sans partage. */
function rekordboxOuvre() {
  return new Promise(resolve => {
    const s = dgram.createSocket('udp4');
    s.once('error', e => resolve({ ok: false, code: e.code }));
    try {
      s.bind(PORT, () => resolve({ ok: true, fermer: () => { try { s.close(); } catch (e) {} } }));
    } catch (e) { resolve({ ok: false, code: e.code }); }
  });
}

(async () => {
  /* ---------- le port est-il seulement disponible ici ? ---------- */
  const libre = await rekordboxOuvre();
  if (!libre.ok) {
    console.log('prolink : port ' + PORT + ' indisponible dans cet environnement (' +
                libre.code + ') — essai ignore.');
    process.exit(0);
  }
  libre.fermer();
  await dors(60);

  /* ============================================================
     TEMOIN — l'ancienne regle bloquait-elle vraiment rekordbox ?
     ============================================================ */
  {
    const nous = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    await new Promise(r => nous.bind(PORT, r));
    const rb = await rekordboxOuvre();
    console.log('\n  temoin — Liaison tient le port, rekordbox ouvre : %s',
                rb.ok ? 'OUI' : 'NON (' + rb.code + ')');
    if (rb.ok) {
      echecs++;
      rb.fermer();
      console.error('  RATE le temoin ne reproduit plus le defaut : cet essai ne prouve rien.');
    }
    try { nous.close(); } catch (e) {}
    await dors(60);
  }

  /* ============================================================
     1. rekordbox tourne : Liaison ne se lie pas du tout.
     ============================================================ */
  {
    let avis = null;
    const p = prolink.start(
      { autorise: () => false },
      { onLoad() {}, onStatus(s) { if (s && s.conseil) avis = s.conseil; } }
    );
    await dors(150);
    verifier('1. rekordbox present : Liaison ne prend pas le port',
             p.lie() === false, 'lie = ' + p.lie());
    const rb = await rekordboxOuvre();
    verifier('1bis. et rekordbox ouvre son reseau normalement',
             rb.ok === true, rb.ok ? 'LINK disponible' : 'BLOQUE (' + rb.code + ')');
    if (rb.ok) rb.fermer();
    verifier('1ter. le DJ est prevenu, sans avoir rien a faire',
             !!avis && avis.cle === 'prolink-cede', avis ? avis.titre : 'aucun message');
    p.stop();
    await dors(60);
  }

  /* ============================================================
     2. Personne d'autre : Liaison ecoute, c'est son travail.
     ============================================================ */
  {
    const p = prolink.start({ autorise: () => true }, { onLoad() {}, onStatus() {} });
    await dors(200);
    verifier('2. reseau libre : Liaison ecoute bien', p.lie() === true, 'lie = ' + p.lie());
    p.stop();
    await dors(60);
  }

  /* ============================================================
     3. rekordbox demarre PENDANT la soiree : on lache sans qu'on
        nous le demande. C'est le cas reel — le DJ branche ses
        platines au dernier moment.
     ============================================================ */
  {
    let ouvert = true;                       // rekordbox pas encore lance
    const p = prolink.start({ autorise: () => ouvert }, { onLoad() {}, onStatus() {} });
    await dors(200);
    verifier('3. au depart, Liaison tient le reseau', p.lie() === true, '');

    ouvert = false;                          // le DJ lance rekordbox
    await dors(900);                         // la garde tourne 2 fois par seconde
    verifier('3bis. rekordbox demarre : Liaison lache en moins d\'une seconde',
             p.lie() === false, 'lie = ' + p.lie());
    const rb = await rekordboxOuvre();
    verifier('3ter. le bouton LINK redevient disponible',
             rb.ok === true, rb.ok ? 'ouvert' : 'BLOQUE (' + rb.code + ')');
    if (rb.ok) rb.fermer();
    await dors(60);

    /* ---------- et on reprend quand la voie se libere ---------- */
    ouvert = true;
    await dors(900);
    verifier('3quater. rekordbox ferme : Liaison reprend le reseau',
             p.lie() === true, 'lie = ' + p.lie());
    p.stop();
    await dors(60);
  }

  /* ============================================================
     4. Apres stop(), plus rien n'est tenu.
     ============================================================ */
  {
    const p = prolink.start({ autorise: () => true }, { onLoad() {}, onStatus() {} });
    await dors(200);
    p.stop();
    await dors(120);
    const rb = await rekordboxOuvre();
    verifier('4. Liaison arrete : le port est rendu',
             rb.ok === true, rb.ok ? 'libre' : 'ENCORE TENU (' + rb.code + ')');
    if (rb.ok) rb.fermer();
  }

  if (echecs) {
    console.error('\n' + echecs + ' cas Pro DJ Link en echec.');
    process.exit(1);
  }
  console.log('\nprolink : Liaison ne bloque jamais le LINK du DJ.');
  process.exit(0);
})();
