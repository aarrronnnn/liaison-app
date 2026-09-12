'use strict';
/* ============================================================
   Pro DJ Link — ecoute passive du reseau cabine (rekordbox / CDJ).
   C'est le seul protocole qui annonce le morceau CHARGE sur un deck,
   et pas seulement celui qui a ete joue. On lit les paquets d'etat
   diffuses sur le port UDP 50002.

   Ce que le paquet contient : numero de deck, identifiant rekordbox
   du morceau, BPM, etat de lecture. Pas le titre : celui-ci se
   retrouve en croisant l'identifiant avec l'export rekordbox.xml.

   Etat : experimental. Passif par defaut (on n'emet rien sur le
   reseau). Si aucun paquet n'arrive, active `announce` pour se
   declarer comme peripherique virtuel.
   ============================================================ */
const dgram = require('dgram');
const os = require('os');

const MAGIC = Buffer.from([0x51, 0x73, 0x70, 0x74, 0x31, 0x57, 0x6d, 0x4a, 0x4f, 0x4c]);
const PORT_STATUS = 50002;
const PORT_ANNOUNCE = 50000;

const TYPE_STATUS = 0x0a;
const TYPE_KEEPALIVE = 0x06;

function isProlink(buf) {
  return buf.length > 32 && buf.slice(0, 10).equals(MAGIC);
}

/** Lit un paquet d'etat CDJ. Offsets defensifs : on verifie la longueur. */
function parseStatus(buf) {
  if (!isProlink(buf) || buf[10] !== TYPE_STATUS) return null;
  const at = (o, n) => (o + n <= buf.length ? buf.readUIntBE(o, n) : 0);
  const device = at(0x21, 1) || at(0x24, 1);
  const name = buf.toString('ascii', 11, 31).replace(/\0.*$/, '').trim();
  const trackId = at(0x2c, 4);
  const sourcePlayer = at(0x28, 1);
  const sourceSlot = at(0x29, 1);
  const bpmRaw = at(0x92, 2);
  const bpm = bpmRaw && bpmRaw !== 0xffff ? bpmRaw / 100 : 0;
  const pitchRaw = at(0xa6, 3) || at(0x8d, 3);
  const pitch = pitchRaw ? (pitchRaw - 0x100000) / 0x100000 : 0;
  const flags = at(0x89, 1);
  const playing = !!(flags & 0x40);
  const onAir = !!(flags & 0x08);
  return {
    device, name, trackId, sourcePlayer, sourceSlot,
    bpm: Math.round(bpm * (1 + pitch) * 10) / 10,
    bpmTrack: Math.round(bpm * 10) / 10,
    pitch: Math.round(pitch * 10000) / 100,
    playing, onAir
  };
}

function localIPv4() {
  const ifs = os.networkInterfaces();
  for (const n of Object.keys(ifs)) {
    for (const i of ifs[n] || []) {
      if (i.family === 'IPv4' && !i.internal) return { addr: i.address, mac: i.mac };
    }
  }
  return { addr: '127.0.0.1', mac: '00:00:00:00:00:00' };
}

/** Paquet keep-alive minimal : nous declare comme peripherique virtuel. */
function keepAlivePacket(deviceNumber, name) {
  const b = Buffer.alloc(0x36, 0);
  MAGIC.copy(b, 0);
  b[10] = TYPE_KEEPALIVE;
  b[11] = 0x00;
  Buffer.from(name.padEnd(20, '\0'), 'ascii').copy(b, 12, 0, 20);
  b[0x20] = 0x01; b[0x21] = 0x02;
  b.writeUInt16BE(0x0036, 0x22);
  b[0x24] = deviceNumber;
  b[0x25] = 0x01;                       // type : lecteur
  const net = localIPv4();
  const mac = net.mac.split(':').map(h => parseInt(h, 16) || 0);
  for (let i = 0; i < 6; i++) b[0x26 + i] = mac[i] || 0;
  const ip = net.addr.split('.').map(Number);
  for (let i = 0; i < 4; i++) b[0x2c + i] = ip[i] || 0;
  b[0x34] = 0x01; b[0x35] = deviceNumber;
  return b;
}

/* ============================================================
   LA REGLE, ET POURQUOI ELLE EXISTE.

   Rapport de cabine : deux CDJ-2000 relies en RJ45. Le DJ lance
   rekordbox, et son bouton LINK ne repond plus — impossible de
   connecter ses platines. Il ferme Liaison, tout remarche.

   La cause est ici. Pro DJ Link tient sur trois ports UDP, et
   celui-ci en prend un : le 50002. Sous macOS, un port UDP ne se
   partage qu'entre applications qui le demandent TOUTES
   explicitement. rekordbox, lui, le veut pour lui seul. Liaison
   arrivant en premier, rekordbox echoue a l'ouvrir, et son LINK
   meurt en silence.

   Ce n'est pas un defaut de reglage, c'est une faute de conception
   de ma part : une application qui ecoute passivement n'a aucun
   droit de bloquer l'instrument du DJ.

   La regle est donc absolue :

     Liaison ne tient JAMAIS un port dont le materiel du DJ a
     besoin. En cas de doute, Liaison lache.

   Concretement : si rekordbox tourne, on ne se lie pas du tout —
   on passe par la lecture des fichiers ouverts, qui ne demande
   rien au reseau. Si rekordbox demarre pendant qu'on ecoute, on
   libere le port dans la seconde. Un DJ ne doit jamais avoir a
   fermer Liaison pour que ses platines fonctionnent.
   ============================================================ */

/** Ouvre un socket UDP en partageant le port autant que le systeme l'accepte. */
function ouvrirPartage() {
  /* reusePort (SO_REUSEPORT) existe depuis Node 22 : quand les deux
     applications le demandent, elles cohabitent vraiment. On le tente,
     et on retombe sur reuseAddr seul si la version ne le connait pas. */
  try { return dgram.createSocket({ type: 'udp4', reuseAddr: true, reusePort: true }); }
  catch (e) { return dgram.createSocket({ type: 'udp4', reuseAddr: true }); }
}

const CONSEIL_CEDE = {
  cle: 'prolink-cede', quand: 'deck',
  titre: 'Liaison a laisse le reseau a rekordbox',
  texte: 'rekordbox a besoin du reseau Pro DJ Link pour parler a tes platines. ' +
         'Liaison lui laisse la place et lit tes decks autrement : ton bouton LINK ' +
         'reste disponible.',
  marche: [
    'Tu n\'as rien a faire : la detection continue par les fichiers',
    'Ferme rekordbox si tu joues uniquement sur cles USB, Liaison reprendra le reseau'
  ]
};

/**
 * @param opts { announce:boolean, deviceNumber:number, autorise:function }
 *   autorise() — rendue par l'appelant : false tant qu'une autre
 *   application a besoin du reseau Pro DJ Link. Absente, on considere
 *   que la voie est libre.
 * @param cb   { onLoad(state), onStatus(s), onRaw(state) }
 */
function start(opts, cb) {
  opts = opts || {};
  const autorise = typeof opts.autorise === 'function' ? opts.autorise : () => true;
  const seen = new Map();          // deck -> dernier trackId
  const vusSurLeReseau = new Set();// numeros de peripheriques reels
  let packets = 0;
  let announceTimer = null;
  let annSock = null;
  let sock = null;
  let cede = false;                // on a lache le port, volontairement
  let arrete = false;

  function surMessage(msg) {
    const st = parseStatus(msg);
    if (msg.length > 0x25 && isProlink(msg) && msg[10] === TYPE_KEEPALIVE) {
      /* On note les numeros deja pris : s'annoncer sur le numero d'un
         vrai lecteur brouillerait tout le reseau de la cabine. */
      vusSurLeReseau.add(msg[0x24]);
    }
    if (!st) return;
    packets++;
    if (cb.onRaw) cb.onRaw(st);
    vusSurLeReseau.add(st.device);
    const prev = seen.get(st.device);
    if (st.trackId && st.trackId !== prev) {
      seen.set(st.device, st.trackId);
      cb.onLoad(st);
    }
  }

  function lier() {
    if (arrete || sock) return;
    if (!autorise()) { cede = true; return; }
    cede = false;
    sock = ouvrirPartage();
    sock.on('message', surMessage);
    sock.on('error', e => {
      /* ------------------------------------------------------------
         Le port est deja pris. On ne reessaie pas en boucle et on ne
         s'accroche surtout pas : quelqu'un d'autre en a besoin.
         ------------------------------------------------------------ */
      liberer();
      cede = true;
      cb.onStatus({
        ok: false,
        msg: 'Pro DJ Link : le port ' + PORT_STATUS + ' est deja utilise (' + e.code + ')',
        conseil: CONSEIL_CEDE
      });
    });
    try {
      sock.bind({ port: PORT_STATUS, exclusive: false }, () => {
        try { sock.setBroadcast(true); } catch (e) {}
        cb.onStatus({ ok: true, msg: 'Pro DJ Link : ecoute sur ' + PORT_STATUS });
      });
    } catch (e) {
      liberer(); cede = true;
      cb.onStatus({ ok: false, msg: 'Pro DJ Link indisponible', conseil: CONSEIL_CEDE });
    }
    demarrerAnnonce();
  }

  /** Rend les ports, tout de suite, sans rien casser d'autre. */
  function liberer() {
    if (announceTimer) { clearInterval(announceTimer); announceTimer = null; }
    if (annSock) { try { annSock.close(); } catch (e) {} annSock = null; }
    if (sock) { try { sock.close(); } catch (e) {} sock = null; }
  }

  function demarrerAnnonce() {
    if (!opts.announce || annSock || !autorise()) return;
    /* Un numero libre, jamais celui d'un vrai lecteur. Les lecteurs
       occupent 1 a 4, les tables de mixage 33 : on se place au-dessus
       et on verifie quand meme. */
    let num = opts.deviceNumber || 0;
    if (!num || vusSurLeReseau.has(num)) {
      num = 7;
      while (num < 16 && vusSurLeReseau.has(num)) num++;
    }
    annSock = ouvrirPartage();
    annSock.on('error', () => { try { annSock.close(); } catch (e) {} annSock = null; });
    try {
      annSock.bind({ port: PORT_ANNOUNCE, exclusive: false }, () => {
        try { annSock.setBroadcast(true); } catch (e) {}
        const pkt = keepAlivePacket(num, 'Liaison');
        announceTimer = setInterval(() => {
          if (!autorise()) { liberer(); cede = true; return; }
          try { annSock.send(pkt, 0, pkt.length, PORT_ANNOUNCE, '255.255.255.255'); } catch (e) {}
        }, 1500);
      });
    } catch (e) { annSock = null; }
  }

  /* ------------------------------------------------------------
     La surveillance, deux fois par seconde.

     rekordbox peut demarrer a tout moment — typiquement quand le DJ
     branche ses platines, c'est-a-dire au pire moment. On verifie
     donc en continu, et on lache sans attendre qu'on nous le
     demande. Reprendre, a l'inverse, ne se fait que lorsque la voie
     est reellement libre.
     ------------------------------------------------------------ */
  const garde = setInterval(() => {
    if (arrete) return;
    const libre = autorise();
    if (!libre && sock) {
      liberer();
      cede = true;
      cb.onStatus({ ok: true, msg: 'Pro DJ Link : place laissee a rekordbox', conseil: CONSEIL_CEDE });
    } else if (libre && !sock && cede) {
      lier();
      if (sock) cb.onStatus({ ok: true, msg: 'Pro DJ Link : reseau repris' });
    }
  }, 500);

  lier();
  if (cede) {
    cb.onStatus({
      ok: true,
      msg: 'Pro DJ Link : rekordbox tient le reseau, Liaison n\'y touche pas',
      conseil: CONSEIL_CEDE
    });
  }

  /* ------------------------------------------------------------
     Le silence, explique.

     « Aucun paquet recu — verifie le reseau » envoyait le DJ
     verifier un cable qui n'existe pas. Pro DJ Link est un
     protocole diffuse par le MATERIEL : un CDJ, un XDJ, un DJM.
     rekordbox lance seul sur un portable n'emet rien, et n'a
     jamais rien emis — il n'y a donc rien a reparer.

     C'est le cas le plus frequent, et de loin : le DJ qui essaie
     Liaison chez lui est presque toujours devant rekordbox seul.
     Lui dire la verite, et lui donner la porte de sortie
     (declarer le morceau a la main, ce que Liaison fait en deux
     lettres), vaut mieux qu'un voyant rouge sans consigne.
     ------------------------------------------------------------ */
  const health = setInterval(() => {
    if (packets || cede) return;
    cb.onStatus({
      ok: false,
      msg: 'Pro DJ Link silencieux — aucun materiel sur le reseau',
      conseil: {
        cle: 'prolink-muet', quand: 'deck',
        titre: 'Aucun materiel sur le reseau',
        texte: 'Pro DJ Link n\'est diffuse que par un CDJ, un XDJ ou un DJM. ' +
               'rekordbox seul sur un portable n\'annonce rien : il n\'y a rien a reparer.',
        marche: [
          'Avec du materiel : branche-le en reseau et relance rekordbox',
          'Sans materiel : clique la loupe en haut et tape deux lettres du titre',
          'Liaison enchaine ensuite normalement'
        ],
        repli: 'Serato, Traktor et VirtualDJ sont detectes sans materiel, eux.'
      }
    });
  }, 15000);

  return {
    stop() {
      arrete = true;
      clearInterval(health);
      clearInterval(garde);
      liberer();
    },
    /* Rendre la main tout de suite, sur demande de l'application. */
    liberer() { liberer(); cede = true; },
    lie: () => !!sock,
    stats: () => ({ packets, cede: cede, lie: !!sock, decks: Array.from(seen.entries()) })
  };
}

module.exports = { start, parseStatus, isProlink, keepAlivePacket, MAGIC };
