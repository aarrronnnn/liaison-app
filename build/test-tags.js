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

/* ---------- 3. notre mesure fait foi ---------- */
{
  /* On rejoue exactement ce que fait AnalysisService quand un
     resultat de fil arrive. */
  function appliquer(t, patch) {
    const surTempo = patch.mBpm > 40 && patch.mBpmConf >= an.SUR_TEMPO;
    const surTonalite = patch.mKey && patch.mKeyConf >= an.SUR_TONALITE;
    if (surTempo) {
      const avant = t.bpm;
      const mesure = Math.round(patch.mBpm * 10) / 10;
      const memeRythme = avant > 0 && !an.desaccordTempo(avant, mesure);
      const memeOctave = memeRythme && Math.abs(mesure - avant) / avant < 0.06;
      if (memeRythme && !memeOctave) t.bpmSource = 'tag';
      else {
        t.bpm = mesure; t.bpmSource = 'liaison';
        if (avant > 0 && !memeRythme) { t.bpmTag = avant; t.bpmCorrige = true; }
        else if (!(avant > 0)) t.bpmDeduit = true;
      }
    } else if (!(t.bpm > 0) && patch.mBpm > 40) {
      t.bpm = Math.round(patch.mBpm * 10) / 10;
      t.bpmDeduit = true; t.bpmSource = 'liaison-incertain';
    } else if (t.bpm > 0) t.bpmSource = 'tag';

    if (surTonalite) {
      const avant = t.key;
      t.key = patch.mKey; t.keySource = 'liaison';
      if (avant && an.desaccordTonalite(avant, t.key)) { t.keyTag = avant; t.keyCorrigee = true; }
      else if (!avant) t.keyDeduite = true;
    } else if (!t.key && patch.mKey && patch.mKeyConf >= 0.6) {
      t.key = patch.mKey; t.keyDeduite = true; t.keySource = 'liaison-incertain';
    } else if (t.key) t.keySource = 'tag';
    return t;
  }

  /* La regle principale : mesure sure = mesure retenue, meme quand
     le tag existe et dit a peu pres la meme chose. */
  const sur = appliquer({ bpm: 128, key: '8A' },
    { mBpm: 127.6, mBpmConf: 0.66, mKey: '9A', mKeyConf: 0.80 });
  verifier('3. mesure sure : c\'est NOTRE valeur qui est retenue',
           sur.bpm === 127.6 && sur.bpmSource === 'liaison', '128 -> ' + sur.bpm);
  verifier('3bis. meme quand le tag disait presque pareil',
           !sur.bpmCorrige, 'pas marque comme une correction');

  /* Le tag qui ment franchement : retenu ET signale. */
  const menteur = appliquer({ bpm: 97, key: '2A' },
    { mBpm: 128.2, mBpmConf: 0.66, mKey: '8A', mKeyConf: 0.80 });
  verifier('3ter. un tag franchement faux est corrige et signale',
           menteur.bpm === 128.2 && menteur.bpmCorrige === true, '97 -> ' + menteur.bpm);
  verifier('3quater. et l\'ancienne valeur reste consultable',
           menteur.bpmTag === 97 && menteur.keyTag === '2A',
           'tempo ' + menteur.bpmTag + ', tonalite ' + menteur.keyTag);

  /* Pas sur de nous : on ne touche pas a un tag existant. */
  const doute = appliquer({ bpm: 97, key: '2A' },
    { mBpm: 128.2, mBpmConf: 0.40, mKey: '8A', mKeyConf: 0.50 });
  verifier('4. mesure peu sure : le tag reste la reference',
           doute.bpm === 97 && doute.bpmSource === 'tag', 'reste a ' + doute.bpm);
  verifier('4bis. et la tonalite aussi', doute.key === '2A' && doute.keySource === 'tag');

  /* Rien du tout : une estimation vaut mieux qu'un vide, et on le dit. */
  const vide = appliquer({ bpm: 0, key: null },
    { mBpm: 124.5, mBpmConf: 0.30, mKey: '5A', mKeyConf: 0.62 });
  verifier('5. sans aucun tag, on comble meme sans grande confiance',
           vide.bpm === 124.5 && vide.bpmDeduit === true, 'comble a ' + vide.bpm);
  verifier('5bis. et on dit que c\'est incertain',
           vide.bpmSource === 'liaison-incertain', vide.bpmSource);
  verifier('5ter. la tonalite absente aussi', vide.key === '5A' && vide.keyDeduite === true);

  /* Le double et la moitie decrivent le meme rythme : pas une correction. */
  /* La moitie decrit le meme rythme : on garde l'octave du DJ,
     parce que sa grille et ses reperes sont cales dessus. */
  const moitie = appliquer({ bpm: 140 }, { mBpm: 70, mBpmConf: 0.90 });
  verifier('6. on garde l\'octave du DJ, pas la notre',
           moitie.bpm === 140 && !moitie.bpmCorrige, 'reste a ' + moitie.bpm);
  verifier('6bis. et on ne pretend pas l\'avoir mesuree',
           moitie.bpmSource === 'tag', moitie.bpmSource);
  /* Meme octave : notre valeur est plus precise, on la prend. */
  const precise = appliquer({ bpm: 128 }, { mBpm: 127.6, mBpmConf: 0.9 });
  verifier('6ter. a octave egale, notre mesure est plus fine',
           precise.bpm === 127.6 && precise.bpmSource === 'liaison', '128 -> ' + precise.bpm);

  /* Une tonalite voisine : retenue, mais pas signalee comme un mensonge. */
  const voisine = appliquer({ key: '8A', bpm: 128 },
    { mBpm: 128, mBpmConf: 0.9, mKey: '9A', mKeyConf: 0.95 });
  verifier('7. une tonalite voisine ne declenche pas d\'alerte',
           voisine.key === '9A' && !voisine.keyCorrigee, '8A -> ' + voisine.key);
}

/* ============================================================
   8. LE COMPTEUR D'ANALYSE NE RECULE PAS.

   « Des que je change de son, ANALYSE / 40 000 recommence. »

   Il comptait « fait depuis le dernier chargement » sur « restait
   a faire a ce moment-la ». charger() remettant le compteur a zero
   et reconstruisant la file, la moindre resynchronisation ramenait
   la barre a son point de depart sur un travail deja fait aux
   trois quarts.
   ============================================================ */
{
  let dernier = null;
  const svc = new an.AnalysisService(null, { onProgress: p => { dernier = p; }, onTrack: () => {} });
  const L = [];
  for (let i = 0; i < 100; i++) L.push({ id: i, path: null, analyzed: i < 40 });

  svc.charger(L); svc._rapport(true);
  const a = dernier;
  verifier('8. le compteur parle de la bibliotheque, pas de la file',
           a.total === 100, a.done + ' / ' + a.total);

  /* trente de plus sont analyses, puis la bibliotheque resynchronise */
  for (let i = 40; i < 70; i++) L[i].analyzed = true;
  svc.charger(L); svc._rapport(true);
  const b = dernier;
  verifier('8bis. apres une resynchronisation, il ne recule pas',
           b.done >= a.done, a.done + ' -> ' + b.done);
  verifier('8ter. et le total ne bouge pas non plus',
           b.total === a.total, a.total + ' -> ' + b.total);

  /* un disque debranche sort des DEUX cotes : il ne plombe pas la barre */
  const M = [];
  for (let i = 0; i < 10; i++) M.push({ id: i, path: null, analyzed: true, offline: i < 6 });
  const svc2 = new an.AnalysisService(null, { onProgress: p => { dernier = p; }, onTrack: () => {} });
  svc2.charger(M); svc2._rapport(true);
  verifier('8quater. les fichiers injoignables ne comptent nulle part',
           dernier.total === 4 && dernier.done === 4,
           dernier.done + ' / ' + dernier.total + ' sur 10 titres dont 6 injoignables');
}

/* ============================================================
   9. QUAND L'ANALYSE ECHOUE, L'APP LE DIT.

   « Peu importe le son : aucune key, aucun BPM, energie 5. Aucune
     reaction de l'app et aucun message. »

   Energie 5 sur TOUS les morceaux n'est pas un probleme par
   morceau : c'est l'analyse qui echoue en bloc. Et quand elle
   echouait, Liaison posait les valeurs par defaut, marquait le
   morceau « analyse », JETAIT le message d'erreur et se taisait.
   Sur une machine ou ffmpeg ne demarre pas, toute la bibliotheque
   y passait sans un mot.
   ============================================================ */
{
  const neuf = () => new an.AnalysisService(null, { onProgress: () => {}, onTrack: () => {} });

  const a = neuf();
  verifier('9. au depart, aucune panne annoncee', a.panne() === null);

  /* Un seul fichier abime ne prouve rien : on ne crie pas. */
  const b = neuf(); b.rates = 3; b.reussis = 2;
  verifier('9bis. trois echecs isoles ne declenchent rien', b.panne() === null,
           b.rates + ' echecs sur ' + (b.rates + b.reussis));

  /* ffmpeg absent : tout echoue, et on nomme l'erreur reelle. */
  const c = neuf(); c.rates = 25; c.reussis = 1;
  c.derniereErreur = 'spawn ffmpeg ENOENT';
  const pc = c.panne();
  verifier('9ter. l\'echec general est signale', !!pc && pc.cle === 'analyse-echoue');
  verifier('9quater. avec la VRAIE erreur, pas une phrase vague',
           /ENOENT/.test(pc.pourquoi), pc.pourquoi);
  verifier('9quinquies. et la marche a suivre', (pc.quoiFaire || []).length > 0,
           pc.quoiFaire[0]);

  /* Le cas vicieux : ca « reussit » mais rien n'en sort. */
  const d = neuf(); d.rates = 1; d.reussis = 40; d.mesuresUtiles = 1;
  const pd = d.panne();
  verifier('9sexies. une analyse qui ne mesure rien est signalee aussi',
           !!pd && pd.cle === 'analyse-sans-resultat', pd && pd.pourquoi);

  /* Et quand tout va bien, on se tait. */
  const e = neuf(); e.rates = 1; e.reussis = 40; e.mesuresUtiles = 38;
  verifier('9septies. une analyse saine ne dit rien', e.panne() === null);

  /* Aucun fil : on le dit tout de suite, sans attendre vingt essais. */
  const f = neuf(); f.sansFils = true;
  verifier('9octies. aucun fil d\'analyse : annonce immediate',
           !!f.panne() && f.panne().cle === 'analyse-sans-fils');
}

if (echecs) {
  console.error('\n' + echecs + ' cas de tags en echec.');
  process.exit(1);
}
console.log('\ntags et analyse : on comble, on corrige quand on peut le prouver, et on ne recule pas.');
