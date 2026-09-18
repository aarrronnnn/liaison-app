'use strict';
/* ============================================================
   LES CLASSEMENTS DU MOMENT — ET POURQUOI ILS SONT DEHORS.

   Liaison ne sait rien du monde exterieur, par construction : la
   bibliotheque est locale, l'analyse est locale, le club n'a pas
   de wifi. Un classement, lui, vient forcement d'ailleurs. C'est
   la seule donnee de toute l'application qui n'est pas verifiable
   sur la machine du DJ.

   Trois regles en decoulent, et elles sont plus importantes que
   le code qui suit :

   1. AUCUN CLASSEMENT N'EST ECRIT EN DUR. Un « top 50 » code dans
      l'app est faux en trois semaines, et faux des le premier jour
      pour un DJ mariage. Sans fournisseur configure, ce module
      rend « non configure » et le panneau le dit. Il ne devine
      jamais.

   2. LE RESEAU N'EST JAMAIS BLOQUANT. Un appel qui echoue rend
      une liste vide avec sa raison. La preparation d'une soiree ne
      doit pas s'arreter parce qu'un serveur de classements est
      tombe.

   3. LE FOURNISSEUR EST INTERCHANGEABLE. On commence avec Last.fm
      parce que geo.getTopTracks donne le classement PAR PAYS — ce
      qui correspond au produit : un mariage a Lille et un club a
      Berlin n'ont pas le meme haut de classement. Deezer est la en
      second. Passer a un troisieme, c'est ajouter une entree dans
      FOURNISSEURS, pas refaire le panneau.

   ------------------------------------------------------------
   LAST.FM ET L'ACCORD COMMERCIAL — CE QU'IL NE FAUT PAS REFAIRE.

   Les conditions publiques de l'API Last.fm (www.last.fm/api/tos)
   disent : « You are permitted to use the Last.fm Data solely for
   non-commercial purposes », et un usage commercial sans accord
   prealable y constitue une violation substantielle. Liaison est
   une application vendue : sur le papier, elle tombe dedans.

   L'accord a ete demande a partners@last.fm et accorde
   (septembre 2026). La confirmation ecrite est a conserver : elle
   est la seule chose qui distingue cette integration d'une
   violation, et une cle revoquee, c'est la fonction qui tombe
   chez tous les clients le meme jour.

   Ne PAS retirer cette note en croyant qu'elle est obsolete, et
   ne pas rouvrir le sujet : la question a ete posee et tranchee.
   Si l'accord venait a etre resilie, il suffit de vider la cle
   dans les reglages — le module rend alors « sans-cle » et le
   panneau le dit proprement, sans rien inventer.
   ============================================================ */

const https = require('https');
/* maj.js choisit deja son module d'apres le schema de l'adresse :
   on fait pareil ici plutot que d'inventer une seconde convention.
   En production tout est en https ; le http ne sert qu'a monter un
   faux relais en local pour les essais. */
const http = require('http');

/* ============================================================
   LA CLE EST CELLE DE L'APPLICATION, PAS CELLE DU DJ.

   Premiere version : un champ « colle ta cle Last.fm » dans les
   reglages. C'etait une erreur de conception. L'accord commercial
   est au nom de Liaison, pas au nom de chaque DJ : demander a un
   DJ de creer un compte developpeur pour voir un classement, ce
   serait lui refiler une demarche qui ne le concerne pas, et
   quatre-vingt-dix-neuf pour cent d'entre eux ne le feraient
   jamais. La fonction serait morte a la livraison.

   La cle est donc posee ici, une fois, a la construction.

   Elle se remplit de trois facons, dans cet ordre :
     1. la variable d'environnement LIAISON_LASTFM_CLE, au moment
        de construire les binaires — c'est la bonne facon, elle
        evite que la cle vive dans l'historique de git ;
     2. la constante ci-dessous, pour un essai en local ;
     3. config.chartsCle, qui reste lisible pour depanner une
        machine precise sans reconstruire l'application.

   Vide, tout reste eteint et le panneau le dit. Liaison n'invente
   jamais un classement — voir plus bas.

   Une cle d'API dans une application de bureau est extractible,
   c'est vrai de toutes les applications de bureau du monde. Le
   garde-fou n'est pas le secret, c'est le quota et l'accord.
   ============================================================ */
/* ------------------------------------------------------------
   LA CLE N'EST PLUS ICI DU TOUT — ELLE EST SUR VERCEL.

   Cette application ne porte plus aucune cle Last.fm. Elle parle
   au relais liaisondj.app/api/classements, qui garde la cle comme
   Vercel garde deja la cle Stripe et la cle de signature des
   licences (voir SECRETS.md).

   Ce qui suit ne sert plus qu'au DEPANNAGE : pouvoir appeler
   Last.fm directement, depuis une machine de developpement, sans
   passer par le relais. Les binaires livres n'ont pas de cle et
   n'en ont pas besoin.

   OU LA CLE VIVAIT AVANT, ET POURQUOI PAS ICI.

   Ce depot est PUBLIC (voir SECRETS.md) : il sert a construire le
   .dmg et le .exe sur les serveurs de GitHub. Une cle ecrite en
   clair dans ce fichier serait lisible par n'importe qui, a la
   seconde du push, et Last.fm la revoquerait — a juste titre.

   Elle vit donc dans src/cle-construction.js, qui n'est PAS suivi
   par git (.gitignore) et qui est fabrique au moment de la
   construction a partir du secret de depot LIAISON_LASTFM_CLE.
   En local, le fichier est ecrit une fois a la main.

   Absent, on continue sans : le module rend « sans-cle » et le
   panneau le dit. Aucune construction n'echoue parce qu'il manque
   une cle de classement — une fonction de confort ne doit jamais
   empecher de livrer l'application.
   ------------------------------------------------------------ */
let CLE_CONSTRUCTION = {};
try { CLE_CONSTRUCTION = require('./cle-construction'); } catch (e) { CLE_CONSTRUCTION = {}; }

function cleLastfm(config) {
  return process.env.LIAISON_LASTFM_CLE
      || CLE_CONSTRUCTION.lastfm
      || (config && config.cle)
      || '';
}

/* Une seule facon d'aller chercher du JSON, avec un delai court :
   au-dela de six secondes, le DJ a deja referme la fenetre. */
function lireJSON(url, timeoutMs) {
  return new Promise(resolve => {
    let fini = false;
    const fin = v => { if (!fini) { fini = true; resolve(v); } };
    let req;
    try {
      const mod = url.startsWith('http://') ? http : https;
      req = mod.get(url, { headers: { 'User-Agent': 'Liaison/1.5 (+https://liaisondj.app)' } }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fin(lireJSON(res.headers.location, timeoutMs));
        }
        if (res.statusCode !== 200) { res.resume(); return fin(null); }
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', c => { buf += c; if (buf.length > 800000) { req.destroy(); fin(null); } });
        res.on('end', () => { try { fin(JSON.parse(buf)); } catch (e) { fin(null); } });
      });
    } catch (e) { return fin(null); }
    req.on('error', () => fin(null));
    req.setTimeout(timeoutMs || 6000, () => { req.destroy(); fin(null); });
  });
}

/* ------------------------------------------------------------
   Les pays, du code interne de Liaison vers ce qu'attend chaque
   fournisseur. Last.fm veut un NOM de pays au sens ISO 3166-1
   (« France »), Deezer veut un identifiant de classement.
   ------------------------------------------------------------ */
const PAYS_LASTFM = {
  fr: 'France', be: 'Belgium', ch: 'Switzerland', ca: 'Canada',
  it: 'Italy', es: 'Spain', de: 'Germany', uk: 'United Kingdom',
  gb: 'United Kingdom', us: 'United States', nl: 'Netherlands',
  pt: 'Portugal', ma: 'Morocco', dz: 'Algeria', tn: 'Tunisia',
  lu: 'Luxembourg', ie: 'Ireland', at: 'Austria', pl: 'Poland',
  se: 'Sweden', no: 'Norway', dk: 'Denmark', fi: 'Finland',
  gr: 'Greece', tr: 'Turkey', ro: 'Romania', cz: 'Czech Republic',
  br: 'Brazil', mx: 'Mexico', ar: 'Argentina', co: 'Colombia',
  au: 'Australia', nz: 'New Zealand', jp: 'Japan', kr: 'South Korea',
  za: 'South Africa', ng: 'Nigeria', ci: 'Ivory Coast', sn: 'Senegal'
};

/* ------------------------------------------------------------
   La liste pour un menu deroulant.

   Le DJ ne joue pas toujours dans le pays ou il vit : une date a
   Bruxelles, une saison a Ibiza, une croisiere. Le classement
   suit donc le contexte de la soiree PAR DEFAUT, mais il doit
   pouvoir etre force — c'est une information sur la salle, et la
   salle change d'adresse.

   Ordonnee par nom, pour qu'on trouve « Belgium » sans lire les
   quarante entrees. Le doublon uk/gb ne sort qu'une fois.
   ------------------------------------------------------------ */
function listePays() {
  const vus = new Set();
  const out = [];
  for (const code of Object.keys(PAYS_LASTFM)) {
    const nom = PAYS_LASTFM[code];
    if (vus.has(nom)) continue;
    vus.add(nom);
    out.push({ code: code, nom: nom });
  }
  out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  return out;
}

function paysDe(pack) {
  /* le pack s'ecrit « fr-mariage » : le pays est avant le tiret */
  const p = String(pack || '').split('-')[0].toLowerCase();
  return p || 'fr';
}

const FOURNISSEURS = {
  /* --------------------------------------------------------
     LIAISON — le relais, et le fournisseur par defaut.

     L'application n'appelle plus Last.fm elle-meme : elle demande
     a liaisondj.app, qui garde la cle et qui met le resultat en
     cache pour tout le monde. Quatre choses qu'on y gagne, et
     aucune qu'on y perd :

       — la cle ne quitte jamais Vercel, donc elle n'est pas
         extractible d'un .dmg ;
       — elle se change en une variable d'environnement, sans
         reconstruire ni republier l'application ;
       — mille DJ qui ouvrent la rubrique font UN appel a Last.fm
         par pays et par trois heures, pas mille ;
       — l'attribution voyage avec la donnee.

     Ce qui part d'ici : un code pays sur deux lettres. Rien
     d'autre. Pas de bibliotheque, pas de titre, pas
     d'identifiant. La promesse « tout reste sur ta machine »
     tient : ce relais ne peut pas savoir ce que le DJ possede ni
     ce qu'il joue.
     -------------------------------------------------------- */
  liaison: {
    nom: 'Liaison',
    besoinCle: false,
    async charger(opt) {
      /* Un code inconnu est ramene au pays du contexte AVANT de
         partir : sinon le relais repond 400, l'appel echoue, et le
         panneau annonce « service injoignable » alors que le
         service va tres bien — c'est le pays qui n'existe pas. Un
         message faux coute plus cher qu'un pays approximatif. */
      let code = String(opt.pays || '').toLowerCase();
      if (!PAYS_LASTFM[code]) code = paysDe(opt.pack) || 'fr';
      if (!PAYS_LASTFM[code]) code = 'fr';
      const base = process.env.LIAISON_CLASSEMENTS || 'https://liaisondj.app/api/classements';
      const j = await lireJSON(base + '?pays=' + encodeURIComponent(code), opt.timeout);
      if (!j) return { etat: 'injoignable', titres: [] };
      if (j.etat !== 'ok') return { etat: j.etat || 'muet', titres: [], note: j.note || '' };
      return {
        etat: 'ok',
        source: (j.credit && j.credit.nom) || j.source || 'Last.fm',
        zone: j.zone || PAYS_LASTFM[code] || '',
        credit: j.credit || null,
        titres: (j.titres || []).slice(0, Math.min(100, Math.max(10, opt.limite || 50)))
      };
    }
  },

  /* --------------------------------------------------------
     Last.fm — geo.getTopTracks.

     Le classement par pays, qui est le seul qui ait du sens ici.
     Une cle suffit, il n'y a pas d'OAuth. Voir l'avertissement en
     tete de fichier avant d'activer.
     -------------------------------------------------------- */
  lastfm: {
    nom: 'Last.fm',
    besoinCle: true,
    async charger(opt) {
      /* Le pays choisi a la main gagne sur celui du contexte : une
         date a Bruxelles se prepare avec le classement belge, meme
         si le pack de la soiree dit « fr-mariage ». */
      const code = (opt.pays || paysDe(opt.pack) || 'fr').toLowerCase();
      const pays = PAYS_LASTFM[code] || PAYS_LASTFM[paysDe(opt.pack)] || 'France';
      const url = 'https://ws.audioscrobbler.com/2.0/?method=geo.gettoptracks'
        + '&country=' + encodeURIComponent(pays)
        + '&limit=' + Math.min(100, Math.max(10, opt.limite || 50))
        + '&api_key=' + encodeURIComponent(opt.cle)
        + '&format=json';
      const j = await lireJSON(url, opt.timeout);
      /* Last.fm signale ses refus DANS une reponse 200 : cle
         invalide, quota depasse, service suspendu. Les traiter
         comme un simple echec reseau ferait chercher une panne de
         wifi la ou c'est la cle qui est morte. */
      if (j && j.error) return { etat: 'refus', note: String(j.message || 'refus du service'), titres: [] };
      const l = j && j.tracks && j.tracks.track;
      if (!Array.isArray(l)) return { etat: 'muet', titres: [] };
      return {
        etat: 'ok', source: 'Last.fm', zone: pays,
        titres: l.map((t, i) => ({
          rang: i + 1,
          artist: (t.artist && t.artist.name) || '',
          title: t.name || '',
          url: t.url || ''
        })).filter(t => t.title)
      };
    }
  },

  /* --------------------------------------------------------
     Deezer — /chart/{id}/tracks.

     Pas de cle du tout sur les points publics. Le classement est
     mondial : moins fin que Last.fm, mais il repond meme sans
     rien configurer. C'est le repli, pas le defaut.
     -------------------------------------------------------- */
  deezer: {
    nom: 'Deezer',
    besoinCle: false,
    async charger(opt) {
      const url = 'https://api.deezer.com/chart/0/tracks?limit='
        + Math.min(100, Math.max(10, opt.limite || 50));
      const j = await lireJSON(url, opt.timeout);
      if (j && j.error) return { etat: 'refus', note: 'refus du service', titres: [] };
      const l = j && j.data;
      if (!Array.isArray(l)) return { etat: 'muet', titres: [] };
      return {
        etat: 'ok', source: 'Deezer', zone: 'monde',
        titres: l.map((t, i) => ({
          rang: i + 1,
          artist: (t.artist && t.artist.name) || '',
          title: t.title_short || t.title || '',
          url: t.link || ''
        })).filter(t => t.title)
      };
    }
  }
};

/* ------------------------------------------------------------
   Le point d'entree unique.

   Il rend TOUJOURS un objet de la meme forme, y compris quand il
   n'y a rien a rendre : le panneau n'a jamais a deviner si le
   silence vient d'une absence de reglage, d'une panne de reseau
   ou d'une cle refusee. Chaque cas a son etat et sa phrase.
   ------------------------------------------------------------ */
async function charger(opt) {
  const o = opt || {};
  const nom = String(o.fournisseur || '').toLowerCase();
  if (!nom || nom === 'aucun')
    return { etat: 'non-configure', titres: [],
             note: 'Aucun fournisseur de classements n\'est configure.' };

  const f = FOURNISSEURS[nom];
  if (!f) return { etat: 'non-configure', titres: [],
                   note: 'Fournisseur inconnu : ' + nom };

  /* La cle vient de l'application (variable d'environnement posee a
     la construction, ou constante), pas du DJ. config.chartsCle ne
     sert plus que de depannage. */
  const cle = cleLastfm(o);
  if (f.besoinCle && !cle)
    return { etat: 'sans-cle', titres: [], fournisseur: f.nom,
             note: 'Cette version a ete construite sans cle ' + f.nom + '.' };

  try {
    const r = await f.charger(Object.assign({ limite: 50, timeout: 6000 }, o, { cle: cle }));
    if (!r || r.etat !== 'ok')
      return Object.assign({ etat: 'muet', titres: [], fournisseur: f.nom,
        note: 'Pas de reponse utilisable de ' + f.nom + '.' }, r || {});
    return Object.assign({ fournisseur: f.nom }, r);
  } catch (e) {
    /* Une panne de reseau n'est pas une erreur du DJ : on le dit
       et on rend la main. La preparation continue sans. */
    return { etat: 'injoignable', titres: [], fournisseur: f.nom,
             note: f.nom + ' est injoignable. Verifie ta connexion.' };
  }
}

module.exports = { charger, FOURNISSEURS, PAYS_LASTFM, listePays, paysDe, cleLastfm, _lireJSON: lireJSON };
