'use strict';
/* ============================================================
   Le banc d'essai — est-ce que le moteur s'ameliore, ou est-ce
   qu'on le croit ?

   Toute modification du moteur se defend bien a l'oral. La seule
   facon de savoir, c'est de rejouer le passe : prendre une vraie
   soiree, se placer a chaque transition, CACHER le morceau qui a
   ete joue, demander ses propositions, et regarder s'il y etait.

   Ce que ce banc mesure :

     top 1  — le morceau joue etait notre premiere proposition
     top 5  — il etait dans la liste

   Ce qu'il ne mesure PAS, et il faut le savoir : le vivier est
   fait des morceaux que ce DJ a deja joues, pas de sa
   bibliotheque entiere. Les chiffres absolus sont donc
   optimistes. Ce qui compte n'est pas leur valeur, c'est leur
   ECART entre deux versions du moteur — et pour ca, la mesure
   est juste.

   Usage :
     node build/banc-suggestions.js                  (jeu d'essai)
     node build/banc-suggestions.js ~/chemin/sets.json
   Sur un Mac, le fichier reel est dans :
     ~/Library/Application Support/Liaison/sets.json
   ============================================================ */
const fs = require('fs');
const engine = require('../src/engine.js');
const lib = require('../src/library.js');

function charger(chemin) {
  if (!chemin) return null;
  try { return JSON.parse(fs.readFileSync(chemin, 'utf8')); }
  catch (e) { console.error('Impossible de lire ' + chemin + ' — ' + e.message); process.exit(1); }
}

/* ------------------------------------------------------------
   Un jeu d'essai, pour que le banc tourne meme sans historique.
   Il imite un vrai mariage : montee, plateau, classiques, fin.
   ------------------------------------------------------------ */
function jeuDEssai() {
  const familles = [
    ['Variete francaise', 1985, 122], ['Disco', 1978, 120], ['Funk', 1976, 112],
    ['Pop', 2016, 118], ['House', 2021, 124], ['Tech House', 2024, 126],
    ['EDM', 2013, 128], ['Rap FR', 2019, 96], ['Latin', 2020, 98],
    ['Motown', 1968, 116], ['Rock', 1982, 130], ['Hymne', 1990, 124]
  ];
  const bib = [];
  let i = 0;
  for (const [g, an, bpm] of familles)
    for (let k = 0; k < 14; k++, i++)
      bib.push({ path: '/m/' + i + '.mp3', artist: g + ' ' + (k % 7), title: g + ' ' + k,
                 genre: g, year: an + (k % 9) - 4, bpm: bpm + (k % 5) - 2,
                 key: (1 + (k % 12)) + (k % 2 ? 'A' : 'B'), duration: 210, pop: 40 + (k * 7) % 55 });
  const L = lib.finalize(bib);
  for (const t of L) { t.analyzed = true; t.energy = 3 + (t.id % 7); t.timbre = [t.id % 10, (t.id * 3) % 10, (t.id * 7) % 10]; }

  /* Ce DJ a des habitudes : variete -> disco -> funk -> motown,
     puis house -> tech house. C'est ce que le banc doit retrouver. */
  const suite = ['Variete francaise', 'Disco', 'Funk', 'Motown', 'Variete francaise',
                 'House', 'Tech House', 'House', 'Pop', 'Rock', 'Hymne', 'Disco'];
  const sets = [];
  for (let s = 0; s < 6; s++) {
    const played = [];
    for (let n = 0; n < 22; n++) {
      const g = suite[(n + s) % suite.length];
      const choix = L.filter(t => t.genre === g)[(n * 3 + s) % 14];
      played.push({ id: choix.id, title: choix.title, artist: choix.artist, bpm: choix.bpm,
                    key: choix.key, energy: choix.energy, tags: choix.tags, at: Date.now() + n * 200000 });
    }
    sets.push({ id: s, name: 'Essai ' + s, played: played });
  }
  return { sets, bib: L };
}

/** Reconstruit un vivier a partir de ce qui a ete joue. */
function vivierDepuis(sets) {
  const vus = new Map();
  for (const s of sets) for (const p of s.played || []) {
    if (p.id == null || vus.has(p.id)) continue;
    vus.set(p.id, { id: p.id, artist: p.artist, title: p.title, bpm: p.bpm, key: p.key,
                    energy: p.energy, tags: p.tags || [], analyzed: p.energy != null,
                    timbre: [5, 5, 5], pop: 50, year: p.year || null, duration: 210, out: 32 });
  }
  return Array.from(vus.values());
}

function mesurer(sets, vivier, opts, titre) {
  let n = 0, top1 = 0, top3 = 0, top5 = 0, rangs = 0, trouves = 0;
  const parId = new Map(vivier.map(t => [t.id, t]));
  for (const s of sets) {
    const p = s.played || [];
    const joues = [];
    for (let i = 1; i < p.length; i++) {
      const cur = parId.get(p[i - 1].id), vrai = p[i].id;
      joues.push(parId.get(p[i - 1].id));
      if (!cur || !parId.has(vrai)) continue;
      const r = engine.suggest(cur, vivier, Object.assign({ limit: 5, recent: joues.filter(Boolean) }, opts));
      n++;
      const rang = r.findIndex(x => x.track.id === vrai);
      if (rang === 0) top1++;
      if (rang >= 0 && rang < 3) top3++;
      if (rang >= 0) { top5++; rangs += rang + 1; trouves++; }
    }
  }
  const pc = x => ((100 * x / Math.max(1, n)).toFixed(1) + ' %').padStart(7);
  console.log('  ' + titre.padEnd(34) +
              'top 1 ' + pc(top1) + '   top 3 ' + pc(top3) + '   top 5 ' + pc(top5) +
              '   rang moyen ' + (trouves ? (rangs / trouves).toFixed(2) : '—') +
              '   (' + n + ' transitions)');
  return { n, top1, top3, top5 };
}

const chemin = process.argv[2];
let sets, vivier;
if (chemin) {
  sets = charger(chemin);
  if (!Array.isArray(sets)) { console.error('Ce fichier ne ressemble pas a un historique Liaison.'); process.exit(1); }
  vivier = vivierDepuis(sets);
  /* ------------------------------------------------------------
     « 4 soirees, 0 morceaux distincts. »

     C'est ce que ce banc a repondu la premiere fois qu'on l'a
     lance sur un vrai historique, et ca ne dit RIEN : le fichier
     est-il vide, mal lu, ou les soirees n'ont-elles jamais
     enregistre de morceau ? Un outil de mesure qui rend zero sans
     dire pourquoi envoie chercher une panne qui n'existe peut-etre
     pas. On compte donc a chaque etape.
     ------------------------------------------------------------ */
  let entrees = 0, avecId = 0, avecTempo = 0, vides = 0;
  for (const s of sets) {
    const p = Array.isArray(s && s.played) ? s.played : null;
    if (!p || !p.length) { vides++; continue; }
    for (const x of p) {
      entrees++;
      if (x && x.id != null) avecId++;
      if (x && x.bpm > 0) avecTempo++;
    }
  }
  console.log('historique reel : %d soirees, %d morceaux distincts', sets.length, vivier.length);
  console.log('  soirees sans aucun morceau enregistre : %d sur %d', vides, sets.length);
  console.log('  morceaux joues au total : %d  (avec identifiant : %d, avec tempo : %d)',
              entrees, avecId, avecTempo);
  if (!vivier.length) {
    console.log('');
    if (entrees === 0) {
      console.log('Aucun morceau n\'a ete enregistre dans ces soirees.');
      console.log('Liaison n\'inscrit un titre que lorsqu\'il DETECTE un changement de');
      console.log('morceau sur un deck. Une soiree ouverte puis refermee sans que');
      console.log('l\'application ait vu tourner de musique reste vide — c\'est normal,');
      console.log('et c\'est sans doute ce qui s\'est passe ici.');
      console.log('');
      console.log('Pour remplir le banc : lance Liaison, joue une vingtaine de titres');
      console.log('d\'affilee dans ton logiciel, puis relance cette commande.');
    } else if (avecId === 0) {
      console.log('Les morceaux sont bien la, mais aucun ne porte d\'identifiant :');
      console.log('cet historique vient d\'une version anterieure de Liaison et ne');
      console.log('peut pas etre rejoue.');
    }
    console.log('');
    console.log('En attendant, le jeu d\'essai donne une mesure comparable :');
    console.log('    node build/banc-suggestions.js');
    process.exit(0);
  }
  console.log('');
} else {
  const j = jeuDEssai();
  sets = j.sets; vivier = vivierDepuis(j.sets);
  console.log('jeu d\'essai : %d soirees, %d morceaux distincts', sets.length, vivier.length);
  console.log('(passe le chemin de ton sets.json en argument pour mesurer sur tes vraies soirees)\n');
}

const AFF = engine.affinites.construire(sets);
console.log('memoire des enchainements : ' + AFF.n + ' transitions' +
            (AFF.assez ? '' : ' — trop peu, l\'axe se tait') + '\n');

console.log('MESURE');
/* « Avant » n'est pas un autre moteur : c'est le meme, avec les
   nouveaux axes ramenes a leur poids minimum. On compare donc bien
   l'apport des axes, pas deux codes differents. */
const avant = mesurer(sets, vivier, { poids: { fr: 0.5, af: 0.5, pl: 0.5, pa: 0.5 } }, 'moteur seul');
const apres = mesurer(sets, vivier, { affinites: AFF }, 'les quatre axes ajoutes');

const d = (apres.top5 - avant.top5) / Math.max(1, avant.top5) * 100;
console.log('\necart sur le top 5 : ' + (d >= 0 ? '+' : '') + d.toFixed(1) + ' %');
if (apres.top5 < avant.top5)
  console.log('Les nouveaux axes n\'aident pas sur ce jeu. Il ne faut pas les garder tels quels.');
