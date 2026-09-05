'use strict';
/* ============================================================
   Les soirees preparees a l'avance.

   Le probleme : les reglages de contexte sont GLOBAUX. Un DJ qui
   enchaine un mariage samedi et un anniversaire de vingt ans
   dimanche doit, entre les deux, changer le pays, changer le type
   d'evenement, effacer la liste des titres voulus du samedi,
   coller celle du dimanche, refaire la liste rouge. A 18 h, dans
   la voiture. Personne ne le fait — donc le dimanche se joue avec
   les reglages du samedi, et les suggestions sont a cote.

   Une soiree est donc une FICHE : un nom, une date, un lieu, un
   contexte, les titres que le client veut, ceux qu'il refuse, les
   genres a privilegier et ceux a eviter, une duree, des notes. On
   la prepare tranquillement dans la semaine, on l'active en
   arrivant, et tout bascule d'un coup.

   Le QR des invites suit : il est derive du nom de la soiree,
   donc chaque soiree a le sien. Les demandes de la soiree du
   samedi n'apparaissent pas le dimanche.

   Ce que ce module ne fait PAS : il ne touche pas a la
   bibliotheque ni au moteur. Il ne fait que ranger des reglages
   et les rendre interchangeables.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* Les champs d'une fiche, et rien d'autre. Une fiche inconnue
   venue d'une version future est ignoree champ par champ plutot
   que rejetee en bloc. */
function vide(nom) {
  return {
    id: null,
    /* Le jeton du QR des invites. Tire une seule fois, garde pour la vie
       de la fiche : le QR imprime sur les tables reste valable de la
       preparation jusqu'a la fin de la nuit, et il est different pour
       chaque soiree — les demandes du samedi ne reviennent pas dimanche. */
    jeton: crypto.randomBytes(9).toString('base64url'),
    nom: nom || 'Nouvelle soiree',
    date: '',            /* AAAA-MM-JJ, libre */
    lieu: '',
    pays: 'fr',
    evenement: 'club',
    dureeMin: 240,
    /* les listes du client */
    voulus: [],          /* ['Artiste - Titre', ...] */
    interdits: [],
    /* les gouts, en clair */
    genresAimes: [],     /* ['funk', 'disco'] */
    genresEvites: [],
    /* le lien Spotify colle par le client, garde pour memoire */
    playlist: '',
    notes: '',
    cree: 0,
    joue: 0              /* date de la derniere fois ou elle a ete active */
  };
}

const nettoyerListe = v => (Array.isArray(v) ? v : String(v || '').split(/\r?\n/))
  .map(x => String(x || '').trim()).filter(Boolean).slice(0, 500);

/* Un identifiant stable, derive du nom et de la date de creation :
   c'est lui qui donnera son jeton au QR de la soiree. */
function idDe(nom, quand) {
  let h = 0x811c9dc5;
  const s = String(nom || '') + '|' + quand;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 's' + h.toString(36);
}

class Soirees {
  constructor(fichier) {
    this.fichier = fichier;
    this.d = this._charger();
  }
  _charger() {
    try {
      const j = JSON.parse(fs.readFileSync(this.fichier, 'utf8'));
      if (j && Array.isArray(j.liste)) return { v: 1, liste: j.liste, active: j.active || null };
    } catch (e) {}
    return { v: 1, liste: [], active: null };
  }
  _ranger() {
    try {
      fs.mkdirSync(path.dirname(this.fichier), { recursive: true });
      const tmp = this.fichier + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.d, null, 1));
      fs.renameSync(tmp, this.fichier);
    } catch (e) {}
  }

  liste() {
    /* la plus recemment jouee en tete, puis les plus recemment creees */
    return this.d.liste.slice().sort((a, b) => (b.joue || 0) - (a.joue || 0) || (b.cree || 0) - (a.cree || 0));
  }
  active() { return this.d.liste.find(s => s.id === this.d.active) || null; }

  creer(patch) {
    const quand = Date.now();
    const s = Object.assign(vide((patch && patch.nom) || null), patch || {});
    s.cree = quand;
    s.id = idDe(s.nom, quand);
    s.voulus = nettoyerListe(s.voulus);
    s.interdits = nettoyerListe(s.interdits);
    s.genresAimes = nettoyerListe(s.genresAimes);
    s.genresEvites = nettoyerListe(s.genresEvites);
    this.d.liste.push(s);
    this._ranger();
    return s;
  }

  modifier(id, patch) {
    const s = this.d.liste.find(x => x.id === id);
    if (!s) return null;
    for (const k of Object.keys(vide())) {
      if (k === 'id' || k === 'cree') continue;
      if (patch && Object.prototype.hasOwnProperty.call(patch, k)) s[k] = patch[k];
    }
    s.voulus = nettoyerListe(s.voulus);
    s.interdits = nettoyerListe(s.interdits);
    s.genresAimes = nettoyerListe(s.genresAimes);
    s.genresEvites = nettoyerListe(s.genresEvites);
    this._ranger();
    return s;
  }

  /* Dupliquer : la plupart des soirees d'un DJ mobile se
     ressemblent. On repart de la derniere plutot que de tout
     retaper — et on n'herite PAS de la date ni de l'historique. */
  dupliquer(id, nom) {
    const s = this.d.liste.find(x => x.id === id);
    if (!s) return null;
    /* La copie reprend tout SAUF l'identite : son propre identifiant, et
       surtout son propre jeton de QR. Deux soirees qui partageraient le
       meme lien invite, ce sont les demandes de l'une qui tombent chez
       l'autre — exactement ce que la fiche est censee eviter. */
    const c = this.creer(Object.assign({}, s, {
      nom: nom || (s.nom + ' (copie)'), date: '', joue: 0,
      id: null, jeton: crypto.randomBytes(9).toString('base64url')
    }));
    return c;
  }

  supprimer(id) {
    const n = this.d.liste.length;
    this.d.liste = this.d.liste.filter(x => x.id !== id);
    if (this.d.active === id) this.d.active = null;
    this._ranger();
    return this.d.liste.length < n;
  }

  activer(id) {
    const s = this.d.liste.find(x => x.id === id);
    if (!s) return null;
    s.joue = Date.now();
    this.d.active = id;
    this._ranger();
    return s;
  }
  desactiver() { this.d.active = null; this._ranger(); }

  /**
   * Ce qu'il faut appliquer a la configuration pour jouer cette
   * soiree. On rend un objet, on ne modifie rien : c'est main.js
   * qui decide quand l'appliquer.
   */
  reglages(id) {
    const s = id ? this.d.liste.find(x => x.id === id) : this.active();
    if (!s) return null;
    return {
      sessionName: s.nom,
      pack: s.pays + '-' + s.evenement,
      clientWanted: s.voulus.map(t => ({ artist: '', title: t })),
      clientBanned: s.interdits.map(t => ({ artist: '', title: t })),
      /* le jeton du QR : propre a la soiree, donc les demandes du
         samedi ne reviennent pas le dimanche */
      sessionToken: s.jeton || s.id,
      dureeMin: s.dureeMin,
      genresAimes: s.genresAimes,
      genresEvites: s.genresEvites
    };
  }

  /**
   * L'inflexion de genres a passer au moteur : ce que le client
   * aime monte, ce qu'il n'aime pas descend. On ne remplace pas
   * l'ADN du contexte, on le corrige — un mariage reste un
   * mariage, meme si les maries adorent le disco.
   */
  inflexion(dna, id) {
    const s = id ? this.d.liste.find(x => x.id === id) : this.active();
    const out = Object.assign({}, dna || {});
    if (!s) return out;
    for (const g of s.genresAimes) {
      const k = String(g).toLowerCase().trim();
      if (k) out[k] = Math.min(100, (out[k] || 40) + 35);
    }
    for (const g of s.genresEvites) {
      const k = String(g).toLowerCase().trim();
      if (k) out[k] = Math.max(0, (out[k] || 40) - 45);
    }
    return out;
  }
}

module.exports = { Soirees, vide, idDe };
