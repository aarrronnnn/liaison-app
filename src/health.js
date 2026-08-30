'use strict';
/* ============================================================
   La sante de la bibliotheque.

   Sur vingt mille morceaux accumules pendant quinze ans, il y a
   forcement des cadavres : des fichiers effaces dont la base garde
   la trace, des doublons achetes deux fois, des titres jamais
   analyses, des tonalites qui se contredisent. Aucun logiciel de
   mix ne dit lesquels — ils affichent la bibliotheque comme si
   tout allait bien.

   Ce module ne repare rien tout seul. Il compte, il nomme, et il
   dit ou aller. Reparer une tonalite, c'est le travail de
   rekordbox ou de Serato : eux ecrivent dans leur base, pas nous.
   Notre role est de rendre visible ce qui ne l'etait pas.

   Une regle tenue partout ici : on ne signale que ce qu'on peut
   prouver. « Ce fichier n'existe plus » est un fait. « Cette
   tonalite est fausse » n'en est pas un — on ecrit « les deux
   analyses ne sont pas d'accord », ce qui est vrai et laisse le
   DJ juge.
   ============================================================ */
const fs = require('fs');
const { normalize, camelot } = require('./engine');

/* ------------------------------------------------------------
   Deux tonalites sont-elles en desaccord ?

   Pas au sens strict : 8A et 8B sont relatives, 8A et 9A sont
   voisines sur la roue, et deux analyseurs qui les confondent ne
   se trompent pas vraiment — le mix tient quand meme. On ne
   signale que les ecarts qui s'entendent.
   ------------------------------------------------------------ */
function tonalitesEnDesaccord(a, b) {
  if (!a || !b) return false;
  if (a === b) return false;
  const A = camelot(a), B = camelot(b);
  if (!A.n || !B.n) return false;
  if (A.n === B.n) return false;                       /* relatif majeur/mineur */
  const d = Math.min((A.n - B.n + 12) % 12, (B.n - A.n + 12) % 12);
  return d > 1;                                        /* au-dela du voisin immediat */
}

/* Deux tempos en desaccord ? Le demi et le double ne comptent pas :
   un morceau a 140 lu comme 70 se mixe exactement pareil. */
function temposEnDesaccord(a, b) {
  if (!(a > 0) || !(b > 0)) return false;
  for (const r of [1, 2, 0.5, 3, 1 / 3]) {
    if (Math.abs(b * r - a) / a < 0.02) return false;
  }
  return true;
}

/* Deux morceaux sont-ils le meme, achete deux fois ?

   On ne compare pas les chemins — un doublon a justement deux
   chemins. On compare le titre et l'artiste mis a plat, puis la
   duree : c'est elle qui evite de confondre un original avec son
   remix, qui portent le meme nom et durent rarement pareil.

   Attention au piege : arrondir la duree par tranches de deux
   secondes ne donne pas une tolerance de deux secondes, ca donne
   des frontieres arbitraires. 290 s et 291 s tombent de part et
   d'autre d'une tranche et ne se voient plus, alors que 288 s et
   289 s se voient. Il faut donc grouper par nom, puis comparer
   les durees deux a deux avec un vrai ecart. */
function cleDoublon(t) {
  const n = normalize((t.artist || '') + ' ' + (t.title || ''));
  return n.length < 4 ? null : n;
}

/* Ecart tolere : 4 secondes, ou 2 % pour les morceaux longs. Un
   meme enregistrement encode deux fois varie de quelques dixiemes ;
   un edit ou un remix, de bien plus. */
function memeDuree(a, b) {
  if (!(a > 0) || !(b > 0)) return true;      /* duree inconnue : le nom decide */
  return Math.abs(a - b) <= Math.max(4, Math.min(a, b) * 0.02);
}

/* Decoupe un groupe de meme nom en sous-groupes de meme duree. */
function grouperParDuree(morceaux) {
  const groupes = [];
  for (const t of morceaux) {
    const g = groupes.find(x => memeDuree(x[0].duration, t.duration));
    if (g) g.push(t); else groupes.push([t]);
  }
  return groupes;
}

/**
 * Examine la bibliotheque.
 *
 * @param {Array} library
 * @param {object} opt { verifierFichiers: bool }
 * @returns {object} le bilan, pret a afficher
 */
function bilan(library, opt) {
  opt = opt || {};
  const n = library.length;
  const vide = { n: 0, exemples: [] };
  const R = {
    total: n,
    sansBpm: { n: 0, exemples: [] },
    sansKey: { n: 0, exemples: [] },
    sansArtiste: { n: 0, exemples: [] },
    introuvables: { n: 0, exemples: [] },
    doublons: { n: 0, groupes: [] },
    tonaliteDouteuse: { n: 0, exemples: [] },
    tempoDouteux: { n: 0, exemples: [] },
    illisibles: { n: 0, exemples: [] },
    deduits: { bpm: 0, key: 0 },
    analyses: 0,
    aAnalyser: 0
  };
  if (!n) return Object.assign(R, { note: 'Aucune bibliotheque chargee.', score: null });

  const bref = t => ({ id: t.id, title: t.title || '(sans titre)', artist: t.artist || '',
                       bpm: t.bpm || 0, key: t.key || '', path: t.path || '' });
  const pousser = (b, t) => { b.n++; if (b.exemples.length < 12) b.exemples.push(bref(t)); };

  /* --- passe unique sur la bibliotheque --- */
  const parCle = new Map();
  for (const t of library) {
    if (!(t.bpm > 0)) pousser(R.sansBpm, t);
    if (!t.key) pousser(R.sansKey, t);
    if (!String(t.artist || '').trim()) pousser(R.sansArtiste, t);
    if (t.illisible) pousser(R.illisibles, t);
    if (t.analyzed) R.analyses++; else R.aAnalyser++;
    if (t.bpmDeduit) R.deduits.bpm++;
    if (t.keyDeduite) R.deduits.key++;

    /* desaccords entre notre mesure et celle du logiciel */
    if (t.key && t.mKey && !t.keyDeduite && t.mKeyConf >= 0.65 && tonalitesEnDesaccord(t.key, t.mKey)) {
      if (R.tonaliteDouteuse.exemples.length < 12)
        R.tonaliteDouteuse.exemples.push(Object.assign(bref(t), { mesure: t.mKey }));
      R.tonaliteDouteuse.n++;
    }
    if (t.bpm > 0 && t.mBpm > 40 && !t.bpmDeduit && temposEnDesaccord(t.bpm, t.mBpm)) {
      if (R.tempoDouteux.exemples.length < 12)
        R.tempoDouteux.exemples.push(Object.assign(bref(t), { mesure: Math.round(t.mBpm * 10) / 10 }));
      R.tempoDouteux.n++;
    }

    const k = cleDoublon(t);
    if (k) {
      if (!parCle.has(k)) parCle.set(k, []);
      parCle.get(k).push(t);
    }
  }

  /* --- doublons --- */
  for (const [, memeNom] of parCle) {
    if (memeNom.length < 2) continue;
    for (const groupe of grouperParDuree(memeNom)) {
      if (groupe.length < 2) continue;
      R.doublons.n += groupe.length - 1;       /* on compte les copies en trop */
      if (R.doublons.groupes.length < 12)
        R.doublons.groupes.push({
          titre: (groupe[0].artist ? groupe[0].artist + ' — ' : '') + groupe[0].title,
          copies: groupe.map(t => ({ id: t.id, path: t.path || '', bpm: t.bpm || 0,
                                     duree: Math.round(t.duration || 0) }))
        });
    }
  }

  /* --- fichiers disparus ---
     Un statSync par morceau : c'est du disque, pas du calcul, mais
     sur vingt mille fichiers et un disque externe ca peut prendre
     plusieurs secondes. On ne le fait donc que sur demande. */
  if (opt.verifierFichiers) {
    for (const t of library) {
      if (!t.path) continue;
      try { fs.accessSync(t.path); }
      catch (e) { pousser(R.introuvables, t); }
    }
  } else {
    R.introuvables = Object.assign({}, vide, { nonVerifie: true });
  }

  /* --- une note sur 100 ---
     Elle ne sert pas a classer : elle sert a savoir s'il faut
     s'en occuper ce soir ou dans six mois. Les pertes sont
     ponderees par ce que le defaut coute au moteur. Un morceau
     sans BPM ne peut pas etre propose du tout : c'est le pire.
     Un doublon fait juste du bruit. */
  const part = x => x / n;
  let score = 100;
  score -= part(R.sansBpm.n) * 45;
  score -= part(R.sansKey.n) * 20;
  score -= part(R.introuvables.n) * 25;
  score -= part(R.doublons.n) * 8;
  score -= part(R.sansArtiste.n) * 6;
  score -= part(R.tonaliteDouteuse.n) * 6;
  score -= part(R.illisibles.n) * 10;
  R.score = Math.max(0, Math.min(100, Math.round(score)));

  /* --- ce qu'il faut faire, dans l'ordre du gain ---
     Chaque ligne dit le nombre, la consequence, et le geste. Pas
     de conseil sans chiffre, pas de chiffre sans consequence. */
  const actions = [];
  if (R.sansBpm.n)
    actions.push({ cle: 'bpm', n: R.sansBpm.n, gravite: 'haute',
      titre: R.sansBpm.n + ' morceaux sans BPM',
      effet: 'Ils ne peuvent jamais etre proposes : sans tempo, aucun enchainement n\'est calculable.',
      geste: 'Selectionne-les dans ton logiciel et lance son analyse. Liaison estimera le tempo en attendant, mais la grille de ton logiciel sera toujours meilleure.' });
  if (R.introuvables.n)
    actions.push({ cle: 'fichiers', n: R.introuvables.n, gravite: 'haute',
      titre: R.introuvables.n + ' fichiers introuvables',
      effet: 'Ta base les affiche encore, mais ils ne sont plus sur le disque. En cabine, tu les chercherais pour rien.',
      geste: 'Disque externe non branche ? Rebranche-le. Sinon, retire-les de ta base.' });
  if (R.sansKey.n)
    actions.push({ cle: 'key', n: R.sansKey.n, gravite: 'moyenne',
      titre: R.sansKey.n + ' morceaux sans tonalite',
      effet: 'La roue de Camelot ne les note pas : ils remontent moins souvent qu\'ils ne le meritent.',
      geste: 'Meme geste : analyse dans ton logiciel. Liaison comble en attendant, quand il est sur de lui.' });
  if (R.doublons.n)
    actions.push({ cle: 'doublons', n: R.doublons.n, gravite: 'basse',
      titre: R.doublons.n + ' copies en double',
      effet: 'Le meme morceau occupe deux places dans les suggestions, au detriment d\'un autre.',
      geste: 'Compare les chemins ci-dessous et garde la meilleure version.' });
  if (R.tonaliteDouteuse.n)
    actions.push({ cle: 'tonalite', n: R.tonaliteDouteuse.n, gravite: 'basse',
      titre: R.tonaliteDouteuse.n + ' tonalites en desaccord',
      effet: 'Ton logiciel et Liaison ne lisent pas la meme tonalite. L\'un des deux se trompe — souvent sur un morceau au tag ancien ou recopie.',
      geste: 'Reanalyse ces titres-la dans ton logiciel. Liaison garde la tonalite de ton logiciel en attendant : on ne decide pas a ta place.' });
  if (R.tempoDouteux.n)
    actions.push({ cle: 'tempo', n: R.tempoDouteux.n, gravite: 'moyenne',
      titre: R.tempoDouteux.n + ' tempos en desaccord',
      effet: 'Un ecart de tempo qui n\'est ni un demi ni un double : l\'un des deux BPM est faux, et un BPM faux fait rater le calage.',
      geste: 'A verifier en priorite : c\'est le defaut qui s\'entend le plus en cabine.' });
  if (R.sansArtiste.n)
    actions.push({ cle: 'artiste', n: R.sansArtiste.n, gravite: 'basse',
      titre: R.sansArtiste.n + ' morceaux sans artiste',
      effet: 'Les invites qui tapent un nom d\'artiste ne les trouveront pas.',
      geste: 'Souvent des fichiers nommes a la main. Le titre suffit au moteur, mais pas a la recherche.' });
  if (R.illisibles.n)
    actions.push({ cle: 'illisibles', n: R.illisibles.n, gravite: 'moyenne',
      titre: R.illisibles.n + ' fichiers illisibles',
      effet: 'Liaison n\'a pas reussi a les decoder : fichier tronque, format exotique, ou protection.',
      geste: 'Essaie de les ouvrir dans ton logiciel. S\'il n\'y arrive pas non plus, ils sont perdus.' });

  R.actions = actions;
  R.note = actions.length
    ? actions.length + (actions.length > 1 ? ' points a regarder.' : ' point a regarder.')
    : 'Rien a signaler : ta bibliotheque est propre.';
  return R;
}

module.exports = { bilan, tonalitesEnDesaccord, temposEnDesaccord, cleDoublon, memeDuree, grouperParDuree };
