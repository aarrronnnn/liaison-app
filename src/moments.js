'use strict';
/* ============================================================
   Les deux moments de l'essai, isoles pour etre testables.

   La regle metier tient en quelques lignes, mais elle a quatre
   pieges, et chacun coute un client :

     1. prevenir trop tot (un rappel a J-10 est du harcelement) ;
     2. prevenir deux fois (une fenetre qui revient est une fenetre
        qu'on ferme sans lire, puis une app qu'on desinstalle) ;
     3. prevenir pendant un set — jamais, sous aucun pretexte : un
        DJ interrompu en soiree pour parler d'argent ne revient pas ;
     4. prevenir quelqu'un qui a deja paye.

   D'ou une fonction pure : etat en entree, decision en sortie.
   ============================================================ */

/** Le seuil du rappel, en jours restants. Deux, pas trois :
    l'essai ne dure plus que sept jours. */
const RAPPEL_A = 2;

/**
 * @param {object} e
 *   e.tier        niveau effectif : 'trial', 'expire', 'resident', ...
 *   e.trialLeft   jours d'essai restants
 *   e.trialStart  date de debut d'essai (absente = jamais essaye)
 *   e.vuRappel    date a laquelle le rappel a deja ete montre
 *   e.vuFin       date a laquelle la fenetre de fin a deja ete montree
 *   e.setEnCours  vrai si un set est ouvert en ce moment
 * @returns {{rappel: boolean, fin: boolean}}
 */
function aMontrer(e) {
  const r = { rappel: false, fin: false };
  if (!e) return r;

  /* Un client qui paie n'a rien a lire sur l'essai. */
  if (e.tier !== 'trial' && e.tier !== 'expire') return r;

  /* Jamais au milieu d'une soiree. Ni le rappel, ni la fenetre. */
  if (e.setEnCours) return r;

  if (e.tier === 'trial') {
    if (!e.vuRappel && e.trialLeft > 0 && e.trialLeft <= RAPPEL_A) r.rappel = true;
    return r;
  }

  /* tier === 'expire' : soit l'essai vient de finir, soit la personne
     n'a jamais essaye — et dans ce dernier cas il n'y a rien a
     annoncer. */
  if (e.trialStart && !e.vuFin) r.fin = true;
  return r;
}

/**
 * La phrase du rappel. Elle parle de ce que la personne a fait,
 * pas de ce qu'elle va perdre.
 */
function phraseRappel(jours, bilan) {
  const b = bilan || {};
  let fait = '';
  if (b.enchainements >= 20) fait = b.enchainements + ' enchaînements plus tard, ';
  else if (b.sets) fait = b.sets + (b.sets > 1 ? ' sets plus tard, ' : ' set plus tard, ');
  const j = Math.max(1, jours | 0);
  return fait + 'il te reste ' + j + ' jour' + (j > 1 ? 's' : '') + " d'essai. Ensuite, un pass " +
    'soirée à 4,95 € rouvre tout pour 48 h — ou un abonnement, si tu joues souvent.';
}

/**
 * Le premier debrief est offert.
 *
 * Personne ne peut juger sur une capture d'ecran ce que valent les
 * chiffres de SA soiree. Celui qui n'accroche pas garde une app
 * gratuite entiere ; celui qui accroche sait ce qu'il achete.
 *
 * @param {object} e
 *   e.replay       vrai si la licence ouvre deja le debrief
 *   e.dejaOffert   date du debrief offert, ou rien
 * @returns {{ok: boolean, offert: boolean}}
 */
function debriefAutorise(e) {
  const o = e || {};
  if (o.replay) return { ok: true, offert: false };
  if (o.dejaOffert) return { ok: false, offert: false };
  return { ok: true, offert: true };
}

/* ------------------------------------------------------------
   La prolongation d'essai, et pourquoi elle existe.

   Ce que Resident ouvre, ce sont les outils de SOIREE : les listes du
   client, le QR des invites, la tracklist a declarer, le debrief. Rien
   de tout ca ne se juge un mardi soir chez soi — il faut avoir joue
   devant du monde.

   Or un DJ de mariage joue deux a quatre fois par mois. Sept jours
   de calendrier, ca fait presque toujours ZERO soiree reelle. L'essai expirait
   donc avant que la personne ait pu voir ce qu'elle etait censee
   acheter. Ce n'est pas un probleme de prix, c'est un probleme
   d'horloge : on compte des jours alors que la valeur se mesure en
   soirees.

   D'ou une prolongation, UNE seule, de quatorze jours, accordee
   automatiquement a qui arrive au bout sans avoir joue au moins deux
   soirees. Ce n'est pas une faveur commerciale : c'est rendre a l'essai
   ce qu'il promettait.
   ------------------------------------------------------------ */
const SETS_POUR_JUGER = 2;
const PROLONGATION_J = 7;

/**
 * @param {object} e
 *   e.tier        niveau effectif
 *   e.trialLeft   jours restants avant prolongation
 *   e.trialStart  debut de l'essai
 *   e.sets        nombre de soirees enregistrees
 *   e.dejaProlonge  date de la prolongation deja accordee, ou rien
 * @returns {{prolonger: boolean, jours: number}}
 */
function prolongationDue(e) {
  const o = e || {};
  const non = { prolonger: false, jours: 0 };
  if (o.dejaProlonge) return non;
  if (o.tier !== 'trial' && o.tier !== 'expire') return non;   /* deja client */
  if (!o.trialStart) return non;                             /* jamais commence */
  if ((o.trialLeft | 0) > 0) return non;                     /* pas encore fini */
  if ((o.sets | 0) >= SETS_POUR_JUGER) return non;           /* a pu juger */
  return { prolonger: true, jours: PROLONGATION_J };
}

/** Ce qu'on dit en prolongeant. On dit pourquoi, sinon ca sonne faux. */
function phraseProlongation(sets) {
  const n = sets | 0;
  const fait = n === 0
    ? "tu n'as pas encore joué une seule soirée avec"
    : "tu n'as joué qu'une soirée avec";
  return 'Ton essai arrive au bout, et ' + fait + '. Or c\'est exactement là que ' +
    'les listes du client, le QR des invités et le débrief servent. On te rend ' +
    PROLONGATION_J + ' jours — une fois. Joue une vraie soirée, puis décide.';
}

module.exports = { aMontrer, phraseRappel, debriefAutorise, prolongationDue,
                   phraseProlongation, RAPPEL_A, SETS_POUR_JUGER, PROLONGATION_J };
