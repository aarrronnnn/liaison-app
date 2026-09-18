'use strict';
/* ============================================================
   TITRES A AVOIR — le banc.

   Ce que ce fichier protege, dans l'ordre d'importance :

   1. Qu'une demande d'invite pour un titre ABSENT ne se perde
      plus. C'est le defaut d'origine — majTendances() faisait
      « continue » et la donnee etait detruite. Si quelqu'un
      remet un jour ce raccourci, l'essai 1 tombe.
   2. Qu'une soiree distincte pese plus qu'une demande repetee :
      c'est toute la difference entre un trou dans la
      bibliotheque et une tablee insistante.
   3. Qu'un titre achete depuis sorte de la liste tout seul.
   4. Que le module de classements n'invente JAMAIS rien : sans
      cle, sans fournisseur, sans reseau, il rend un etat nomme
      et une liste vide, jamais une liste plausible.
   ============================================================ */
const aavoir = require('../src/aavoir');

/* ------------------------------------------------------------
   UN BANC NE DOIT JAMAIS DEPENDRE D'INTERNET.

   Des que la cle Last.fm a ete posee sur la machine de
   developpement, deux essais sont tombes — et l'un d'eux est
   tombe en REUSSISSANT : « Last.fm sans cle reste eteint » a
   recu une vraie reponse du service. C'est-a-dire que ce fichier
   appelait Last.fm a chaque « npm run verifier », consommait le
   quota de l'accord commercial, et serait rouge le jour d'une
   coupure de wifi ou d'un train.

   On neutralise donc la cle de construction AVANT de charger
   charts.js, en posant un module vide dans le cache de require.
   Les essais decrivent alors toujours le meme monde : celui d'une
   version construite sans cle. Ceux qui ont besoin d'une cle la
   fabriquent eux-memes, par la variable d'environnement.
   ------------------------------------------------------------ */
try {
  const chemin = require.resolve('../src/cle-construction');
  require.cache[chemin] = { id: chemin, filename: chemin, loaded: true, exports: {} };
} catch (e) { /* pas de cle posee : c'est deja le monde qu'on veut */ }
const cleEnv = process.env.LIAISON_LASTFM_CLE;
delete process.env.LIAISON_LASTFM_CLE;

/* Et le relais est pointe vers une adresse morte. Meme raison que
   ci-dessus, appliquee au nouveau chemin : sans cette ligne, chaque
   « npm run verifier » irait taper le vrai liaisondj.app, donc le
   vrai quota Last.fm derriere, et le banc virerait au rouge dans un
   train. Un essai qui depend d'Internet n'est pas un essai. */
process.env.LIAISON_CLASSEMENTS = 'http://127.0.0.1:1/relais-de-test';

const charts = require('../src/charts');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(56),
              detail ? '  — ' + detail : '');
}

/* ---------- 1. le journal retient ce qui etait jete ---------- */
{
  let j = {};
  j = aavoir.noter(j, { artist: 'Gims', title: 'Bella', n: 3, soiree: 's1', at: 1000 });
  verifier('1. une demande sans reponse est notee', Object.keys(j).length === 1);

  /* Deux ecritures du meme morceau, deux soirees : une seule entree. */
  j = aavoir.noter(j, { artist: 'gims', title: 'Bella (feat. X)', n: 2, soiree: 's2', at: 2000 });
  const e = j[Object.keys(j)[0]];
  verifier('1bis. deux orthographes ne font qu\'un titre',
           Object.keys(j).length === 1, Object.keys(j).length + ' entree(s)');
  verifier('1ter. et l\'ecriture la plus complete est gardee',
           e.title === 'Bella (feat. X)', e.title);
  verifier('1quater. les soirees distinctes sont comptees',
           e.soirees.length === 2 && e.n === 5, e.soirees.length + ' soirees, ' + e.n + ' demandes');
}

/* ---------- 2. une soiree vaut plus qu'une demande ---------- */
{
  let j = {};
  /* Huit demandes le meme soir : une tablee. */
  j = aavoir.noter(j, { artist: 'A', title: 'Tablee', n: 8, soiree: 's1', at: 1 });
  /* Trois demandes, trois soirees differentes : un trou. */
  for (const s of ['s1', 's2', 's3'])
    j = aavoir.noter(j, { artist: 'B', title: 'Trou', n: 1, soiree: s, at: 2 });
  const l = aavoir.manques(j, {});
  verifier('2. ce qui revient passe devant ce qui insiste',
           l[0].title === 'Trou', l.map(x => x.title + '(' + x.poids + ')').join(' > '));
}

/* ---------- 3. un titre acquis sort de la liste ---------- */
{
  let j = {};
  j = aavoir.noter(j, { artist: 'Modjo', title: 'Lady', n: 4, soiree: 's1', at: 1 });
  j = aavoir.noter(j, { artist: 'Gims', title: 'Bella', n: 4, soiree: 's1', at: 1 });
  const biblio = [{ id: 1, artist: 'Modjo', title: 'Lady (Hear Me Tonight)' }];
  /* un rapprochement volontairement grossier, comme celui du moteur */
  const match = (txt, lib) => {
    const t = String(txt).toLowerCase();
    const trouve = lib.find(x => t.indexOf(String(x.title).toLowerCase().split(' (')[0]) >= 0);
    return trouve ? { track: trouve } : null;
  };
  const l = aavoir.manques(j, { library: biblio, match: match });
  verifier('3. le titre achete depuis disparait tout seul',
           l.length === 1 && l[0].title === 'Bella', l.map(x => x.title).join(', '));
}

/* ---------- 4. l'elagage ne jette que l'accidentel ---------- */
{
  const vieux = Date.now() - 400 * 24 * 3600 * 1000;
  let j = {};
  for (let i = 0; i < 500; i++)
    j = aavoir.noter(j, { artist: 'X' + i, title: 'T' + i, n: 1, soiree: 's1', at: vieux });
  j = aavoir.noter(j, { artist: 'Garde', title: 'Moi', n: 9, soiree: 's1', at: vieux });
  const apres = aavoir.elaguer(j, { plafond: 100 });
  const garde = Object.keys(apres).some(c => /garde/.test(c));
  verifier('4. le journal ne grandit pas sans fin',
           Object.keys(apres).length <= 100, Object.keys(apres).length + ' entrees');
  verifier('4bis. mais un titre tres reclame n\'est jamais oublie', garde === true);
}

/* ---------- 5. le classement confronte a la bibliotheque ---------- */
{
  const brut = { etat: 'ok', source: 'Last.fm', zone: 'France', titres: [
    { rang: 1, artist: 'A', title: 'Jai' }, { rang: 2, artist: 'B', title: 'Jaipas' }] };
  const biblio = [{ id: 1, artist: 'A', title: 'Jai' }];
  /* Un rapprochement EXACT ici, et c'est volontaire : la premiere
     version de cet essai cherchait « jai » comme sous-chaine, donc
     « Jaipas » matchait aussi et l'essai tombait. Le defaut etait
     dans le faux moteur de l'essai, pas dans tamiser() — mais une
     heure a chercher au mauvais endroit suffit a justifier ce
     commentaire. */
  const match = (txt, lib) => {
    const t = String(txt).toLowerCase().trim();
    const f = lib.find(x => t === (String(x.artist) + ' ' + String(x.title)).toLowerCase().trim());
    return f ? { track: f } : null;
  };
  const r = aavoir.tamiser(brut, { library: biblio, match: match });
  verifier('5. le classement ne montre que ce qu\'on n\'a pas',
           r.titres.length === 1 && r.titres[0].title === 'Jaipas',
           r.titres.map(x => x.title).join(', '));
  verifier('5bis. et dit combien il a ecarte', r.deja === 1 && r.vus === 2,
           r.deja + ' deja sur ' + r.vus);
}

/* ------------------------------------------------------------
   12. LA LISTE DORT, LA CONFRONTATION EST VIVANTE.

   Le classement est garde sur le disque et ne se rafraichit que
   sur demande — c'est ce qui economise le quota de l'accord
   Last.fm et ce qui rend la rubrique utilisable dans un train.

   Mais « tu l'as / tu ne l'as pas » doit suivre la bibliotheque a
   la seconde : un morceau telecharge hier soir doit sortir de la
   liste des manques ce matin, SANS qu'on ait rappele quoi que ce
   soit a l'exterieur.

   C'est tamiser() qui tient cette promesse, en refaisant le
   rapprochement a chaque lecture. Si quelqu'un met un jour le
   RESULTAT en cache au lieu de la liste brute — ce qui parait
   plus econome — cet essai tombera, et c'est exactement son role.
   ------------------------------------------------------------ */
{
  const brut = { etat: 'ok', source: 'Last.fm', zone: 'France', titres: [
    { rang: 1, artist: 'A', title: 'Deja la' },
    { rang: 2, artist: 'B', title: 'Achete demain' },
    { rang: 3, artist: 'C', title: 'Jamais' }] };
  const match = (txt, lib) => {
    const t = String(txt).toLowerCase().trim();
    const f = lib.find(x => t === (x.artist + ' ' + x.title).toLowerCase().trim());
    return f ? { track: f } : null;
  };
  const biblio = [{ id: 1, artist: 'A', title: 'Deja la' }];

  const avant = aavoir.tamiser(brut, { library: biblio, match: match });
  verifier('12. avant achat : deux titres manquent',
           avant.titres.length === 2 && avant.deja === 1,
           avant.titres.map(x => x.title).join(', '));

  /* Le DJ achete le morceau. On ne touche PAS a la liste brute. */
  biblio.push({ id: 2, artist: 'B', title: 'Achete demain' });

  const apres = aavoir.tamiser(brut, { library: biblio, match: match });
  verifier('12bis. le morceau achete sort, sans rien redemander',
           apres.titres.length === 1 && apres.titres[0].title === 'Jamais',
           apres.titres.map(x => x.title).join(', '));
  verifier('12ter. et le compte « tu en as deja » suit',
           apres.deja === 2 && apres.vus === 3, apres.deja + ' sur ' + apres.vus);
  verifier('12quater. la liste brute, elle, n\'a pas bouge',
           brut.titres.length === 3);
}

/* ---------- 6. les classements n'inventent jamais ---------- */
(async () => {
  const sans = await charts.charger({});
  verifier('6. sans fournisseur : un etat nomme, zero titre',
           sans.etat === 'non-configure' && sans.titres.length === 0, sans.etat);

  const sansCle = await charts.charger({ fournisseur: 'lastfm' });
  verifier('6bis. Last.fm sans cle reste eteint',
           sansCle.etat === 'sans-cle' && sansCle.titres.length === 0, sansCle.etat);

  const inconnu = await charts.charger({ fournisseur: 'napster' });
  verifier('6ter. un fournisseur inconnu ne plante pas',
           inconnu.etat === 'non-configure' && inconnu.titres.length === 0, inconnu.etat);

  /* Le pays suit le contexte de la soiree : c'est ce qui distingue
     un classement utile d'un top mondial sans rapport avec la salle. */
  verifier('7. le pays du classement suit le contexte choisi',
           charts.PAYS_LASTFM[charts.paysDe('fr-mariage')] === 'France' &&
           charts.PAYS_LASTFM[charts.paysDe('it-club')] === 'Italy',
           'fr-mariage -> France, it-club -> Italy');

  /* ------------------------------------------------------------
     La cle appartient a l'application, pas au DJ.

     Le panneau demandait au DJ de coller sa propre cle Last.fm.
     C'etait une erreur : l'accord commercial est au nom de
     Liaison, et quatre-vingt-dix-neuf DJ sur cent n'ouvriraient
     jamais un compte developpeur. La fonction serait morte a la
     livraison. Si quelqu'un remet un champ de cle dans l'interface
     un jour, qu'il relise ce commentaire d'abord.
     ------------------------------------------------------------ */
  verifier('9. sans cle de construction, rien ne s\'allume',
           charts.cleLastfm({}) === '', '« ' + charts.cleLastfm({}) + ' »');
  process.env.LIAISON_LASTFM_CLE = 'posee-a-la-construction';
  verifier('9bis. la variable d\'environnement fournit la cle',
           charts.cleLastfm({}) === 'posee-a-la-construction');
  verifier('9ter. et elle passe devant le depannage par config',
           charts.cleLastfm({ cle: 'depannage' }) === 'posee-a-la-construction');
  if (cleEnv === undefined) delete process.env.LIAISON_LASTFM_CLE;
  else process.env.LIAISON_LASTFM_CLE = cleEnv;

  /* ------------------------------------------------------------
     Le pays se choisit, et il gagne sur le contexte.

     Un DJ ne joue pas toujours chez lui : une date a Bruxelles se
     prepare avec le classement belge, meme si la fiche de soiree
     dit « fr-mariage ».
     ------------------------------------------------------------ */
  const pays = charts.listePays();
  verifier('10. le menu des pays est trie et sans doublon',
           pays.length > 25 &&
           pays.filter(x => x.nom === 'United Kingdom').length === 1 &&
           pays[0].nom.localeCompare(pays[1].nom, 'fr') <= 0,
           pays.length + ' pays, de ' + pays[0].nom + ' a ' + pays[pays.length - 1].nom);
  verifier('10bis. et chaque code rend bien un nom Last.fm',
           pays.every(x => !!charts.PAYS_LASTFM[x.code]));

  /* ------------------------------------------------------------
     LE RELAIS EST LE FOURNISSEUR PAR DEFAUT, ET IL NE DEMANDE
     AUCUNE CLE A L'APPLICATION.

     C'est la garantie qui compte : si quelqu'un remet un jour une
     cle dans les binaires, « besoinCle » repassera a vrai et cet
     essai tombera. Une cle dans un .dmg est extractible, ne se
     revoque pas sans republier, et fait payer mille appels la ou
     le relais en fait un.
     ------------------------------------------------------------ */
  verifier('11. le relais ne reclame aucune cle a l\'application',
           charts.FOURNISSEURS.liaison && charts.FOURNISSEURS.liaison.besoinCle === false);
  const viaRelais = await charts.charger({ fournisseur: 'liaison', pack: 'fr-club',
                                           pays: 'be', timeout: 300,
                                           /* une adresse morte : on verifie la forme
                                              de l'echec, pas le reseau */
                                           });
  verifier('11bis. et un relais injoignable rend un etat, pas une exception',
           viaRelais && Array.isArray(viaRelais.titres) && viaRelais.titres.length === 0,
           viaRelais && viaRelais.etat);

  /* Un service injoignable ne doit pas casser la preparation : on
     pointe une adresse qui ne repondra pas, et on verifie qu'on
     recupere un etat plutot qu'une exception. */
  const mort = await charts._lireJSON('https://liaison-invalide.invalid/x', 1200);
  verifier('8. un service injoignable rend null, sans jeter', mort === null);

  if (echecs) { console.error('\n' + echecs + ' probleme(s) sur « titres a avoir ».'); process.exit(1); }
  console.log('\na avoir : ce que la salle reclame et qu\'on n\'a pas ne se perd plus.');
})();
