'use strict';
/* ============================================================
   TITRES A AVOIR — CE QUE TA SALLE T'A RECLAME ET QUE TU N'AS PAS.

   Le point de depart est un defaut, pas une idee : dans
   majTendances(), une demande d'invite qui ne trouve aucun morceau
   dans la bibliotheque etait jetee, avec ce commentaire —
   « le DJ ne l'a pas : rien a proposer ». C'est vrai pour la nuit
   en cours, et c'est faux pour tout le reste. Une salle qui
   reclame un titre que le DJ n'a pas, c'est l'information la plus
   precieuse qu'un DJ puisse recevoir, et Liaison la detruisait a
   chaque fois depuis le premier jour.

   Elle est donc ecrite dans un journal, soiree apres soiree. Ce
   que ca donne au bout de trois dates : « on te l'a demande
   quatre fois, dans trois soirees differentes, tu ne l'as
   toujours pas ». Aucun classement mondial ne dira ca.

   TROIS SOURCES, DANS CET ORDRE D'AUTORITE :

     1. LA SALLE      — les demandes d'invites restees sans
                        reponse. C'est ce qui s'est passe chez LUI.
                        Verifiable, date, compte.
     2. LE CLIENT     — les titres de la liste imposee qui ne
                        matchent rien. Ceux-la sont des obligations
                        contractuelles, pas des envies.
     3. LE CLASSEMENT — ce que le monde ecoute (charts.js). C'est
                        la seule source qui vient de l'exterieur,
                        donc la seule qui puisse etre fausse pour
                        cette salle-la. Elle passe en dernier et
                        elle est annoncee comme exterieure.

   On ne melange jamais les trois dans une liste unique classee :
   « demande 4 fois chez toi » et « 12e du classement France » ne
   se comparent pas, et fabriquer un score commun reviendrait a
   inventer une equivalence qui n'existe pas.
   ============================================================ */

/* La cle d'un titre, pour rapprocher deux ecritures du meme
   morceau d'une soiree a l'autre. Volontairement grossiere : on
   compare des saisies de telephone, pas des tags. */
function cleDe(artist, title) {
  const n = s => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\b(feat|ft|with|remix|edit|radio|extended|version|original mix)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return n(artist) + '|' + n(title);
}

/* ------------------------------------------------------------
   Le journal.

   Une entree par titre reclame et absent : combien de fois, dans
   combien de soirees differentes, et quand pour la derniere fois.
   Le nombre de SOIREES compte plus que le nombre de demandes —
   huit demandes le meme soir, c'est une table de huit personnes ;
   une demande par soir pendant huit soirs, c'est un trou dans la
   bibliotheque.
   ------------------------------------------------------------ */
function noter(journal, entree) {
  const cle = cleDe(entree.artist, entree.title);
  if (!cle.replace('|', '').trim()) return journal;
  const j = journal || {};
  const e = j[cle] || { artist: entree.artist || '', title: entree.title || '',
                        n: 0, soirees: [], derniere: 0 };
  e.n += Math.max(1, entree.n || 1);
  /* L'orthographe la plus longue gagne : « Get Lucky » et
     « Get Lucky (feat. Pharrell) » designent le meme morceau, et
     c'est la seconde qui aide a l'acheter. */
  if ((entree.title || '').length > (e.title || '').length) e.title = entree.title;
  if ((entree.artist || '').length > (e.artist || '').length) e.artist = entree.artist;
  const sid = String(entree.soiree || '');
  if (sid && e.soirees.indexOf(sid) < 0) e.soirees.push(sid);
  e.derniere = Math.max(e.derniere || 0, entree.at || Date.now());
  j[cle] = e;
  return j;
}

/* Le journal ne grandit pas sans fin : au-dela du plafond, on
   oublie ce qui a ete demande une seule fois et il y a longtemps.
   Un titre reclame une fois il y a huit mois n'est pas un manque,
   c'est un accident. */
function elaguer(journal, opt) {
  const o = opt || {};
  const plafond = o.plafond || 400;
  const vieux = o.vieux || 180 * 24 * 3600 * 1000;
  const cles = Object.keys(journal || {});
  if (cles.length <= plafond) return journal;
  const maintenant = o.maintenant || Date.now();
  const garde = {};
  for (const c of cles) {
    const e = journal[c];
    if (e.n <= 1 && e.soirees.length <= 1 && (maintenant - (e.derniere || 0)) > vieux) continue;
    garde[c] = e;
  }
  /* S'il en reste encore trop, on garde les plus reclames. */
  const restants = Object.keys(garde);
  if (restants.length <= plafond) return garde;
  restants.sort((a, b) => poids(garde[b]) - poids(garde[a]));
  const out = {};
  for (const c of restants.slice(0, plafond)) out[c] = garde[c];
  return out;
}

/* ------------------------------------------------------------
   Le poids d'un manque.

   Une soiree distincte vaut trois demandes. C'est le seul reglage
   de tout ce fichier, et il porte toute l'idee : ce qui revient
   est un trou, ce qui arrive en rafale est une tablee.
   ------------------------------------------------------------ */
function poids(e) {
  return (e.n || 0) + (Math.max(0, (e.soirees || []).length - 1) * 3);
}

/* ------------------------------------------------------------
   La liste, prete a afficher.

   « deja » : ce que le DJ possede peut-etre sous une autre
   orthographe. Sans ca, Liaison enverrait acheter un morceau que
   le DJ a deja — la faute qui fait desinstaller une app.
   ------------------------------------------------------------ */
function manques(journal, opt) {
  const o = opt || {};
  const out = [];
  for (const cle of Object.keys(journal || {})) {
    const e = journal[cle];
    /* Un titre entre dans la bibliotheque entre deux soirees : il
       n'est plus un manque, il sort de la liste. On ne le retire
       pas du journal pour autant — si le DJ le supprime, il
       reapparaitra tout seul. */
    if (o.match && o.library && o.match((e.artist ? e.artist + ' ' : '') + e.title, o.library, 0.5)) continue;
    out.push({
      artist: e.artist, title: e.title,
      n: e.n, soirees: (e.soirees || []).length,
      derniere: e.derniere || 0,
      poids: poids(e),
      achats: o.buyLinks ? o.buyLinks({ artist: e.artist, title: e.title }) : [],
      deja: (o.nearMisses && o.library && o.match)
        ? o.nearMisses({ artist: e.artist, title: e.title }, o.library, o.match, 2) : []
    });
  }
  out.sort((a, b) => b.poids - a.poids || b.derniere - a.derniere);
  return out.slice(0, o.limite || 40);
}

/* ------------------------------------------------------------
   Le classement, confronte a la bibliotheque.

   Un classement brut n'a aucun interet : le DJ possede deja la
   moitie. On ne garde que ce qu'il N'A PAS — c'est la seule
   question posee par ce panneau — et on dit combien on a ecarte,
   pour que le chiffre reste verifiable.
   ------------------------------------------------------------ */
function tamiser(classement, opt) {
  const o = opt || {};
  const titres = (classement && classement.titres) || [];
  if (!titres.length) return Object.assign({}, classement, { titres: [], deja: 0 });
  let deja = 0;
  const manquants = [];
  /* On ne jette plus ce que le DJ possede : on le MARQUE.

     Version precedente : la liste ne montrait que les absents.
     Un top 25 arrivait donc ampute, sans qu'on voie jamais ce
     qu'on avait deja — « 18 ecartes » en petit sous la liste ne
     remplace pas de le voir. Or c'est precisement le rapport
     entre les deux qui renseigne : dix-huit lignes calmes et
     sept lignes rouges se lisent d'un coup d'oeil, et le
     classement redevient verifiable ligne a ligne.

     `titres` garde son sens — ce qui manque, rien d'autre — pour
     tout ce qui s'en sert deja. `tout` est la liste complete,
     dans l'ordre du classement, chaque entree portant `a` : vrai
     si elle est dans la bibliotheque. Les liens d'achat ne sont
     calcules que pour les absents : on n'achete pas ce qu'on a. */
  const tout = [];
  for (const t of titres) {
    const trouve = o.match && o.library
      ? o.match((t.artist ? t.artist + ' ' : '') + t.title, o.library, 0.5) : null;
    if (trouve) {
      deja++;
      tout.push(Object.assign({}, t, { a: true, achats: [] }));
      continue;
    }
    const e = Object.assign({}, t, {
      a: false,
      achats: o.buyLinks ? o.buyLinks({ artist: t.artist, title: t.title }) : []
    });
    manquants.push(e);
    tout.push(e);
  }
  /* La limite decoupe une FENETRE dans le classement — le top 25
     d'un releve qui en compte cinquante — et `titres` est ce qui
     manque DANS cette fenetre. Les deux listes decrivent donc le
     meme ecran : impossible d'afficher « 7 a acheter » au-dessus
     d'une liste qui n'en montrerait que quatre. */
  const lim = o.limite || 25;
  const fenetre = tout.slice(0, lim);
  return Object.assign({}, classement, {
    titres: fenetre.filter(e => !e.a),
    tout: fenetre,
    deja: deja,
    vus: titres.length
  });
}

module.exports = { cleDe, noter, elaguer, poids, manques, tamiser };
