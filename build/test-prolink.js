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
     3quinquies. LE DEFAUT macOS.

     La premiere version demandait reuseAddr ET reusePort dans le
     meme socket. Sur Linux les deux drapeaux cohabitent et tout
     passait ; sur macOS et les BSD, libuv refuse la combinaison, le
     bind echoue, et le gestionnaire d'erreur prenait cet echec pour
     « quelqu'un d'autre tient le port ». Resultat : Pro DJ Link ne
     fonctionnait PAS sur Mac, sans le moindre message — et l'essai
     ne pouvait pas le voir, parce qu'il tourne sur Linux.

     On ne peut pas simuler macOS ici. On peut en revanche figer la
     regle qui a manque : aucune combinaison des deux drapeaux dans
     un meme socket. Ce cas-la se lit sur n'importe quel systeme.
     ============================================================ */
  {
    const echelle = prolink.PARTAGES || [];
    verifier('3quinquies. une option de partage a la fois, jamais deux',
             echelle.length > 0 && echelle.every(c => !(c.opt.reuseAddr && c.opt.reusePort)),
             echelle.map(c => c.cle).join(' puis '));
    verifier('3sexies. et le vrai partage est essaye en premier',
             echelle[0] && echelle[0].vraiPartage === true,
             echelle[0] ? echelle[0].cle : 'aucune');
    /* Chaque option doit reellement fonctionner sur CE systeme, ou
       l'echelle ne sert a rien. On les essaie une par une. */
    for (const c of echelle) {
      const s = await new Promise(r => {
        const x = require('dgram').createSocket(Object.assign({ type: 'udp4' }, c.opt));
        x.once('error', e => r({ ok: false, code: e.code }));
        try { x.bind({ port: PORT, exclusive: false }, () => r({ ok: true, fermer: () => { try { x.close(); } catch (y) {} } })); }
        catch (e) { r({ ok: false, code: e.code }); }
      });
      console.log('    · %s sur ce systeme : %s', c.cle.padEnd(10),
                  s.ok ? 'accepte' : 'REFUSE (' + s.code + ')');
      if (s.ok) s.fermer();
      await dors(60);
    }
  }

  /* ============================================================
     3septies. LE CAS MAC, rejoue ici.

     Mesure sur un vrai Mac : reusePort est REFUSE (ENOTSUP). macOS
     ne connait pas SO_REUSEPORT pour l'UDP, donc tous les Mac
     tombent sur reuseAddr — c'est-a-dire que Liaison OCCUPE le
     port au lieu de le partager. La garde n'est plus un confort :
     c'est la seule chose qui empeche de bloquer le bouton LINK.

     On rejoue donc ce mode ici, en retirant reusePort de l'echelle,
     et on verifie que le filet tient : Liaison ecoute, et lache
     assez vite pour que rekordbox n'echoue pas a son lancement.
     ============================================================ */
  {
    const vraie = prolink.PARTAGES.slice();
    prolink.PARTAGES.length = 0;
    for (const c of vraie) if (c.cle !== 'reusePort') prolink.PARTAGES.push(c);
    try {
      let ouvert = true;
      const p = prolink.start({ autorise: () => ouvert }, { onLoad() {}, onStatus() {} });
      await dors(200);
      verifier('3septies. en mode Mac (reuseAddr), Liaison ecoute quand meme',
               p.lie() === true, 'partage = ' + p.stats().partage);
      ouvert = false;                       /* le DJ lance rekordbox */
      await dors(400);                      /* la garde serree : 4 fois par seconde */
      verifier('3octies. et il lache en moins d\'une demi-seconde',
               p.lie() === false, 'lie = ' + p.lie());
      const rb = await rekordboxOuvre();
      verifier('3nonies. le bouton LINK reste donc disponible',
               rb.ok === true, rb.ok ? 'ouvert' : 'BLOQUE (' + rb.code + ')');
      if (rb.ok) rb.fermer();
      p.stop();
      await dors(60);
    } finally {
      prolink.PARTAGES.length = 0;
      for (const c of vraie) prolink.PARTAGES.push(c);
    }
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
