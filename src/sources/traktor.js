'use strict';
/* ============================================================
   TRAKTOR PRO — LE TITRE EST DANS LE FLUX.

   Dans Traktor : Preferences > Broadcasting
     Address 127.0.0.1  Port 8000  Mount /liaison  Format Ogg Vorbis
   puis le bouton de diffusion. Traktor se connecte alors a Liaison
   comme a un serveur Icecast et lui envoie son mix en Ogg Vorbis.

   L'ancienne version attendait le titre sur /admin/metadata et
   JETAIT le flux audio. Or Traktor n'appelle jamais cette adresse :
   c'est le canal des flux MP3. En Ogg, le titre voyage DANS le
   flux, sous forme de « commentaires Vorbis » (ARTIST=, TITLE=),
   et Traktor en renvoie un jeu neuf a chaque changement de
   morceau, en ouvrant un nouveau flux logique. C'est ainsi que le
   lisent les outils qui marchent (traktor-nowplaying, Now
   Playing). Pire : la reponse « OK » suivie d'une fermeture coupait
   la connexion — Traktor voyait un serveur qui raccroche.
   Resultat : aucun titre, jamais (audit du 6 octobre 2026).

   On garde donc la connexion ouverte, on decoupe les pages Ogg,
   on reassemble les paquets, et on lit les commentaires. Le son
   lui-meme n'est jamais decode ni garde : seuls les en-tetes
   comptent, quelques centaines d'octets par morceau.

   /admin/metadata reste servi, pour les logiciels qui diffusent
   en MP3 et passent par la.
   ============================================================ */
const net = require('net');

/* ------------------------------------------------------------
   Les pages Ogg, puis les paquets.

   Une page : « OggS », version, drapeaux (1 = suite d'un paquet,
   2 = debut d'un flux logique), position, numero de flux, numero
   de page, CRC, puis la table des segments. Un paquet se termine
   sur le premier segment de moins de 255 octets ; il peut donc
   courir sur plusieurs pages. Les octets arrivent comme le reseau
   les donne : une page peut etre coupee n'importe ou.
   ------------------------------------------------------------ */
function lecteurOgg(surPaquet, opt) {
  const plafond = (opt && opt.plafond) || 256 * 1024;
  let tampon = Buffer.alloc(0);
  const enCours = new Map();          /* flux -> paquet commence */

  function pousser(morceau) {
    tampon = tampon.length ? Buffer.concat([tampon, morceau]) : Buffer.from(morceau);
    for (;;) {
      if (tampon.length < 27) return;
      if (tampon.toString('latin1', 0, 4) !== 'OggS') {
        /* Pris en route, ou un octet perdu : on se recale sur la
           prochaine page. On garde trois octets au cas ou « OggS »
           serait coupe a la frontiere. */
        const i = tampon.indexOf('OggS', 1, 'latin1');
        if (i < 0) { tampon = tampon.subarray(Math.max(0, tampon.length - 3)); return; }
        tampon = tampon.subarray(i);
        continue;
      }
      const nseg = tampon[26];
      if (tampon.length < 27 + nseg) return;
      let corps = 0;
      for (let k = 0; k < nseg; k++) corps += tampon[27 + k];
      const total = 27 + nseg + corps;
      if (tampon.length < total) return;

      const drapeaux = tampon[5];
      const flux = tampon.readUInt32LE(14);
      if (drapeaux & 0x02) enCours.delete(flux);           /* nouveau flux logique */
      let e = enCours.get(flux) || null;
      /* Une page qui ne se dit pas « suite » ferme ce qui trainait. */
      if (!(drapeaux & 0x01) && e) { enCours.delete(flux); e = null; }
      /* Une « suite » dont on n'a pas vu le debut : on saute ce
         premier paquet, il est incomplet. */
      let sauter = !!(drapeaux & 0x01) && !e;
      let pos = 27 + nseg;
      for (let k = 0; k < nseg; k++) {
        const l = tampon[27 + k];
        const seg = tampon.subarray(pos, pos + l);
        pos += l;
        if (sauter) { if (l < 255) sauter = false; continue; }
        if (!e) { e = { morceaux: [], taille: 0, perdu: false }; enCours.set(flux, e); }
        if (!e.perdu) {
          if (e.taille + l > plafond) { e.perdu = true; e.morceaux = []; e.taille = 0; }
          else { e.morceaux.push(Buffer.from(seg)); e.taille += l; }
        }
        if (l < 255) {
          if (!e.perdu) { try { surPaquet(Buffer.concat(e.morceaux, e.taille), flux); } catch (x) {} }
          enCours.delete(flux);
          e = null;
        }
      }
      tampon = tampon.subarray(total);
    }
  }
  return { pousser };
}

/* ------------------------------------------------------------
   Les commentaires d'un paquet d'en-tete Vorbis (« \x03vorbis »)
   ou Opus (« OpusTags »). Petit-boutiste : longueur du fournisseur,
   fournisseur, nombre de champs, puis chaque champ « CLE=valeur »
   en UTF-8. Tout est borne : un flux abime ne fait rien lire de
   travers ni planter.
   ------------------------------------------------------------ */
function commentaires(p) {
  let i = -1;
  if (p.length >= 7 && p[0] === 3 && p.toString('latin1', 1, 7) === 'vorbis') i = 7;
  else if (p.length >= 8 && p.toString('latin1', 0, 8) === 'OpusTags') i = 8;
  if (i < 0) return null;
  if (i + 4 > p.length) return null;
  const vendeur = p.readUInt32LE(i);
  i += 4;
  if (vendeur > p.length - i) return null;
  i += vendeur;
  if (i + 4 > p.length) return null;
  let n = p.readUInt32LE(i);
  i += 4;
  if (n > 1000) return null;
  const out = {};
  while (n-- > 0) {
    if (i + 4 > p.length) break;
    const l = p.readUInt32LE(i);
    i += 4;
    if (l > p.length - i) break;
    const champ = p.toString('utf8', i, i + l);
    i += l;
    const eg = champ.indexOf('=');
    if (eg <= 0) continue;
    const cle = champ.slice(0, eg).toUpperCase();
    if (!(cle in out)) out[cle] = champ.slice(eg + 1).trim();
  }
  return out;
}

/* Le texte qu'on passe au rapprochement, comme les autres sources. */
function texteDe(c) {
  const titre = (c && c.TITLE) || '';
  const artiste = (c && c.ARTIST) || '';
  if (!titre) return '';
  return artiste ? artiste + ' - ' + titre : titre;
}

function start(opts, cb) {
  const port = opts.port || 8000;
  const prises = new Set();
  let diffusions = 0;
  let dernier = '';
  const enEcoute = () => cb.onStatus({ ok: true, msg: 'En écoute sur 127.0.0.1:' + port + ' (mount /liaison)' });

  const annoncer = texte => {
    if (!texte || texte === dernier) return;
    dernier = texte;
    cb.onText(texte, {});
  };

  const server = net.createServer(prise => {
    prises.add(prise);
    let tete = Buffer.alloc(0);
    let lecteur = null;

    prise.on('data', morceau => {
      if (lecteur) { lecteur.pousser(morceau); return; }
      tete = Buffer.concat([tete, morceau]);
      const fin = tete.indexOf('\r\n\r\n');
      if (fin < 0) { if (tete.length > 16384) prise.destroy(); return; }
      const lignes = tete.toString('latin1', 0, fin).split('\r\n');
      const morceaux = lignes[0].split(' ');
      const methode = String(morceaux[0] || '').toUpperCase();
      const cible = morceaux[1] || '';
      const reste = tete.subarray(fin + 4);
      tete = Buffer.alloc(0);

      if (methode === 'GET' && cible.indexOf('/admin/metadata') === 0) {
        let song = '';
        try { song = new URL(cible, 'http://127.0.0.1').searchParams.get('song') || ''; } catch (e) {}
        if (song) annoncer(song);
        prise.end('HTTP/1.0 200 OK\r\nContent-Type: text/xml\r\n\r\n' +
          '<?xml version="1.0"?><iceresponse><message>ok</message><return>1</return></iceresponse>');
        return;
      }

      if (methode === 'SOURCE' || methode === 'PUT') {
        /* Un client qui demande « 100-continue » attend ce feu vert
           avant d'envoyer le son ; Traktor, lui, attend un 200. */
        const attend = lignes.some(l => /^expect:\s*100-continue/i.test(l));
        prise.write(attend ? 'HTTP/1.1 100 Continue\r\n\r\n'
                           : 'HTTP/1.0 200 OK\r\nServer: Icecast 2.4.4\r\n\r\n');
        lecteur = lecteurOgg(p => annoncer(texteDe(commentaires(p))));
        diffusions++;
        cb.onStatus({ ok: true, msg: 'Traktor diffuse : Liaison lit les titres' });
        if (reste.length) lecteur.pousser(reste);
        return;
      }

      prise.end('HTTP/1.0 404 Not Found\r\n\r\n');
    });

    prise.on('close', () => {
      prises.delete(prise);
      if (lecteur) {
        lecteur = null;
        diffusions = Math.max(0, diffusions - 1);
        if (!diffusions) enEcoute();
      }
    });
    prise.on('error', () => {});
  });

  server.on('error', e => cb.onStatus({ ok: false, msg: 'Port ' + port + ' occupé : ' + e.code }));
  server.listen(port, '127.0.0.1', enEcoute);
  return {
    /* Fermer le serveur ne suffit pas : une diffusion ouverte le
       garderait en vie, et le port avec. */
    stop: () => {
      try { server.close(); } catch (e) {}
      for (const p of prises) { try { p.destroy(); } catch (e) {} }
      prises.clear();
    }
  };
}

module.exports = { start, lecteurOgg, commentaires, texteDe };
