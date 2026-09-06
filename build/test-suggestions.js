'use strict';
/* ============================================================
   « David Guetta avec les chutes du Niagara. »

   C'est le rapport de bug qui a produit ce fichier, et il decrivait
   un vrai defaut, pas une impression.

   Le moteur note six axes. L'energie en pese 15 %, le timbre 14 %.
   Quand ces deux mesures manquaient — morceau pas encore analyse —
   le calcul les remplacait par des valeurs NEUTRES :

     energyScore(5, 5, 'up')  = 77,6 sur 100
     timbreScore(null, null)  = 60   sur 100

   Autrement dit : ne rien savoir rapportait 29 % de la note,
   gratuitement. Un morceau reellement mesure mais dont l'energie
   collait moyennement tombait plus bas. L'inconnu battait le connu.

   Une nappe d'ambiance passait donc devant un morceau de club :
   BPM invente par rekordbox, pas de tonalite donc rien a perdre sur
   l'harmonie, et les 29 % restants offerts.

   Ces essais figent le comportement corrige :
     — un morceau non mesure ne passe jamais devant un morceau
       mesure qui colle ;
     — tant qu'il existe assez de morceaux mesures, eux seuls sont
       proposes ;
     — mais sur une bibliotheque fraiche, ou rien n'est encore
       analyse, l'application propose quand meme quelque chose.
   ============================================================ */
const engine = require('../src/engine.js');
const lib = require('../src/library.js');

/* ------------------------------------------------------------
   LA LECON DU PREMIER CORRECTIF.

   Ces essais fabriquaient des morceaux a la main, avec energie et
   timbre a null. La correction passait donc au vert — et ne
   changeait rien en cabine.

   Parce que finalize(), le vrai chemin, POSE une energie de 5 et
   un timbre [5,5,5] sur tous les morceaux, analyses ou non, pour
   que le widget s'ouvre en trois secondes. Rien n'est jamais nul.
   Et timbreScore([5,5,5], [5,5,5]) vaut 100 sur 100 : le morceau
   jamais ecoute recevait le maximum, pas une valeur neutre.

   Tout ce qui suit passe donc par finalize(). Un essai qui ne
   traverse pas le vrai chemin ne prouve rien.
   ------------------------------------------------------------ */
function viaBibliotheque(bruts) {
  const out = lib.finalize(bruts.map(b => Object.assign({}, b)));
  /* finalize ne pose pas « analyzed » : c'est l'analyse de fond qui
     le fait. On rejoue donc ce qu'elle aurait ecrit. */
  for (let i = 0; i < out.length; i++) {
    const src = bruts[i];
    if (src.analyse) {
      out[i].analyzed = true;
      out[i].energy = src.energy;
      out[i].timbre = src.timbre;
    }
  }
  return out;
}

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(56),
              detail ? '  — ' + detail : '');
}

/* ---------- le morceau qui tourne : un gros titre de club ---------- */
const GUETTA = { path: '/m/guetta.mp3', artist: 'David Guetta', title: 'Titles',
  bpm: 128, key: '8A', duration: 200, genre: 'Dance', pop: 90, vocal: true,
  analyse: true, energy: 8, timbre: [0.6, 0.5, 0.7] };

/* ---------- la nappe d'ambiance, jamais analysee ----------
   Elle porte un BPM parce que rekordbox en invente un sur a peu
   pres tout, et aucune tonalite. Elle n'a ni energie ni timbre. */
const NIAGARA = { path: '/m/niagara.mp3', artist: 'Ambiance',
  title: 'Les chutes du Niagara', bpm: 127, key: '8A', duration: 300,
  genre: 'Dance', pop: 60 };   /* jamais analyse */

/* ---------- un vrai enchainement, mesure ----------
   Attention a ne pas le rendre PARFAIT : un morceau dont l'energie
   et le timbre collent au millimetre battrait la nappe meme avec
   l'ancien calcul, et l'essai passerait pour de mauvaises raisons.
   Ce qu'on veut reproduire, c'est le cas reel : un enchainement
   correct mais pas ideal — le genre de titre qu'un DJ joue tous les
   soirs — qui se faisait doubler par un fichier jamais ecoute. */
function titreMesure(i) {
  return { path: '/m/ok' + i + '.mp3', artist: 'Artiste ' + i, title: 'Titre ' + i,
    bpm: 127 + (i % 3), key: '8A', duration: 210, genre: 'Dance', pop: 60,
    analyse: true, energy: 6, timbre: [0.2, 0.9, 0.1] };
}
function titreBrut(i) {   /* dans la bibliotheque, pas encore analyse */
  const t = titreMesure(i); delete t.analyse; delete t.energy; delete t.timbre;
  return t;
}
/* Les morceaux sont identifies par leur chemin apres finalize :
   on retrouve donc le bon par son fichier, pas par un id invente. */
const nom = t => (t.path || '').replace('/m/', '').replace('.mp3', '');

/* ============================================================
   1. Le cas signale : la nappe contre un enchainement correct.
   ============================================================ */
{
  const bib = viaBibliotheque([GUETTA, NIAGARA, titreMesure(1)]);
  const cur = bib[0];
  const r = engine.suggest(cur, bib, { limit: 5, arc: 'up' });
  const noms = r.map(x => nom(x.track));
  const rOk = noms.indexOf('ok1'), rNap = noms.indexOf('niagara');
  verifier('1. la nappe ne passe pas devant le titre mesure',
           rOk !== -1 && (rNap === -1 || rOk < rNap),
           'ordre : ' + noms.join(', ') +
           '  (notes : ' + r.map(x => nom(x.track) + '=' + x.total).join(' ') + ')');
}

/* ============================================================
   2. Assez de morceaux mesures : la nappe sort de la liste.
   ============================================================ */
{
  const bruts = [GUETTA, NIAGARA];
  for (let i = 1; i <= 12; i++) bruts.push(titreMesure(i));
  const bib = viaBibliotheque(bruts);
  const r = engine.suggest(bib[0], bib, { limit: 5, arc: 'up' });
  verifier('2. avec 12 titres mesures, la nappe disparait',
           !r.some(x => nom(x.track) === 'niagara'), r.length + ' propositions');
  verifier('2bis. les cinq proposes sont tous analyses',
           r.length === 5 && r.every(x => x.track.analyzed), '');
}

/* ============================================================
   3. Bibliotheque fraiche : rien n'est analyse. Il FAUT proposer.
   ============================================================ */
{
  const bruts = [GUETTA];
  for (let i = 1; i <= 6; i++) bruts.push(titreBrut(i));
  const bib = viaBibliotheque(bruts);
  const r = engine.suggest(bib[0], bib, { limit: 5, arc: 'up' });
  verifier('3. rien d\'analyse : l\'app propose quand meme',
           r.length > 0, r.length + ' propositions');
}

/* ============================================================
   4. LE BUG DU TERRAIN : le morceau joue n'a pas de tempo.

   Vingt-deux mille morceaux en bibliotheque, un titre charge dont
   le tag de tempo manque, et l'application repondait « rien ne se
   cale ». C'etait une rustine contre une division par zero, et
   elle rendait l'application inutilisable sur un seul mauvais tag.
   ============================================================ */
{
  const sansBpm = Object.assign({}, GUETTA, { bpm: 0 });   /* tag absent */
  const bruts = [sansBpm];
  for (let i = 1; i <= 8; i++) bruts.push(titreMesure(i));
  const bib = viaBibliotheque(bruts);
  const cur = bib[0];
  verifier('4. le morceau en cours a bien un tempo nul apres import',
           cur.bpm == null, 'bpm = ' + cur.bpm);
  const r = engine.suggest(cur, bib, { limit: 5, arc: 'up' });
  verifier('4bis. sans tempo, l\'app propose quand meme',
           r.length === 5, r.length + ' propositions');
  const sos = engine.rescue(cur, bib, { limit: 3 });
  verifier('4ter. le bouton SOS repond aussi',
           sos.length > 0, sos.length + ' propositions');
}

/* ============================================================
   5. Le crible de tempo tient quand le tempo est connu.
   ============================================================ */
{
  const lent = titreMesure(9); lent.bpm = 90; lent.path = '/m/lent.mp3';
  const bib = viaBibliotheque([GUETTA, lent, titreMesure(1)]);
  const r = engine.suggest(bib[0], bib, { limit: 5, arc: 'up' });
  verifier('5. un titre a 90 BPM reste ecarte a 128',
           !r.some(x => nom(x.track) === 'lent'), '');
}

/* ============================================================
   6. Le meme morceau, deux fois dans la meme nuit.

   Mesure sur une soiree simulee de 120 enchainements et 22 000
   titres : 82 morceaux distincts. Trente-huit repetitions — un
   tube repasse a une heure d'intervalle, et c'est la salle qui
   l'entend avant le DJ.

   Le moteur se souvenait des artistes et des genres joues, jamais
   des MORCEAUX. Le widget, lui, affichait bien une pastille
   « deja passe » : on signalait le probleme au lieu de l'eviter.

   C'est une penalite et non un interdit — sur une petite
   bibliotheque, un morceau deja joue vaut mieux qu'une liste
   vide — mais elle doit suffire a le faire passer derriere
   n'importe quelle alternative correcte.
   ============================================================ */
{
  const bruts = [GUETTA];
  for (let i = 1; i <= 12; i++) bruts.push(titreMesure(i));
  const bib = viaBibliotheque(bruts);
  const cur = bib[0];

  /* sans memoire : on releve le favori du moteur */
  const avant = engine.suggest(cur, bib, { limit: 5, arc: 'up' });
  const favori = avant[0].track;

  /* on le joue, puis on redemande */
  const apres = engine.suggest(cur, bib, { limit: 5, arc: 'up', recent: [favori] });
  const rang = apres.findIndex(x => x.track.id === favori.id);
  verifier('6. un morceau joue ce soir ne revient pas en tete',
           rang !== 0, rang === -1 ? 'sorti de la liste' : 'retombe en position ' + (rang + 1));

  /* ---------- le temoin ----------
     Sans la penalite, le favori restait le favori : on le verifie
     en neutralisant la memoire des titres. */
  const M = engine.memoireDe([favori]);
  const avecMemoire = engine.penaliteVariete(favori, M, {});
  const sansMemoire = engine.penaliteVariete(favori, M, { rejeu: true });
  console.log('  temoin — penalite du deja-joue : %d avec, %d sans',
              Math.round(avecMemoire), Math.round(sansMemoire));
  verifier('6bis. et le sauvetage, lui, a le droit de le rejouer',
           sansMemoire > avecMemoire, 'le SOS ignore le deja-joue, par choix');

  /* ---------- rien d'autre a proposer ----------
     Un seul candidat, deja joue : il doit quand meme sortir. */
  const duo = viaBibliotheque([GUETTA, titreMesure(1)]);
  const seul = engine.suggest(duo[0], duo, { limit: 5, arc: 'up', recent: [duo[1]] });
  verifier('6ter. mais il ressort s\'il n\'y a rien d\'autre',
           seul.length === 1, seul.length + ' proposition');
}

if (echecs) {
  console.error('\n' + echecs + ' cas de suggestion en echec.');
  process.exit(1);
}
console.log('\nsuggestions : l\'inconnu ne passe plus devant le connu.');
