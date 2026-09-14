'use strict';
/* ============================================================
   Ce que Liaison mesure lui-meme.

   « Les sons sont mal analyses. »
   « Peu importe le son : aucune key, aucun BPM, energie 5. »

   Ce banc fabrique des morceaux dont on CONNAIT le tempo, la
   tonalite et le caractere, puis il verifie que l'analyse les
   retrouve. Chaque cas ci-dessous est un defaut constate en
   cabine, pas une idee de test.

   Les fichiers sont synthetises a la volee dans un dossier
   temporaire et effaces a la fin : rien a telecharger, rien a
   installer.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyze, ffmpegPath } = require('../src/analyze');
const { SUR_TEMPO, SUR_TONALITE, MARGE_TONALITE } = require('../src/analysis');

let dur = 0, ok = 0;
const G = '\x1b[32m', R = '\x1b[31m', J = '\x1b[33m', F = '\x1b[0m';
function verifier(nom, condition, detail) {
  dur++;
  if (condition) { ok++; console.log('  ' + G + 'ok' + F + '   ' + nom + (detail ? '   - ' + detail : '')); }
  else { console.log('  ' + R + 'ECHEC' + F + ' ' + nom + (detail ? '   - ' + detail : '')); process.exitCode = 1; }
}

/* ---------- synthese ----------
   Le bruit de la caisse claire vient d'un generateur A GRAINE FIXE,
   pas de Math.random. Un banc qui change de resultat d'une execution
   a l'autre ne prouve rien : il finit par etre relance jusqu'a ce
   qu'il passe. Ici, deux executions donnent le meme audio, donc les
   memes chiffres, sur n'importe quelle machine. */
const SR = 44100;
let graine = 20260914;
function alea() {
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;
  return graine / 0x7fffffff;
}
function ecrireWav(ech, fichier) {
  const n = ech.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, ech[i])) * 32000), 44 + i * 2);
  }
  fs.writeFileSync(fichier, buf);
}
const hz = m => 440 * Math.pow(2, (m - 69) / 12);
function grosseCaisse(o, at, g) {
  const len = Math.floor(0.22 * SR);
  for (let i = 0; i < len && at + i < o.length; i++) {
    const t = i / SR;
    o[at + i] += g * Math.exp(-t * 16) * Math.sin(2 * Math.PI * (110 * Math.exp(-t * 28) + 45) * t);
  }
}
function caisseClaire(o, at, g) {
  const len = Math.floor(0.18 * SR);
  for (let i = 0; i < len && at + i < o.length; i++) {
    const t = i / SR;
    o[at + i] += g * Math.exp(-t * 22) * ((alea() * 2 - 1) * 0.8 + 0.2 * Math.sin(2 * Math.PI * 190 * t));
  }
}
function note(o, at, midi, duree, g) {
  const len = Math.floor(duree * SR), f = hz(midi);
  for (let i = 0; i < len && at + i < o.length; i++) {
    const t = i / SR, env = Math.min(1, t * 40) * Math.exp(-t * 1.6);
    let s = Math.sin(2 * Math.PI * f * t);
    for (let h = 2; h <= 4; h++) s += Math.sin(2 * Math.PI * f * h * t) / (h * 1.6);
    o[at + i] += g * env * s / 2;
  }
}
const MAJEUR = [0, 2, 4, 5, 7, 9, 11], MINEUR = [0, 2, 3, 5, 7, 8, 10];

/** @param opt { bpm, secondes, tonique, mineur, batterie } */
function morceau(opt) {
  const secs = opt.secondes || 50;
  const o = new Float64Array(secs * SR);
  const spb = (60 / opt.bpm) * SR;
  const beats = Math.floor(o.length / spb);
  const deg = opt.mineur ? MINEUR : MAJEUR;
  const racine = 48 + (opt.tonique || 0);
  for (let b = 0; b < beats; b++) {
    const at = Math.round(b * spb), mes = b % 4;
    if (opt.batterie) {
      grosseCaisse(o, at, 0.95);
      if (mes === 1 || mes === 3) caisseClaire(o, at, 0.55);
    }
    const acc = Math.floor(b / 16) % 4, fond = [0, 5, 3, 4][acc];
    note(o, at, racine - 12 + deg[fond], 60 / opt.bpm, 0.5);
    if (b % 2 === 0) {
      note(o, at, racine + deg[fond], 2 * 60 / opt.bpm, 0.28);
      note(o, at, racine + deg[(fond + 2) % 7], 2 * 60 / opt.bpm, 0.24);
      note(o, at, racine + deg[(fond + 4) % 7], 2 * 60 / opt.bpm, 0.22);
    }
  }
  let max = 0;
  for (let i = 0; i < o.length; i++) max = Math.max(max, Math.abs(o[i]));
  if (max > 0) for (let i = 0; i < o.length; i++) o[i] = (o[i] / max) * 0.85;
  return o;
}
/** Une nappe tenue : aucune attaque, aucune pulsation. */
function nappe(secs) {
  const o = new Float64Array(secs * SR);
  const f = [110, 164.81, 220, 277.18];
  for (let i = 0; i < o.length; i++) {
    const t = i / SR; let s = 0;
    for (const x of f) s += Math.sin(2 * Math.PI * x * t + Math.sin(t * 0.3));
    o[i] = s * 0.18;
  }
  return o;
}
/** Une grosse caisse SEULE : aucune harmonie a y lire. */
function caisseSeule(bpm, secs) {
  const o = new Float64Array(secs * SR), spb = (60 / bpm) * SR;
  for (let b = 0; b * spb < o.length; b++) grosseCaisse(o, Math.round(b * spb), 0.95);
  return o;
}

/* ------------------------------------------------------------
   Ce banc a besoin d'un ffmpeg qui DEMARRE.

   Il ne demarre pas partout : le binaire installe par
   ffmpeg-static est celui du systeme sur lequel npm a tourne. Un
   node_modules pose sur un Mac ne s'execute pas dans un conteneur
   Linux, et l'inverse non plus.

   Dans ce cas on ne fait pas semblant d'avoir teste, et on ne
   declare pas non plus un echec de Liaison : on dit exactement ce
   qui manque. Un ffmpeg qui demarre et qui repond de travers,
   lui, reste un echec — c'est toute la difference.
   ------------------------------------------------------------ */
function ffmpegDemarre() {
  try {
    const r = spawnSync(ffmpegPath(), ['-version']);
    return !r.error && r.status === 0;
  } catch (e) { return false; }
}

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'liaison-analyse-'));
const chemin = nom => path.join(dossier, nom + '.wav');

(async () => {
  console.log('\n- Ce que Liaison mesure lui-meme -\n');

  if (!ffmpegDemarre()) {
    console.log('  ' + J + 'non teste ici' + F + ' : ffmpeg ne demarre pas sur cette machine.');
    console.log('  ' + ffmpegPath());
    console.log('  Le binaire de ffmpeg-static est celui du systeme sur lequel npm a');
    console.log('  tourne. Relance ce banc la ou l\'app tourne vraiment :');
    console.log('      npm run verifier');
    try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
    return;
  }

  /* ------------------------------------------------------------
     1. L'ENERGIE N'EST PLUS 5 POUR TOUT LE MONDE.

     Temoin : avec l'ancienne formule, les deux morceaux ci-dessous
     rendaient 5 tous les deux, et la nappe rendait 7 — c'est-a-dire
     que du vide battait un morceau de piste.
     ------------------------------------------------------------ */
  ecrireWav(morceau({ bpm: 126, tonique: 9, mineur: true, batterie: true }), chemin('piste'));
  ecrireWav(morceau({ bpm: 74, tonique: 0, mineur: true, batterie: false }), chemin('ballade'));
  ecrireWav(nappe(50), chemin('nappe'));
  ecrireWav(caisseSeule(120, 50), chemin('caisse'));

  const piste = await analyze(chemin('piste'));
  const ballade = await analyze(chemin('ballade'));
  const napp = await analyze(chemin('nappe'));
  const caisse = await analyze(chemin('caisse'));

  verifier('1. un morceau de piste et une ballade n\'ont pas la meme energie',
    piste.energy !== ballade.energy,
    'piste ' + piste.energy + ', ballade ' + ballade.energy);
  verifier('1bis. et c\'est la piste qui est au-dessus',
    piste.energy > ballade.energy,
    piste.energy + ' > ' + ballade.energy);
  verifier('1ter. une nappe sans le moindre temps tombe en bas',
    napp.energy <= 3,
    'energie ' + napp.energy + ' (avant la correction : 7)');
  verifier('1quater. l\'energie sort de la case 5',
    piste.energy >= 7, 'energie ' + piste.energy);

  /* ------------------------------------------------------------
     2. timbre[1], la densite que plancher.js lit pour juger ce que
     le morceau fait a la salle. Elle etait calculee a l'envers :
     une nappe rendait 7, un morceau de club 2.
     ------------------------------------------------------------ */
  verifier('2. le morceau de piste est plus percussif que la nappe',
    piste.timbre[1] > napp.timbre[1],
    'piste ' + piste.timbre[1] + ' contre nappe ' + napp.timbre[1]);

  /* ------------------------------------------------------------
     3. LA FENETRE D'OCTAVE, ou la ballade transformee en dnb.
     Temoin : 74 BPM ressortait a 148, et plancher.js notait alors
     ce slow comme un morceau de piste.
     ------------------------------------------------------------ */
  verifier('3. une ballade a 74 BPM n\'est pas annoncee au double',
    ballade.bpm > 0 && Math.abs(ballade.bpm - 74) / 74 < 0.03,
    'mesure ' + ballade.bpm + ' BPM');

  const plancher = require('../src/plancher');
  verifier('3bis. et la piste la voit bien comme un morceau lent',
    plancher.parTempo(ballade.bpm) <= 30,
    'plancher ' + plancher.parTempo(ballade.bpm) + ' sur 100');

  /* ------------------------------------------------------------
     3ter. LA BOUCLE COMPLETE : DE L'AUDIO JUSQU'A LA PISTE.

     C'est ici que se rejoignent les deux bouts du probleme d'Aaron.
     plancher.js avait ete ecrit et teste sur des valeurs POSEES A
     LA MAIN — Sardines energie 9 densite 8, Aznavour energie 3
     densite 2 — et il les classait parfaitement. Mais sur de vrais
     fichiers, analyze() rendait energie 5 pour les deux et une
     densite calculee a l'envers. Le module etait juste, ses
     entrees etaient fausses, et le test ne pouvait pas le voir
     puisqu'il fabriquait lui-meme ses entrees.

     Ce cas-ci part donc de l'audio et va jusqu'au bout : deux
     morceaux synthetises, analyses pour de vrai, puis passes a
     plancher. L'ecart doit etre net, et dans le bon sens.
     ------------------------------------------------------------ */
  const commeUnMorceau = (r, bpm) => ({
    bpm: bpm, energy: r.energy, timbre: r.timbre, analyzed: true,
    genre: 'Variete', tags: ['variete'], title: 'x', artist: 'y'
  });
  const pPiste = plancher.plancher(commeUnMorceau(piste, piste.bpm));
  const pBallade = plancher.plancher(commeUnMorceau(ballade, ballade.bpm));
  verifier('3ter. de l\'audio a la piste : le morceau de club l\'emporte largement',
    pPiste.v - pBallade.v >= 35,
    'club ' + pPiste.v + ' contre ballade ' + pBallade.v + ' sur 100');
  verifier('3quater. et l\'enchainement club vers ballade est signale',
    plancher.raison(commeUnMorceau(piste, piste.bpm),
                    commeUnMorceau(ballade, ballade.bpm), 'up') !== null,
    plancher.raison(commeUnMorceau(piste, piste.bpm),
                    commeUnMorceau(ballade, ballade.bpm), 'up') || 'rien dit');

  /* ------------------------------------------------------------
     4. LE TEMPO D'UN MORCEAU CALE, et la confiance qui va avec.
     ------------------------------------------------------------ */
  verifier('4. un morceau de club a 126 est mesure a 126',
    Math.abs(piste.bpm - 126) / 126 < 0.03, 'mesure ' + piste.bpm + ' BPM');
  verifier('4bis. et Liaison est assez sur de lui pour s\'en servir',
    piste.bpmConfidence >= SUR_TEMPO,
    'confiance ' + piste.bpmConfidence + ' pour un seuil de ' + SUR_TEMPO);
  verifier('4ter. sur une nappe, il ne pretend surtout pas savoir',
    napp.bpmConfidence < SUR_TEMPO, 'confiance ' + napp.bpmConfidence);

  /* ------------------------------------------------------------
     5. LA TONALITE, et la grosse caisse qu'elle prenait pour un re.

     Temoin : le chroma additionnait toutes les cases de la FFT des
     60 Hz. La case qui tombe sur 75 Hz est arrondie en « re », et
     c'est la que vit la grosse caisse. Sur dix-huit morceaux,
     l'analyse repondait DOUZE fois re mineur ou re majeur — une
     grosse caisse seule, sans une seule note, repondait « re »
     avec aplomb.
     ------------------------------------------------------------ */
  verifier('5. une grosse caisse seule ne fait pas une tonalite',
    !(caisse.keyConfidence >= SUR_TONALITE && caisse.keyMargin >= MARGE_TONALITE),
    'tonalite ' + caisse.key + ', correlation ' + caisse.keyConfidence + ', marge ' + caisse.keyMargin);

  const cas = [
    { tonique: 9, mineur: true, camelot: '8A' },
    { tonique: 0, mineur: false, camelot: '8B' },
    { tonique: 5, mineur: true, camelot: '4A' },
    { tonique: 7, mineur: false, camelot: '9B' }
  ];
  let justes = 0;
  const vues = [];
  for (const c of cas) {
    ecrireWav(morceau({ bpm: 122, tonique: c.tonique, mineur: c.mineur, batterie: true }), chemin('ton'));
    const r = await analyze(chemin('ton'));
    vues.push(c.camelot + '>' + r.key);
    if (r.key === c.camelot) justes++;
  }
  verifier('5bis. quatre tonalites differentes donnent quatre reponses differentes',
    new Set(vues.map(v => v.split('>')[1])).size === 4, vues.join('  '));
  verifier('5ter. et elles sont justes', justes === cas.length,
    justes + '/' + cas.length + '  ' + vues.join('  '));

  /* ------------------------------------------------------------
     6. UN MORCEAU COURT SE LAISSE ANALYSER.
     Temoin : le decodage commencait a 20 secondes, sans repli. Un
     jingle de 12 secondes rendait « aucun echantillon » — donc
     energie 5, aucun tempo, aucune tonalite, et en silence.
     ------------------------------------------------------------ */
  ecrireWav(morceau({ bpm: 128, secondes: 12, tonique: 9, mineur: true, batterie: true }), chemin('court'));
  let court = null, plainte = null;
  try { court = await analyze(chemin('court')); } catch (e) { plainte = e.message; }
  verifier('6. un morceau de 12 secondes est analyse quand meme',
    court !== null && court.energy > 0,
    court ? 'energie ' + court.energy + ', tempo ' + court.bpm : 'echec : ' + plainte);

  /* ------------------------------------------------------------
     7. LE CACHE DOIT OUBLIER QUAND LA MESURE CHANGE.

     Sans ce cas, tout le reste de ce fichier ne servirait a rien
     chez un DJ qui utilise deja Liaison. La cle du cache est
     « chemin + taille + date » : corriger notre calcul n'en change
     aucun. Les resultats de l'ancienne mesure — energie 5 partout,
     densite a l'envers — seraient relus tels quels a chaque
     demarrage, et la mise a jour ne changerait rien de visible.
     ------------------------------------------------------------ */
  const { AnalysisCache, VERSION_MESURE } = require('../src/analysis');
  const fCache = path.join(dossier, 'cache-test.json');
  fs.writeFileSync(fCache, JSON.stringify({ '/un/morceau.mp3|123:456': { energy: 5, timbre: [5, 5, 5] } }));
  const vieuxCache = new AnalysisCache(fCache);
  verifier('7. un cache d\'une ancienne mesure est jete, pas relu',
    vieuxCache.perimee === true && vieuxCache.taille === 0,
    'perimee ' + vieuxCache.perimee + ', ' + vieuxCache.taille + ' entree(s) gardee(s)');

  vieuxCache.set('/un/morceau.mp3', '123:456', { energy: 8 });
  vieuxCache.save();
  const relu = new AnalysisCache(fCache);
  verifier('7bis. mais le cache de la mesure en cours est bien garde',
    relu.perimee === false && relu.taille === 1 && relu.get('/un/morceau.mp3', '123:456').energy === 8,
    'version ' + VERSION_MESURE + ', ' + relu.taille + ' entree(s)');

  console.log('\n' + (ok === dur
    ? G + dur + ' verifications, tout passe.' + F
    : R + (dur - ok) + ' echec(s) sur ' + dur + F));
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (e) {}
})().catch(e => {
  console.error(J + 'banc interrompu : ' + F + (e && e.message));
  process.exitCode = 1;
  try { fs.rmSync(dossier, { recursive: true, force: true }); } catch (x) {}
});
