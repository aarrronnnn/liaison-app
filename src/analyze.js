'use strict';
/* ============================================================
   Liaison — analyse audio locale.
   ffmpeg decode -> mono 22050 Hz float32 -> descripteurs.
   Rien ne sort de la machine.
   ============================================================ */
const { spawn } = require('child_process');
const path = require('path');

function ffmpegPath() {
  try {
    let p = require('ffmpeg-static');
    if (p && p.path) p = p.path;
    if (p) return p.replace('app.asar', 'app.asar.unpacked');
  } catch (e) { /* fallback */ }
  return 'ffmpeg';
}

/* Un morceau ne se decode pas en plus de ca : au-dela, c'est bloque. */
const DELAI_FFMPEG = 90000;
const SR = 22050, N = 2048, HOP = 1024;

/* ---------- FFT radix-2 en place ---------- */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const HANN = new Float32Array(N);
for (let i = 0; i < N; i++) HANN[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));

/* ---------- profils Krumhansl-Schmuckler ---------- */
const MAJ = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MIN = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
/* pitch class -> code Camelot (0 = do) */
const CAM_MAJ = ['8B','3B','10B','5B','12B','7B','2B','9B','4B','11B','6B','1B'];
const CAM_MIN = ['5A','12A','7A','2A','9A','4A','11A','6A','1A','8A','3A','10A'];

function corr(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

/* ------------------------------------------------------------
   Le decodage commence a vingt secondes — sauf quand il n'y a pas
   vingt secondes.

   On saute l'intro parce qu'elle ment : beaucoup de morceaux
   s'ouvrent sur une nappe, une voix seule ou un filtre ferme, et
   analyser ca revient a juger un morceau sur sa premiere phrase.

   Mais le saut etait inconditionnel et sans repli. Un jingle, un
   virage, un edit court, un extrait de vingt secondes : ffmpeg ne
   rendait aucun echantillon, analyze() jetait « aucun echantillon »,
   et analysis.js rangeait le morceau en « illisible » — energie 5,
   pas de tempo, pas de tonalite. Le DJ, lui, voyait juste un
   morceau que Liaison ne savait pas lire, sans savoir pourquoi.

   On reessaie donc depuis le debut des que la premiere passe rend
   moins de vingt-cinq secondes d'audio. Les morceaux normaux ne
   paient rien : ils ne font qu'une passe, comme avant.
   ------------------------------------------------------------ */
const ASSEZ = 25;                       /* secondes utiles attendues */

async function decode(file, seconds) {
  const premier = await decodeDepuis(file, 20, seconds);
  if (premier.length >= ASSEZ * SR) return premier;
  const second = await decodeDepuis(file, 0, seconds).catch(() => null);
  if (second && second.length > premier.length) return second;
  if (premier.length) return premier;
  throw new Error('ffmpeg: aucun echantillon (' + path.basename(file) + ')');
}

function decodeDepuis(file, depart, seconds) {
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-ss', String(depart), '-t', String(seconds), '-i', file,
                  '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'];
    const p = spawn(ffmpegPath(), args);
    const chunks = [];
    let bytes = 0;
    p.stdout.on('data', d => { chunks.push(d); bytes += d.length; });
    p.stderr.on('data', () => {});
    /* ------------------------------------------------------------
       Un ffmpeg qui ne rend jamais la main.

       Il n'y avait ni delai ni « kill ». Sur un fichier abime, un
       partage reseau qui ne repond plus ou une cle USB qu'on vient
       de debrancher, ffmpeg peut rester la sans jamais emettre ni
       « error » ni « close ». La promesse ne se resout alors JAMAIS :
       le fil reste occupe a vie, le morceau reste marque « en
       cours », et — avec deux fils seulement — deux fichiers penibles
       suffisent a faire disparaitre les points de mix pour le reste
       de la nuit. En silence, ce qui est le pire.
       ------------------------------------------------------------ */
    let fini = false;
    const minuteur = setTimeout(() => {
      if (fini) return;
      fini = true;
      try { p.kill('SIGKILL'); } catch (e) {}
      reject(new Error('ffmpeg : delai depasse (' + path.basename(file) + ')'));
    }, DELAI_FFMPEG);
    const terminer = (fn) => (...a) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      fn(...a);
    };
    p.on('error', terminer(reject));
    p.on('close', terminer(() => {
      if (!bytes) return resolve(new Float32Array(0));
      const buf = Buffer.concat(chunks, bytes - (bytes % 4));
      resolve(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
    }));
  });
}

/* ------------------------------------------------------------
   Le chroma — et pourquoi il lisait la grosse caisse.

   Mesure, sur dix-huit morceaux synthetises a tonalite connue :
   la detection tombait juste 6 fois sur 18, et surtout elle
   repondait 7A ou 7B (re mineur / re majeur) DOUZE fois. Une
   erreur qui se repete a ce point n'est pas du bruit, c'est un
   biais.

   Il venait de la : le chroma additionnait TOUTES les cases de la
   FFT entre 60 et 2000 Hz, en prenant la frequence du centre de
   case. A 22050 Hz sur 2048 points, une case fait 10,8 Hz — soit
   pres de DEUX demi-tons de large vers 70 Hz. La case n° 7 tombe
   sur 75,4 Hz, que l'arrondi note « re ». Or c'est exactement la
   ou vit la grosse caisse, qui est l'evenement le plus fort du
   morceau. Liaison n'ecoutait donc pas l'harmonie : il notait la
   hauteur du kick, et repondait « re » a tout le monde.

   Trois corrections, mesurees ensemble :

     1. on ne retient que les PICS du spectre. Une percussion
        etale son energie sur toutes les cases ; une note tenue
        fait un sommet. Le pic elimine le bruit de fond percussif
        sans avoir a le modeliser.
     2. la frequence du pic est affinee par interpolation
        parabolique sur ses deux voisines. La precision descend
        alors bien sous la case, ce qui rend la bande grave
        exploitable au lieu d'etre un piege.
     3. chaque trame est normalisee avant d'etre ajoutee, et le
        poids est logarithmique. Sans ca, huit mesures de refrain
        fort decident de la tonalite de tout le morceau.

   Bande retenue : 130-3000 Hz. Plus bas, c'est la batterie ;
   plus haut, ce sont les harmoniques, qui tirent vers la
   quinte. Mesure des trois bandes essayees : 130-3000 donne
   16/18, 200-2600 donne 9/18, 250-2200 donne 4/18 — la region
   des fondamentales compte, a condition de savoir la lire.
   ------------------------------------------------------------ */
const CHROMA_LO = 130, CHROMA_HI = 3000;
const K_CHROMA_LO = Math.max(2, Math.floor((CHROMA_LO * N) / SR) - 1);
const K_CHROMA_HI = Math.min(N / 2 - 2, Math.ceil((CHROMA_HI * N) / SR) + 1);

function accumulerChroma(mag, chroma, cadre) {
  cadre.fill(0);
  let total = 0;
  for (let k = K_CHROMA_LO; k <= K_CHROMA_HI; k++) {
    const a = mag[k - 1], b = mag[k], c = mag[k + 1];
    if (b <= 0 || !(b > a && b >= c)) continue;      /* pas un sommet */
    const den = a - 2 * b + c;
    const d = den ? (0.5 * (a - c)) / den : 0;
    if (d < -1 || d > 1) continue;                   /* sommet mal conditionne */
    const hz = ((k + d) * SR) / N;
    if (hz < CHROMA_LO || hz > CHROMA_HI) continue;
    const midi = 69 + 12 * Math.log2(hz / 440);
    const pc = ((midi % 12) + 12) % 12;
    const bas = Math.floor(pc), frac = pc - bas;
    const w = Math.log(1 + b);
    cadre[bas % 12] += w * (1 - frac);
    cadre[(bas + 1) % 12] += w * frac;
    total += w;
  }
  if (total <= 0) return;
  for (let i = 0; i < 12; i++) chroma[i] += cadre[i] / total;
}

/**
 * Analyse un fichier audio.
 * @returns {Promise<{energy:number, timbre:[number,number,number], key:string, vocalish:number}>}
 */
async function analyze(file, opts) {
  opts = opts || {};
  const pcm = await decode(file, opts.seconds || 120);
  const frames = Math.max(1, Math.floor((pcm.length - N) / HOP));
  const re = new Float64Array(N), im = new Float64Array(N);
  const prevMag = new Float64Array(N / 2);
  const chroma = new Float64Array(12);

  const rms = [], centroid = [], flux = [], lowRatio = [], highRatio = [];
  const mag = new Float64Array(N / 2);
  const chromaCadre = new Float64Array(12);

  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const s = pcm[off + i] || 0;
      sum += s * s;
      re[i] = s * HANN[i]; im[i] = 0;
    }
    rms.push(Math.sqrt(sum / N));
    fft(re, im);

    let magSum = 0, freqSum = 0, low = 0, high = 0, fl = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      mag[k] = m;
      const hz = (k * SR) / N;
      magSum += m; freqSum += m * hz;
      if (hz < 250) low += m;
      if (hz > 4000) high += m;
      const d = m - prevMag[k];
      if (d > 0) fl += d;
      prevMag[k] = m;
    }
    if (magSum > 0) {
      centroid.push(freqSum / magSum);
      lowRatio.push(low / magSum);
      highRatio.push(high / magSum);
    }
    flux.push(fl);
    accumulerChroma(mag, chroma, chromaCadre);
  }

  const pct = (arr, p) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /* ============================================================
     L'ENERGIE — et la mesure qui etait a l'envers.

     « Peu importe le son : aucune key, aucun BPM, energie 5. »

     Reproduit au banc, sur vingt-trois fichiers. L'ancienne
     formule rendait 5 pour LES DIX-HUIT morceaux — ballade, house,
     drum and bass, tout — et 7 pour du bruit blanc et pour une
     nappe sans le moindre temps. Le classement etait donc pire que
     plat : il etait inverse.

     La faute tient dans une ligne :

         density = moyenne(flux) / centile98(flux)

     Elle etait censee dire « densite d'attaques ». Elle dit
     exactement le contraire. Un morceau qui frappe fort a un
     centile 98 tres haut et une moyenne basse : son rapport tombe
     vers 0,10. Une nappe sans aucune attaque a un flux presque
     constant : son rapport monte a 0,57. Plus un morceau tapait,
     moins il marquait de points.

     Et cette meme valeur alimentait timbre[1], que plancher.js lit
     comme « percussif contre tenu » pour juger ce que le morceau
     fait a la piste. Une nappe passait donc pour plus percussive
     qu'un titre de club — dans le module meme dont tout le travail
     est de ne plus confondre les deux.

     On mesure maintenant quatre choses qui, elles, bougent
     vraiment d'un morceau a l'autre :

       — les ATTAQUES PAR SECONDE : on compte les sommets du flux
         qui depassent nettement la mediane. Mesure : 1,2 sur une
         ballade, 2,0 en house, 2,8 en drum and bass, 0,0 sur du
         bruit blanc.
       — la NETTETE DE LA PULSATION, que l'estimateur de tempo
         rend deja : 0,8 sur un morceau cale, 0,0 sur une nappe.
       — le NIVEAU SOUTENU, comme avant.
       — le TRANCHANT : l'ecart entre le centile 90 du flux et sa
         mediane. Il vaut 0,99 des qu'il y a des attaques, et il
         s'effondre sur une nappe (0,38) ou du bruit (0,06). Il ne
         classe pas la musique entre elle, il ecarte ce qui n'en
         est pas.
     ============================================================ */
  /* le tempo d'abord : la nettete de sa pulsation entre dans l'energie */
  const tempo = estimateBPM(flux, SR / HOP);

  const loud = pct(rms, 0.9);
  const db = 20 * Math.log10(loud || 1e-6);              // ~ -30 .. -6 dBFS
  const level = clamp((db + 30) / 24, 0, 1);

  const fluxMed = pct(flux, 0.5), fluxP90 = pct(flux, 0.9);
  const seuilPic = Math.max(fluxMed * 1.8, mean(flux) + 0.5 * (fluxP90 - mean(flux)));
  let pics = 0;
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > seuilPic && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) pics++;
  }
  const secondes = flux.length / (SR / HOP) || 1;
  const attaques = pics / secondes;

  const activite = clamp((attaques - 0.5) / 2.8, 0, 1);
  const tranchant = clamp(fluxP90 > 0 ? (fluxP90 - fluxMed) / fluxP90 : 0, 0, 1);
  const pulsation = clamp((tempo.confiance - 0.12) / 0.55, 0, 1);

  const brut = 0.34 * activite + 0.22 * pulsation + 0.22 * level + 0.22 * tranchant;
  /* La plage utile observee va de 0,20 (rien) a 0,90 (piste pleine) :
     on l'etale sur 1..10 au lieu de laisser tout le monde a 5. */
  const energy = clamp(Math.round(1 + 9 * clamp((brut - 0.20) / 0.70, 0, 1)), 1, 10);

  /* timbre [brillance, densite, chaleur] sur 10 */
  const cen = mean(centroid);
  const brightness = clamp(Math.round(((Math.log2((cen || 500) / 250)) / 4) * 10), 0, 10);
  /* densite = percussif contre tenu, c'est plancher.js qui la lit */
  const dens = clamp(Math.round(10 * (0.55 * activite + 0.45 * tranchant)), 0, 10);
  /* La chaleur saturait elle aussi : « part du grave x 26 » depasse
     10 des que le grave passe 0,385, ce qui est le cas de presque
     toute la musique. Mesure au banc : la part du grave va de 0,02
     (bruit blanc) a 0,78 (ballade au piano) et se tient entre 0,29
     et 0,66 pour la musique de piste. On etale donc sur cette
     plage-la au lieu de rendre 10 a tout le monde. */
  const warmth = clamp(Math.round((mean(lowRatio) - 0.15) / 0.05), 0, 10);

  /* tonalite : on garde aussi le second, pour savoir si le premier
     s'est vraiment detache ou s'il a gagne d'un cheveu. */
  const chr = Array.from(chroma);
  const notes = [];
  for (let r = 0; r < 12; r++) {
    const rot = chr.slice(r).concat(chr.slice(0, r));
    notes.push([corr(rot, MAJ), CAM_MAJ[r]], [corr(rot, MIN), CAM_MIN[r]]);
  }
  notes.sort((a, b) => b[0] - a[0]);
  const bestScore = notes.length ? notes[0][0] : -2;
  const bestKey = notes.length ? notes[0][1] : null;
  const margeKey = notes.length > 1 ? notes[0][0] - notes[1][0] : 0;

  /* indice de presence vocale : energie 300-3400 Hz + variabilite du centroide */
  const vocalish = clamp(Math.round((mean(highRatio) * 12 + (1 - mean(lowRatio)) * 4)), 0, 10);

  return {
    bpm: tempo.bpm,
    bpmConfidence: tempo.confiance,
    energy: energy,
    energyBrut: Math.round(brut * 1000) / 1000,
    timbre: [brightness, dens, warmth],
    key: bestKey,
    keyConfidence: Math.round(Math.max(0, bestScore) * 100) / 100,
    keyMargin: Math.round(Math.max(0, margeKey) * 100) / 100,
    vocalish: vocalish
  };
}

/* ---------- estimation de tempo ----------
   On ne cherche pas le pic d'autocorrelation : sa resolution vaut
   plus de 10 BPM par frame au-dessus de 130, et un DJ voit tout de
   suite l'ecart au pitch. On aligne un peigne de pulsations sur
   l'enveloppe d'attaques : l'erreur de periode s'accumule sur toute
   la duree, donc le bon tempo se detache au centieme pres.
   Deux passes : 0,5 BPM pour trouver la zone, 0,02 BPM pour affiner. */
function estimateBPM(flux, frameRate) {
  if (!flux || flux.length < 64) return { bpm: 0, confiance: 0 };
  const n = flux.length;
  const m = flux.reduce((a, b) => a + b, 0) / n;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.max(0, flux[i] - m);

  /* valeur de l'enveloppe a un instant fractionnaire */
  const val = x => {
    if (x < 0 || x >= n - 1) return 0;
    const i = Math.floor(x), f = x - i;
    return env[i] * (1 - f) + env[i + 1] * f;
  };

  /* ------------------------------------------------------------
     Le peigne mesure un CONTRASTE, pas une hauteur moyenne.

     L'ancienne version rendait la moyenne de l'enveloppe sous les
     dents du peigne. Cette moyenne a un defaut fatal : elle est
     AVEUGLE A LA MOITIE DU TEMPO. Un peigne deux fois trop lache
     tombe une fois sur deux sur un temps — donc toujours sur un
     temps — et sa moyenne vaut autant, parfois plus si le morceau
     a un contretemps appuye. Mesure sur un morceau a 174 : la
     moyenne donnait 1180 a 87 BPM contre 781 a 174. Le moteur
     lisait donc 87, et un titre de drum and bass passait pour du
     hip hop lent.

     On soustrait donc ce que le peigne ramasse a MI-CHEMIN entre
     ses dents. Au bon tempo, l'entre-deux est vide et le
     contraste est maximal ; a la moitie du tempo, l'entre-deux
     tombe sur les temps oublies et le contraste s'effondre.

     Gain mesure sur dix-huit morceaux a tempo connu : la confiance
     moyenne passe de 0,59 a 0,67, et la plus basse des mesures
     justes de 0,28 a 0,47 — c'est elle qui decide si Liaison ose
     se fier a lui-meme plutot qu'a un tag.
     ------------------------------------------------------------ */
  function combAt(lag, phases) {
    const K = Math.floor((n - 1) / lag);
    if (K < 8) return 0;
    let best = -1, phase = 0;
    for (let p = 0; p < phases; p++) {
      const ph = (p * lag) / phases;
      let s = 0;
      for (let k = 0; k < K; k++) s += val(ph + k * lag);
      if (s > best) { best = s; phase = ph; }
    }
    let entre = 0;
    for (let k = 0; k < K; k++) entre += val(phase + (k + 0.5) * lag);
    return Math.max(0, (best - entre) / K);
  }

  /* Ce que le peigne ramasse sous ses dents, sans rien soustraire :
     sert a juger si les contretemps sont charges. */
  function surLesDents(lag, phases) {
    const K = Math.floor((n - 1) / lag);
    if (K < 8) return null;
    let best = -1, phase = 0;
    for (let p = 0; p < phases; p++) {
      const ph = (p * lag) / phases;
      let s = 0;
      for (let k = 0; k < K; k++) s += val(ph + k * lag);
      if (s > best) { best = s; phase = ph; }
    }
    let entre = 0;
    for (let k = 0; k < K; k++) entre += val(phase + (k + 0.5) * lag);
    return { dents: best / K, entre: entre / K };
  }

  const lagFor = bpm => (60 / bpm) * frameRate;
  const LO = 55, HI = 215;

  /* ------------------------------------------------------------
     On garde toute la courbe, pas seulement son sommet.

     Jusqu'ici cette fonction rendait un tempo et rien d'autre. Un
     tempo sans confiance ne peut servir qu'a combler un trou : on
     n'ose pas s'en servir pour CONTREDIRE un tag, meme faux, parce
     qu'on ne sait pas si la mesure vaut mieux que lui.

     La confiance se lit pourtant sur place. Quand le morceau a une
     pulsation nette, le peigne resonne a un seul endroit et le
     sommet ecrase tout le reste. Quand il n'en a pas — une nappe,
     un morceau live, une intro parlee — la courbe est plate et
     plusieurs tempos se valent. On compare donc le sommet au
     meilleur concurrent QUI N'EST PAS une harmonique : le double,
     la moitie et le tiers decrivent le meme rythme, les compter
     comme des rivaux ferait passer un morceau tres net pour un
     morceau douteux.
     ------------------------------------------------------------ */
  const courbe = [];
  let bestScore = -1, bestBpm = 0;
  for (let bpm = LO; bpm <= HI; bpm += 0.5) {
    const s = combAt(lagFor(bpm), 12);
    courbe.push([bpm, s]);
    if (s > bestScore) { bestScore = s; bestBpm = bpm; }
  }
  if (!bestBpm) return { bpm: 0, confiance: 0 };

  const harmonique = (a, b) => {
    for (const r of [1, 2, 0.5, 3, 1 / 3, 4, 0.25, 1.5, 2 / 3]) {
      if (Math.abs(b * r - a) / a < 0.04) return true;
    }
    return false;
  };
  let rival = 0;
  for (const [bpm, sc] of courbe) {
    if (harmonique(bestBpm, bpm)) continue;
    if (sc > rival) rival = sc;
  }
  /* 0 = aucune pulsation qui se detache, 1 = un seul tempo possible */
  const confiance = bestScore > 0 ? Math.max(0, Math.min(1, 1 - rival / bestScore)) : 0;

  for (let bpm = Math.max(LO, bestBpm - 0.6); bpm <= Math.min(HI, bestBpm + 0.6); bpm += 0.02) {
    const s = combAt(lagFor(bpm), 16);
    if (s > bestScore) { bestScore = s; bestBpm = bpm; }
  }

  /* ------------------------------------------------------------
     La fenetre d'octave, et la ballade qu'elle transformait en
     drum and bass.

     Elle allait de 82 a 178 : tout ce qui tombait dessous etait
     double. Un morceau a 76 BPM ressortait donc a 152 — et ce
     n'est pas un detail d'affichage. plancher.js lit ce tempo
     pour juger ce que le morceau fait a la salle : a 152, il
     repond « ca danse » (74 sur 100) ; a 76, il repond « la piste
     se vide » (26). Un slow etait donc note comme un morceau de
     piste, et remontait dans les propositions juste apres un
     banger. C'est exactement la faute que le DJ nous a signalee.

     La fenetre commence maintenant a 70, ce qui laisse vivre les
     ballades, les slows et le reggae lent. Ce qui est vraiment en
     demi-temps est rattrape par le test des contretemps
     ci-dessous, qui lui est mesure et non suppose.
     ------------------------------------------------------------ */
  const BAS = 70, HAUT = 190;
  let bpm = bestBpm;
  while (bpm < BAS) bpm *= 2;
  while (bpm > HAUT) bpm /= 2;

  /* si les contretemps portent autant que les temps, le vrai compte
     est double — on ne le teste que sous 100 BPM, ou une lecture en
     demi-temps est vraisemblable ; au-dela, un contretemps charge
     n'est qu'un charleston. */
  if (bpm < 100 && bpm * 2 <= HAUT) {
    const t = surLesDents(lagFor(bpm), 16);
    if (t && t.dents > 0 && t.entre / t.dents >= 0.45) bpm *= 2;
  }

  if (!isFinite(bpm) || bpm <= 0) return { bpm: 0, confiance: 0 };
  return { bpm: Math.round(bpm * 10) / 10,
           confiance: Math.round(confiance * 100) / 100 };
}

module.exports = { analyze, ffmpegPath, estimateBPM };
