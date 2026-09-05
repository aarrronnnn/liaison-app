'use strict';
/* ============================================================
   Le gout — ce que Liaison apprend de CE DJ.

   Le probleme, dit simplement : le moteur savait ce qu'est un bon
   enchainement en general. Il ne savait rien de la personne devant
   lui. Ses six coefficients — harmonie 0,27, tempo 0,24, energie
   0,15, timbre 0,14, salle, tendance — sont une moyenne, et il
   n'existe pas de DJ moyen.

   Deux exemples reels, opposes :

     — un DJ house tient la tonalite au demi-ton et ne bouge pas de
       deux BPM en quatre heures ;
     — un DJ de mariage passe de 95 a 128 entre deux titres, rejoue
       le meme artiste a minuit et a trois heures, et se moque
       eperdument de la roue de Camelot.

   Avec des poids fixes, Liaison proposait au second ce qui
   convenait au premier. Pire : il n'avait aucun moyen de s'en
   rendre compte, parce qu'il ne regardait jamais ce qui etait
   joue APRES sa proposition.

   ------------------------------------------------------------
   Comment on apprend

   Chaque changement de morceau est un exemple etiquete, gratuit :
   on avait propose trois titres, le DJ en a joue un — ou pas.

     — il a pris le premier : on avait raison, on ne bouge presque
       rien (0,02) ;
     — il a pris le troisieme : on avait a peu pres raison (0,05) ;
     — il a joue autre chose : c'est la qu'on apprend (0,10).

   Pour chaque critere, on compare la note du morceau REELLEMENT
   joue a la note MEDIANE de ce qu'on proposait. S'il a choisi un
   titre mieux accorde que nos propositions, c'est qu'il tient a
   l'harmonie plus que nous : le poids de l'harmonie monte. S'il a
   choisi un titre plus eloigne en tempo, c'est qu'il tolere les
   ecarts : le poids du tempo baisse et le crible s'ouvre.

   ------------------------------------------------------------
   Trois garde-fous, parce qu'un systeme qui apprend peut apprendre
   de travers

   1. RIEN n'est applique avant douze observations. Deux
      enchainements bizarres en debut de soiree ne doivent pas
      redefinir le gout de quelqu'un.

   2. L'effet monte progressivement : a douze observations il vaut
      un tiers, a quarante il vaut tout. On ne bascule jamais d'un
      coup.

   3. Tout est borne. Un poids reste entre 0,55 et 1,7 fois sa
      valeur d'origine, le crible entre 6 % et 22 %. Meme nourri
      n'importe comment, le moteur ne peut pas devenir absurde.

   Et surtout : c'est lisible. resume() rend des phrases en
   francais que le DJ peut lire, contester, et effacer d'un bouton.
   Une machine qui apprend en cachette est une machine a laquelle
   on ne fait pas confiance.
   ============================================================ */
const fs = require('fs');
const ecrire = require('./ecrire');
const engine = require('./engine');

const CRITERES = ['h', 'tp', 'en', 'ti', 'cr', 'td'];
const MINI = 12;          /* en dessous, on observe sans rien changer */
const PLEIN = 40;         /* au-dela, l'apprentissage vaut a plein */
const AMPLITUDE = 2.2;    /* de l'ecart moyen au multiplicateur */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mediane = a => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };

function vide() {
  return {
    v: 1, n: 0, pris: 0, prisPremier: 0, ignore: 0,
    ema: { h: 0, tp: 0, en: 0, ti: 0, cr: 0, td: 0 },
    /* la notoriete se mesure a part : ce n'est pas un multiplicateur
       d'un poids existant, c'est un axe a elle, du tube au fond de
       crate */
    emaPop: 0,
    ecartTempo: 0,        /* moyenne glissante de |ecart| / bpm */
    repetitionArtiste: 0, /* part des enchainements ou l'artiste revient */
    sautEnergie: 0,       /* moyenne glissante de la variation d'energie signee */
    depuis: Date.now()
  };
}

class Gout {
  constructor(fichier) {
    this.fichier = fichier || null;
    this.d = vide();
    this.charger();
    this._sale = false;
    this._timer = null;
  }

  charger() {
    if (!this.fichier) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.fichier, 'utf8'));
      if (j && j.v === 1 && j.ema) this.d = Object.assign(vide(), j, { ema: Object.assign(vide().ema, j.ema) });
    } catch (e) { /* premier lancement, ou fichier abime : on repart de zero */ }
  }

  /* Ecriture differee et atomique : on observe plusieurs fois par
     minute, on n'ecrit pas plusieurs fois par minute. */
  _ranger() {
    if (!this.fichier) return;
    this._sale = true;
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      if (!this._sale) return;
      this._sale = false;
      ecrire.ecrireJSON(this.fichier, this.d);
    }, 4000);
    if (this._timer.unref) this._timer.unref();
  }

  /**
   * Un enchainement vient d'avoir lieu.
   * @param {object} o
   *   o.cur           le morceau qui tournait avant
   *   o.joue          celui que le DJ a lance
   *   o.propositions  ce que Liaison proposait juste avant (resultats de suggest)
   *   o.recents       les morceaux deja joues ce soir (pour la repetition d'artiste)
   */
  observer(o) {
    o = o || {};
    const cur = o.cur, joue = o.joue;
    if (!cur || !joue || cur.id === joue.id) return;
    if (!(cur.bpm > 0) || !(joue.bpm > 0)) return;

    const props = (o.propositions || []).filter(p => p && p.track);
    const rang = props.findIndex(p => p.track.id === joue.id);

    /* Le rythme d'apprentissage depend de a quel point on avait
       tort. Avoir raison ne doit presque rien changer. */
    const a = rang === 0 ? 0.02 : rang > 0 ? 0.05 : 0.10;

    /* --- 1. ce que le DJ a privilegie, critere par critere --- */
    if (props.length >= 3) {
      const tp = engine.tempoScore(cur.bpm, joue.bpm);
      const valeurs = {
        h:  engine.harmScore(cur.key, joue.key),
        tp: tp.s,
        en: engine.energyScore(cur.energy == null ? 5 : cur.energy, joue.energy == null ? 5 : joue.energy, o.arc || 'hold'),
        ti: engine.timbreScore(cur.timbre, joue.timbre),
        cr: 0, td: 0
      };
      /* la salle et la tendance ne se recalculent pas sans le pack
         ni les classements : on ne les apprend que si le morceau
         joue faisait partie des propositions */
      /* La salle : calculable directement des qu'on connait le pack.
         Sans ca elle n'etait apprise que quand le morceau joue
         figurait dans la liste — c'est-a-dire justement quand on
         avait deja raison, donc presque jamais quand il aurait
         fallu apprendre. */
      if (o.dna) {
        try { valeurs.cr = engine.crowdScore(joue, o.dna, engine.genres.dnaEtendu(o.dna)); }
        catch (e) { if (rang >= 0) valeurs.cr = props[rang].crowd; }
      } else if (rang >= 0) valeurs.cr = props[rang].crowd;
      if (rang >= 0) valeurs.td = props[rang].trend;

      /* La notoriete : joue-t-il plus connu ou moins connu que ce
         qu'on lui proposait ? C'est le seul critere qui separe
         vraiment un DJ de mariage d'un DJ de club, et il n'etait
         mesure nulle part. */
      const popJoue = joue.pop == null ? 40 : joue.pop;
      const popMed = mediane(props.map(p => p.track.pop == null ? 40 : p.track.pop));
      this.d.emaPop = (1 - a) * this.d.emaPop + a * clamp((popJoue - popMed) / 100, -1, 1);

      for (const c of CRITERES) {
        if (c === 'td' && rang < 0) continue;
        if (c === 'cr' && !o.dna && rang < 0) continue;
        const med = mediane(props.map(p => (
          c === 'h' ? p.h : c === 'tp' ? p.tempo.s : c === 'en' ? p.energyScore :
          c === 'ti' ? p.timbreScore : c === 'cr' ? p.crowd : p.trend)));
        const z = clamp((valeurs[c] - med) / 100, -1, 1);
        this.d.ema[c] = (1 - a) * this.d.ema[c] + a * z;
      }
    }

    /* --- 2. l'ecart de tempo qu'il ose reellement --- */
    const tp2 = engine.tempoScore(cur.bpm, joue.bpm);
    const ecart = Math.abs(tp2.delta) / cur.bpm;
    this.d.ecartTempo = (1 - 0.08) * this.d.ecartTempo + 0.08 * clamp(ecart, 0, 0.3);

    /* --- 3. rejoue-t-il les memes artistes ? --- */
    const nom = String(joue.artist || '').toLowerCase().trim();
    if (nom) {
      const recents = (o.recents || []).slice(-48)
        .map(t => String(t.artist || '').toLowerCase().trim());
      const revient = recents.includes(nom) ? 1 : 0;
      this.d.repetitionArtiste = (1 - 0.06) * this.d.repetitionArtiste + 0.06 * revient;
    }

    /* --- 4. sa pente d'energie habituelle --- */
    if (cur.energy != null && joue.energy != null)
      this.d.sautEnergie = (1 - 0.07) * this.d.sautEnergie + 0.07 * clamp(joue.energy - cur.energy, -4, 4);

    this.d.n++;
    if (rang === 0) { this.d.pris++; this.d.prisPremier++; }
    else if (rang > 0) this.d.pris++;
    else this.d.ignore++;
    this._ranger();
  }

  /* La force de l'apprentissage : nulle au debut, pleine a 40. */
  force() {
    if (this.d.n < MINI) return 0;
    return clamp((this.d.n - MINI) / (PLEIN - MINI), 0, 1);
  }

  /** Ce qu'on passe au moteur. Neutre tant qu'on n'a pas assez vu. */
  reglages() {
    const f = this.force();
    if (!f) return { poids: {}, marge: undefined, variete: undefined, appris: false, force: 0 };
    const poids = {};
    for (const c of CRITERES)
      poids[c] = clamp(1 + AMPLITUDE * this.d.ema[c] * f, 0.55, 1.7);
    /* de -1 (il creuse) a +1 (il joue les tubes) */
    poids.pop = clamp(this.d.emaPop * 2.6 * f, -1, 1);
    /* le crible suit l'ecart observe, avec de la marge au-dessus :
       on veut pouvoir proposer un peu plus loin que ce qu'il fait
       d'habitude, pas exactement ce qu'il fait */
    const marge = this.d.ecartTempo > 0
      ? clamp(0.12 * (1 - f) + (this.d.ecartTempo * 2.4) * f, 0.06, 0.22)
      : undefined;
    const variete = clamp(1 + (0.5 - this.d.repetitionArtiste * 2.4) * f * 0.8, 0.3, 1.4);
    return { poids, marge, variete, appris: true, force: f };
  }

  /**
   * La courbe observee, plutot que celle qu'on impose.
   * Un DJ qui monte depuis six morceaux monte ; inutile de lui
   * demander d'appuyer sur un bouton pour le dire.
   */
  arcObserve(recents) {
    const e = (recents || []).slice(-6).map(t => (t && t.energy != null) ? t.energy : null).filter(x => x != null);
    if (e.length < 3) return null;
    /* pente par moindres carres, en points d'energie par morceau */
    const n = e.length, sx = (n - 1) * n / 2, sxx = (n - 1) * n * (2 * n - 1) / 6;
    let sy = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sy += e[i]; sxy += i * e[i]; }
    const pente = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    if (pente > 0.28) return 'up';
    if (pente < -0.28) return 'down';
    return 'hold';
  }

  /** Des phrases, pas des chiffres. Le DJ doit pouvoir contester. */
  resume() {
    const out = [];
    const n = this.d.n;
    if (n < MINI) {
      out.push({ t: 'Liaison observe', d: n + ' enchainement' + (n > 1 ? 's' : '') + ' sur ' + MINI +
        ' avant de commencer a s\'adapter. Rien n\'est modifie pour l\'instant.' });
      return out;
    }
    const r = this.reglages();
    const tauxPris = n ? Math.round(this.d.pris / n * 100) : 0;
    out.push({ t: 'Ce que tu prends', d: tauxPris + ' % de tes enchainements sortent des suggestions de Liaison' +
      (this.d.prisPremier ? ', dont ' + Math.round(this.d.prisPremier / n * 100) + ' % la premiere' : '') + '.' });

    const dit = (cle, haut, bas) => {
      const v = r.poids[cle];
      if (v == null) return;
      if (v >= 1.18) out.push({ t: haut.t, d: haut.d });
      else if (v <= 0.85) out.push({ t: bas.t, d: bas.d });
    };
    dit('h', { t: 'Tu tiens a l\'harmonie', d: 'Tu choisis des titres mieux accordes que la moyenne des propositions. Liaison remonte la tonalite dans le classement.' },
             { t: 'L\'harmonie te gene peu', d: 'Tu passes souvent des titres qui ne sont pas accordes. Liaison arrete d\'en faire une priorite.' });
    /* Le tempo se raconte a partir de l'ecart REELLEMENT mesure, pas
       du poids. Le poids dit « le tempo n'est pas ce qui decide chez
       lui », ce qui est vrai meme quand ses ecarts sont minuscules —
       et on se retrouvait alors a ecrire « tu oses les ecarts » juste
       au-dessus de « ton ecart habituel : 2,3 % ». Deux phrases
       exactes, cote a cote, qui se contredisent : c'est le genre de
       detail qui fait perdre confiance dans tout le reste. */
    dit('cr', { t: 'Tu suis le contexte', d: 'Tes choix collent aux genres du contexte choisi. Liaison y tient davantage.' },
              { t: 'Tu sors du contexte', d: 'Tu debordes souvent des genres attendus. Liaison ouvre.' });
    if (r.poids.pop >= 0.25) out.push({ t: 'Tu joues les tubes',
      d: 'Tu choisis nettement plus connu que ce qu\'on te propose. Liaison remonte les valeurs sures.' });
    else if (r.poids.pop <= -0.25) out.push({ t: 'Tu creuses',
      d: 'Tu choisis nettement moins connu que ce qu\'on te propose. Liaison sort des evidences.' });

    const p = Math.round(this.d.ecartTempo * 1000) / 10;
    if (this.d.ecartTempo > 0) {
      const c = this.d.ecartTempo < 0.025 ? 'Tu cales au BPM pres'
              : this.d.ecartTempo > 0.07 ? 'Tu oses les ecarts'
              : 'Ton ecart habituel';
      const d = p.toFixed(1).replace('.', ',') + ' % de tempo entre deux morceaux'
              + (this.d.ecartTempo < 0.025 ? ' — Liaison resserre sa recherche.'
                 : this.d.ecartTempo > 0.07 ? ' — Liaison elargit la sienne d\'autant.' : '.');
      out.push({ t: c, d: d });
    }
    const rep = Math.round(this.d.repetitionArtiste * 100);
    if (rep >= 12) out.push({ t: 'Tu rejoues tes artistes', d: 'Environ ' + rep + ' % du temps. Liaison arrete de t\'en empecher.' });
    if (Math.abs(this.d.sautEnergie) > 0.25)
      out.push({ t: 'Ta pente', d: this.d.sautEnergie > 0 ? 'Tu montes en moyenne d\'un demi-point d\'energie par morceau.' : 'Tu redescends plus souvent que tu ne montes.' });
    return out;
  }

  /* « Tout oublier » doit oublier tout de suite. _ranger() differe
     l'ecriture de quatre secondes avec un timer unref() : un clic
     suivi d'une fermeture dans la foulee laissait le fichier
     d'apprentissage intact. Le DJ croyait avoir efface. */
  oublier() {
    this.d = vide();
    this.ecrireMaintenant();
  }

  /** Ecrit sans attendre. Appele a la fermeture de l'application. */
  ecrireMaintenant() {
    if (!this.fichier) return;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._sale = false;
    ecrire.ecrireJSON(this.fichier, this.d);
  }
}

module.exports = { Gout, MINI, PLEIN };
