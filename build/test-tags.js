'use strict';
/* ============================================================
   « Si un son sur iTunes a des infos erronees, on est d'accord
     qu'on ne les prend pas en compte ? »

   On n'etait pas d'accord, justement. Liaison MESURE le tempo et
   la tonalite de chaque morceau, health.js SAIT deja reperer
   quand le tag les contredit, et le moteur utilisait le tag quand
   meme. Le commentaire du code l'assumait : « on ne tranche pas,
   on marque, et le DJ ira reanalyser dans SON logiciel ».

   C'etait poli et c'etait faux. Un tempo errone fausse le crible,
   la note de tempo, le plan de mix et le plancher — toute la
   soiree, sur ce morceau. Et une bibliotheque iTunes de quinze ans
   en compte des centaines.

   Ce fichier fige la nouvelle regle : on tranche quand on est sur,
   on ne touche a rien quand on ne l'est pas, et on garde toujours
   l'ancienne valeur pour pouvoir la montrer.
   ============================================================ */
const an = require('../src/analysis.js');
const analyze = require('../src/analyze.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(56),
              detail ? '  — ' + detail : '');
}

/* ---------- 1. ce qui est un desaccord, et ce qui n'en est pas ---------- */
{
  const cas = [
    ['128 contre 128   : aucun',        an.desaccordTempo(128, 128), false],
    ['140 contre 70    : la moitie',    an.desaccordTempo(140, 70), false],
    ['70 contre 140    : le double',    an.desaccordTempo(70, 140), false],
    ['120 contre 40    : le tiers',     an.desaccordTempo(120, 40), false],
    ['128 contre 97    : desaccord',    an.desaccordTempo(128, 97), true],
    ['122 contre 174   : desaccord',    an.desaccordTempo(122, 174), true],
    ['tag absent       : on se tait',   an.desaccordTempo(0, 128), false]
  ];
  for (const [quoi, obtenu, attendu] of cas)
    verifier('1. ' + quoi, obtenu === attendu, obtenu ? 'desaccord' : 'accord');

  verifier('1bis. 8A contre 8B : relatif, pas un desaccord',
           an.desaccordTonalite('8A', '8B') === false);
  verifier('1ter. 8A contre 9A : voisin immediat, on laisse',
           an.desaccordTonalite('8A', '9A') === false);
  verifier('1quater. 8A contre 2A : desaccord franc',
           an.desaccordTonalite('8A', '2A') === true);
}

/* ---------- 2. la confiance de la mesure de tempo ----------
   Calibree sur de vrais fichiers audio fabriques pour l'essai :
   une battue nette rend 0,57 a 0,70, une piste sans pulsation
   plafonne a 0,47. Le seuil est a 0,55, entre les deux. */
{
  verifier('2. le seuil separe bien les deux mondes',
           an.SUR_TEMPO > 0.47 && an.SUR_TEMPO < 0.57, 'seuil ' + an.SUR_TEMPO);

  const fr = 86.13;
  const flux = (bpm, bruit) => {
    const n = 1200, f = new Float64Array(n), lag = (60 / bpm) * fr;
    let g = 12345;
    const rnd = () => ((g = g * 1103515245 + 12345 | 0) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) f[i] = bruit * rnd();
    for (let k = 0; k * lag < n; k++) f[Math.round(k * lag)] += 1;
    return f;
  };
  const net = analyze.estimateBPM(flux(124, 0.02), fr);
  const plat = analyze.estimateBPM(new Float64Array(1200).fill(0.5), fr);
  verifier('2bis. une pulsation nette est trouvee',
           Math.abs(net.bpm - 124) < 1, net.bpm + ' BPM');
  verifier('2ter. et un signal sans attaque n\'inspire aucune confiance',
           plat.confiance <= 0.05, 'confiance ' + plat.confiance);
  verifier('2quater. la confiance decroit quand le rythme se brouille',
           analyze.estimateBPM(flux(124, 0.02), fr).confiance >
           analyze.estimateBPM(flux(124, 3.0), fr).confiance,
           analyze.estimateBPM(flux(124, 0.02), fr).confiance + ' contre ' +
           analyze.estimateBPM(flux(124, 3.0), fr).confiance);
}

/* ---------- 3. la correction, de bout en bout ---------- */
{
  /* On rejoue ce que fait AnalysisService quand un resultat arrive. */
  function appliquer(t, patch) {
    if (!t.key && patch.mKey && patch.mKeyConf >= 0.6) { t.key = patch.mKey; t.keyDeduite = true; }
    if (!(t.bpm > 0) && patch.mBpm > 40) { t.bpm = Math.round(patch.mBpm * 10) / 10; t.bpmDeduit = true; }
    if (t.bpm > 0 && patch.mBpm > 40 && patch.mBpmConf >= an.SUR_TEMPO &&
        !t.bpmDeduit && an.desaccordTempo(t.bpm, patch.mBpm)) {
      t.bpmTag = t.bpm; t.bpm = Math.round(patch.mBpm * 10) / 10; t.bpmCorrige = true;
    }
    if (t.key && patch.mKey && patch.mKeyConf >= an.SUR_TONALITE &&
        !t.keyDeduite && an.desaccordTonalite(t.key, patch.mKey)) {
      t.keyTag = t.key; t.key = patch.mKey; t.keyCorrigee = true;
    }
    return t;
  }

  const menteur = appliquer({ bpm: 97, key: '2A' },
    { mBpm: 128.2, mBpmConf: 0.66, mKey: '8A', mKeyConf: 0.80 });
  verifier('3. un tag de tempo faux est corrige',
           menteur.bpm === 128.2 && menteur.bpmCorrige === true,
           '97 -> ' + menteur.bpm);
  verifier('3bis. et l\'ancienne valeur est gardee', menteur.bpmTag === 97);
  verifier('3ter. la tonalite fausse aussi', menteur.key === '8A' && menteur.keyTag === '2A');

  const doute = appliquer({ bpm: 97, key: '2A' },
    { mBpm: 128.2, mBpmConf: 0.40, mKey: '8A', mKeyConf: 0.80 });
  verifier('4. mesure peu sure : on ne touche a RIEN',
           doute.bpm === 97 && !doute.bpmCorrige, 'reste a ' + doute.bpm);

  const moitie = appliquer({ bpm: 140 }, { mBpm: 70, mBpmConf: 0.90 });
  verifier('5. la moitie n\'est pas une erreur : on ne corrige pas',
           moitie.bpm === 140 && !moitie.bpmCorrige, 'reste a ' + moitie.bpm);

  const vide = appliquer({ bpm: 0, key: null },
    { mBpm: 124.5, mBpmConf: 0.30, mKey: '5A', mKeyConf: 0.62 });
  verifier('6. un tag ABSENT est comble meme sans grande confiance',
           vide.bpm === 124.5 && vide.bpmDeduit === true, 'comble a ' + vide.bpm);
  verifier('6bis. et il n\'est pas marque comme corrige', !vide.bpmCorrige);
  verifier('6ter. la tonalite absente aussi', vide.key === '5A' && vide.keyDeduite === true);

  const voisine = appliquer({ key: '8A', bpm: 128 },
    { mBpm: 128, mBpmConf: 0.9, mKey: '9A', mKeyConf: 0.95 });
  verifier('7. une tonalite voisine ne declenche rien',
           voisine.key === '8A' && !voisine.keyCorrigee, 'reste en ' + voisine.key);
}

if (echecs) {
  console.error('\n' + echecs + ' cas de tags en echec.');
  process.exit(1);
}
console.log('\ntags : on comble les trous, et on corrige les mensonges qu\'on sait prouver.');
