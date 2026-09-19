'use strict';
/* ============================================================
   PEUT-ON CHANGER LA CLE DE SIGNATURE SANS COUPER PERSONNE ?

   Une licence est signee par une cle privee qui vit sur le
   serveur ; l'application porte la cle publique et verifie.
   Tant qu'il n'y en avait qu'une, sans nom, changer la cle
   revenait a invalider TOUTES les licences deja vendues d'un
   seul coup. La cle ne pouvait donc jamais tourner.

   Ce fichier eprouve le mecanisme qui ouvre cette impasse, et il
   porte une responsabilite particuliere : un faux negatif ici,
   c'est un client qui a paye et qui se retrouve verrouille en
   cabine un samedi soir. Les cas sont donc ecrits du point de
   vue du DEGAT, pas de la fonctionnalite.

   Le cas le plus important est le premier : les licences deja en
   circulation n'ont AUCUN numero de cle — elles ont ete signees
   avant que ce champ existe. Si celui-la tombe, la mise a jour
   coupe tout le parc actuel.
   ============================================================ */
const crypto = require('crypto');
const os = require('os');

/* La verification lit l'identifiant de MACHINE : on force donc
   os.hostname() et consorts a une valeur stable, puis on demande
   a license.js l'identifiant qu'il en deduit. */
const lic = require('../src/license.js');
const { verify, deviceId, CLES_PUBLIQUES, CLE_PAR_DEFAUT } = lic;
const MOI = deviceId();

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(58) + (ok || !detail ? '' : '  — ' + detail));
  if (!ko && !ok) { /* on garde le premier detail */ }
  if (!ok) ko++;
}

/* ------------------------------------------------------------
   La cle 1 EST celle de production : on ne l'a pas en prive ici,
   et c'est tres bien ainsi — un essai qui embarquerait la cle
   privee de production serait le pire fichier du depot.

   On fabrique donc deux paires jetables, et on remplace le
   tableau des cles publiques de license.js par les leurs, le
   temps de l'essai. Le MECANISME est ce qu'on eprouve ; la
   valeur exacte des cles ne change rien a sa justesse.
   ------------------------------------------------------------ */
function paire() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }).trim(),
    priv: privateKey
  };
}
const UNE = paire();
const DEUX = paire();
const TROIS = paire();          /* jamais declaree a l'application */

/* On substitue, sans toucher au fichier. */
for (const k of Object.keys(CLES_PUBLIQUES)) delete CLES_PUBLIQUES[k];
CLES_PUBLIQUES['1'] = UNE.pub;

function signer(charge, priv) {
  const body = Buffer.from(JSON.stringify(charge), 'utf8');
  const sig = crypto.sign(null, body, priv);
  return body.toString('base64url') + '.' + sig.toString('base64url');
}
const licence = (extra, priv) => signer(Object.assign(
  { key: 'LSN-TEST', plan: 'resident', seats: 2, device: MOI,
    status: 'active', until: Date.now() + 9e8, exp: Date.now() + 9e8, iat: Date.now() },
  extra), priv);

console.log('rotation de la cle de signature\n');

/* ---------- 1. LE PARC ACTUEL ---------- */
/* Les licences en circulation n'ont pas de champ kid. Elles
   doivent continuer de se verifier, sinon la mise a jour
   verrouille tous les clients existants. */
{
  const t = licence({}, UNE.priv);
  const p = verify(t);
  verifier('une licence SANS numero reste valide (le parc actuel)', !!p, 'refusee');
  verifier('et elle rend bien son plan', p && p.plan === 'resident', p && p.plan);
}

/* ---------- 2. LES NOUVELLES ---------- */
{
  const p = verify(licence({ kid: '1' }, UNE.priv));
  verifier('une licence numerotee 1 est valide', !!p);
}

/* ---------- 3. LA ROTATION ---------- */
/* Avant que l'application connaisse la cle 2, une licence signee
   par la cle 2 doit etre REFUSEE : c'est ce qui rend l'ordre des
   etapes obligatoire (publier l'app d'abord, basculer ensuite). */
{
  const t = licence({ kid: '2' }, DEUX.priv);
  verifier('cle 2 inconnue de cette version : refusee', verify(t) === null);

  /* On publie la version qui connait la cle 2. */
  CLES_PUBLIQUES['2'] = DEUX.pub;
  verifier('une fois la cle 2 publiee : acceptee', !!verify(t));

  /* Et le point qui justifie tout l'exercice : les anciennes
     licences continuent de marcher pendant et apres la bascule. */
  verifier('les licences cle 1 marchent toujours apres la bascule',
           !!verify(licence({ kid: '1' }, UNE.priv)));
  verifier('celles sans numero aussi',
           !!verify(licence({}, UNE.priv)));
}

/* ---------- 4. CE QU'IL FAUT REFUSER ---------- */
{
  /* Annoncer un numero et signer avec une autre cle : c'est la
     fraude que le mecanisme doit rendre inutile. Le numero ne
     DESIGNE qu'une cle ; il ne prouve rien. */
  verifier('numero 1 annonce, signature de la cle 2 : refusee',
           verify(licence({ kid: '1' }, DEUX.priv)) === null);
  verifier('numero 2 annonce, signature de la cle 1 : refusee',
           verify(licence({ kid: '2' }, UNE.priv)) === null);
  verifier('une cle jamais declaree : refusee',
           verify(licence({ kid: '3' }, TROIS.priv)) === null);
  verifier('un numero fantaisiste : refuse',
           verify(licence({ kid: 'admin' }, UNE.priv)) === null);

  /* Charge modifiee apres signature. */
  {
    const t = licence({ kid: '1', plan: 'resident' }, UNE.priv);
    const [b, s] = t.split('.');
    const charge = JSON.parse(Buffer.from(b, 'base64url').toString('utf8'));
    charge.plan = 'collectif';
    const falsifie = Buffer.from(JSON.stringify(charge), 'utf8').toString('base64url') + '.' + s;
    verifier('une charge modifiee apres coup : refusee', verify(falsifie) === null);
  }

  verifier('une licence pour une autre machine : refusee',
           verify(licence({ kid: '1', device: 'une-autre-machine' }, UNE.priv)) === null);
  verifier('du n\'importe quoi : refuse', verify('pas-un-jeton') === null);
  verifier('une chaine vide : refusee', verify('') === null);
}

/* ---------- 5. LE SERVEUR POSE BIEN LE NUMERO ---------- */
/* lib/lib.js vit dans l'autre depot. Quand il est a cote, on
   verifie que signPayload() estampille — sinon les futures
   versions ne sauraient rattacher la licence a aucune cle. */
{
  const path = require('path');
  const fs = require('fs');
  const libP = path.join(__dirname, '..', '..', 'liaison-web', 'lib', 'lib.js');
  if (!fs.existsSync(libP)) {
    console.log('  (liaison-web absent a cote — cote serveur non verifie)');
  } else {
    process.env.LICENSE_PRIVATE_KEY = UNE.priv.export({ type: 'pkcs8', format: 'pem' });
    process.env.LICENSE_KEY_ID = '7';
    let L;
    try { L = require(libP); } catch (e) { L = null; }
    if (!L || !L.signPayload) {
      console.log('  (lib.js non chargeable ici — cote serveur non verifie)');
    } else {
      const jeton = L.signPayload({ key: 'K', plan: 'resident', device: MOI });
      const charge = JSON.parse(Buffer.from(jeton.split('.')[0], 'base64url').toString('utf8'));
      verifier('le serveur estampille le numero de cle', charge.kid === '7', String(charge.kid));
      verifier('et la charge d\'origine est intacte', charge.plan === 'resident', charge.plan);
    }
    delete process.env.LICENSE_PRIVATE_KEY;
    delete process.env.LICENSE_KEY_ID;
  }
}

/* ============================================================
   6. LE CONTROLE QUI COMPTE VRAIMENT.

   Tout ce qui precede utilise des cles jetables : ca eprouve le
   MECANISME, pas la realite. La question a laquelle un client
   qui a paye veut une reponse est celle-ci :

     « ma licence, signee par la vraie cle, au format d'avant,
       marche-t-elle encore apres la mise a jour ? »

   On la pose donc pour de bon — avec la cle privee reelle quand
   elle est disponible localement, et contre le tableau de cles
   publiques NON MODIFIE d'une instance fraiche de license.js.

   Sur une machine qui n'a pas la cle privee (le CI, par exemple),
   ce bloc se tait : il n'a pas de quoi conclure, et inventer une
   reponse serait pire que ne rien dire.
   ============================================================ */
{
  const fs = require('fs');
  const path = require('path');
  const cles = path.join(__dirname, '..', '..', 'liaison-web', 'lib', 'keys.js');
  if (!fs.existsSync(cles)) {
    console.log('\n  (cle privee reelle absente ici — controle du parc existant non joue)');
  } else {
    let K = null;
    try { K = require(cles); } catch (e) {}
    if (!K || !K.LICENSE_PRIVATE_KEY) {
      console.log('\n  (lib/keys.js sans cle privee — controle du parc existant non joue)');
    } else {
      console.log('\navec la VRAIE cle de production\n');
      /* Instance fraiche : le tableau de cles publiques a ete
         remplace plus haut pour les besoins de l'essai, et on
         veut ici celui qui sera reellement publie. */
      delete require.cache[require.resolve('../src/license.js')];
      const vrai = require('../src/license.js');
      const priv = crypto.createPrivateKey(K.LICENSE_PRIVATE_KEY.replace(/\\n/g, '\n'));
      const moi = vrai.deviceId();
      const sign = c => {
        const b = Buffer.from(JSON.stringify(c), 'utf8');
        return b.toString('base64url') + '.' + crypto.sign(null, b, priv).toString('base64url');
      };
      const base = { key: 'LSN-REEL', plan: 'resident', seats: 2, device: moi,
                     status: 'active', until: Date.now() + 9e8, exp: Date.now() + 9e8, iat: Date.now() };
      const ancienne = vrai.verify(sign(base));
      const neuve = vrai.verify(sign(Object.assign({}, base, { kid: '1' })));
      verifier('une licence DEJA VENDUE (sans numero) reste valide',
               !!ancienne && ancienne.plan === 'resident', 'REFUSEE — le parc serait coupe');
      verifier('une licence emise desormais (numero 1) est valide',
               !!neuve && neuve.plan === 'resident', 'refusee');
      /* Et la cle publique embarquee est bien celle de la cle
         privee qui signe : si elles divergeaient, aucune licence
         ne se verifierait plus du tout. */
      const derivee = crypto.createPublicKey(priv).export({ type: 'spki', format: 'pem' }).trim();
      verifier('la cle publique embarquee est celle qui signe',
               derivee === String(vrai.CLES_PUBLIQUES[vrai.CLE_PAR_DEFAUT]).trim(),
               'elles ont diverge');
    }
  }
}

console.log(ko ? '\n' + ko + ' cas en echec — NE PAS PUBLIER.'
               : '\nrotation : la cle peut changer sans couper un seul client.');
process.exit(ko ? 1 : 0);
