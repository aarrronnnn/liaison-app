'use strict';
/* ============================================================
   UNE LICENCE PAYEE NE DOIT PAS TOMBER PARCE QUE LE WI-FI EST COUPE.

   L'identifiant de machine envoye au serveur melange la premiere
   adresse MAC, le nom de la machine et l'utilisateur. Or en cabine :
   — beaucoup de DJ coupent le Wi-Fi (plus de notifications, moins
     de latence) : l'interface disparait, la MAC avec ;
   — macOS peut donner une adresse MAC privee par reseau ;
   — le nom de la machine change selon le DHCP du club.
   Jusqu'en 1.5.1, chacun de ces cas faisait lire la licence comme
   « celle d'une autre machine » : essai termine, en plein set.

   Ce banc eprouve l'identifiant fige. Il porte la meme regle que
   le banc de rotation : chaque cas est ecrit du point de vue du
   degat — un client qui a paye et qui se retrouve verrouille.
   ============================================================ */
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-machine-'));
const MAISON = path.join(racine, 'maison');
fs.mkdirSync(MAISON, { recursive: true });
os.homedir = () => MAISON;

/* Le reseau, sous notre controle. */
let wifi = true, nom = 'Studio-Mac';
const vraiesInterfaces = os.networkInterfaces;
os.networkInterfaces = () => wifi
  ? { lo0: [{ internal: true, mac: '00:00:00:00:00:00' }],
      en0: [{ internal: false, mac: 'a4:83:e7:11:22:33' }] }
  : { lo0: [{ internal: true, mac: '00:00:00:00:00:00' }] };
os.hostname = () => nom;

const lic = require('../src/license.js');
const { License, deviceId, CLES_PUBLIQUES } = lic;

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(62) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
for (const k of Object.keys(CLES_PUBLIQUES)) delete CLES_PUBLIQUES[k];
CLES_PUBLIQUES['1'] = publicKey.export({ type: 'spki', format: 'pem' }).trim();
function signer(charge) {
  const body = Buffer.from(JSON.stringify(charge), 'utf8');
  return body.toString('base64url') + '.' + crypto.sign(null, body, privateKey).toString('base64url');
}
const licencePour = (device, extra) => signer(Object.assign({
  key: 'LSN-TEST', plan: 'resident', seats: 2, device: device, status: 'active',
  until: Date.now() + 9e8, exp: Date.now() + 9e8, iat: Date.now() }, extra || {}));

console.log('licence et identifiant de machine\n');

/* ---------- 1. un client de 1.5.1 met a jour, Wi-Fi allume ---------- */
const DOSSIER = path.join(racine, 'app');
fs.mkdirSync(DOSSIER, { recursive: true });
const FICHIER = path.join(DOSSIER, 'license.json');
wifi = true; nom = 'Studio-Mac';
const ID_ACTIVATION = deviceId();
fs.writeFileSync(FICHIER, JSON.stringify({ key: 'LSN-TEST', license: licencePour(ID_ACTIVATION),
                                          trialStart: Date.now() - 40 * 864e5 }));
{
  const l = new License(FICHIER);
  verifier('mise a jour : la licence existante reste valide', l.tier() === 'resident', l.tier());
  verifier('l\'identifiant du serveur est garde tel quel', l.device === ID_ACTIVATION);
  const st = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  verifier('il est fige dans l\'etat', st.device === ID_ACTIVATION);
}

/* ---------- 2. le soir meme : Wi-Fi coupe en cabine ---------- */
wifi = false;
verifier('(le calcul brut change bien sans Wi-Fi — le piege existe)', deviceId() !== ID_ACTIVATION);
{
  const l = new License(FICHIER);
  verifier('Wi-Fi coupe, app relancee : toujours Resident', l.tier() === 'resident', l.tier());
  verifier('et c\'est cet identifiant qui part au serveur', l.device === ID_ACTIVATION);
}
{
  /* Wi-Fi coupe PENDANT que l'app tourne : tier() est relu a chaque suggestion. */
  wifi = true;
  const l = new License(FICHIER);
  wifi = false;
  verifier('Wi-Fi coupe en plein set : toujours Resident', l.tier() === 'resident', l.tier());
}

/* ---------- 3. le nom de la machine change (DHCP du club) ---------- */
wifi = true; nom = 'dhcp-10-0-0-42';
{
  const l = new License(FICHIER);
  verifier('nom de machine change : toujours Resident', l.tier() === 'resident', l.tier());
}
nom = 'Studio-Mac';

/* ---------- 4. mise a jour lancee pour la premiere fois SANS Wi-Fi ---------- */
{
  const f = path.join(racine, 'app2', 'license.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  wifi = true; const idAvant = deviceId();
  fs.writeFileSync(f, JSON.stringify({ key: 'LSN-TEST', license: licencePour(idAvant) }));
  wifi = false;
  const l = new License(f);
  verifier('1er lancement de la mise a jour hors Wi-Fi : Resident', l.tier() === 'resident', l.tier());
  verifier('identifiant repris de la licence signee', l.device === idAvant);
}

/* ---------- 5. le fichier copie sur une AUTRE machine ne suffit pas ---------- */
{
  const f = path.join(racine, 'app3', 'license.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const st = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
  if (st.hw) {
    st.hw = 'f'.repeat(32);                 /* l'empreinte d'une autre carte mere */
    fs.writeFileSync(f, JSON.stringify(st));
    wifi = true; nom = 'Autre-Mac';
    const l = new License(f);
    verifier('fichier copie sur une autre machine : refuse', l.tier() !== 'resident', l.tier());
    nom = 'Studio-Mac';
  } else {
    console.log('  (empreinte materielle illisible ici — cas de copie non joue)');
  }
}

/* ---------- 6. horloge partie en 2030 une fois, puis revenue ---------- */
{
  const f = path.join(racine, 'app4', 'license.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  wifi = true;
  const id = deviceId();
  fs.writeFileSync(f, JSON.stringify({ key: 'LSN-TEST', license: licencePour(id),
                                      device: id, vuMax: Date.UTC(2030, 0, 1) }));
  const l = new License(f);
  verifier('(horloge vue en 2030 : la licence en cache est bloquee)', l.tier() !== 'resident');
  /* Le serveur repond avec une licence fraiche, datee de maintenant. */
  const frais = licencePour(id);
  /* on rejoue la reponse 200 de /api/validate, sans reseau */
  return (async () => {
    const orig = require('https').request;
    require('https').request = (u, o, cb) => { cb = cb || o;
      const { EventEmitter } = require('events');
      const res = new EventEmitter(); res.statusCode = 200; res.setEncoding = () => {};
      const req = new EventEmitter();
      req.setTimeout = () => {}; req.write = () => {}; req.destroy = () => {};
      req.end = () => { cb(res); res.emit('data', Buffer.from(JSON.stringify({ license: frais }))); res.emit('end'); };
      return req;
    };
    await l.refresh(true);
    require('https').request = orig;
    verifier('revalidation en ligne : l\'horloge est ramenee, Resident', l.tier() === 'resident', l.tier());

    os.networkInterfaces = vraiesInterfaces;
    fs.rmSync(racine, { recursive: true, force: true });
    console.log('\n' + (ko ? ko + ' RATE(S)' : 'machine : Wi-Fi coupe, nom change, horloge folle — la licence tient.'));
    process.exit(ko ? 1 : 0);
  })();
}
