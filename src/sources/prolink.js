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

/**
 * @param opts { announce:boolean, deviceNumber:number, debug:boolean }
 * @param cb   { onLoad(state), onStatus(s), onRaw(state) }
 */
function start(opts, cb) {
  opts = opts || {};
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const seen = new Map();          // deck -> dernier trackId
  let packets = 0;
  let announceTimer = null;
  let annSock = null;

  sock.on('error', e => cb.onStatus({ ok: false, msg: 'Pro DJ Link : ' + e.code + ' (port ' + PORT_STATUS + ' occupe ?)' }));

  sock.on('message', msg => {
    const st = parseStatus(msg);
    if (!st) return;
    packets++;
    if (cb.onRaw) cb.onRaw(st);
    const prev = seen.get(st.device);
    if (st.trackId && st.trackId !== prev) {
      seen.set(st.device, st.trackId);
      cb.onLoad(st);
    }
  });

  sock.bind(PORT_STATUS, () => {
    try { sock.setBroadcast(true); } catch (e) {}
    cb.onStatus({ ok: true, msg: 'Pro DJ Link : ecoute sur ' + PORT_STATUS });
  });

  if (opts.announce) {
    annSock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    annSock.bind(PORT_ANNOUNCE, () => {
      try { annSock.setBroadcast(true); } catch (e) {}
      const pkt = keepAlivePacket(opts.deviceNumber || 4, 'Liaison');
      announceTimer = setInterval(() => {
        try { annSock.send(pkt, 0, pkt.length, PORT_ANNOUNCE, '255.255.255.255'); } catch (e) {}
      }, 1500);
    });
    annSock.on('error', () => {});
  }

  const health = setInterval(() => {
    if (!packets) cb.onStatus({ ok: false, msg: 'Aucun paquet cabine recu — verifie le reseau Pro DJ Link' });
  }, 15000);

  return {
    stop() {
      clearInterval(health);
      if (announceTimer) clearInterval(announceTimer);
      try { sock.close(); } catch (e) {}
      if (annSock) try { annSock.close(); } catch (e) {}
    },
    stats: () => ({ packets, decks: Array.from(seen.entries()) })
  };
}

module.exports = { start, parseStatus, isProlink, keepAlivePacket, MAGIC };
