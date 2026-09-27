/* ============================================================
   LA CARTE DE SOIREE — une image a poster le lendemain.

   « Qu'est-ce qui te ferait acheter, et revenir ? » — voir ses
   propres chiffres, et pouvoir les montrer. Un DJ poste ses soirees
   en story : cette carte est sa soiree, en chiffres, dans la DA de
   Liaison, avec liaisondj.app en bas. Chaque story est une
   recommandation de DJ a DJ.

   Dessinee a la main sur un <canvas> : aucune dependance, les polices
   de l'app, un rendu identique sur Mac et Windows. Rien ne quitte la
   machine : l'image est enregistree ou copiee, c'est le DJ qui la
   poste. Le nom de la soiree et les titres sont masquables — un
   mariage n'a pas toujours envie d'etre en story.

   Deux formats : story (1080 x 1920) et publication (1080 x 1350).
   ============================================================ */
(function (racine) {
  'use strict';
  const C = {
    fond: '#0E0F13', surface: 'rgba(255,255,255,0.035)', trait: '#272A32',
    encre: '#EFEAE0', encre2: '#9BA0A8', encre3: '#6D727B',
    bleu: '#3549F0', bleu2: '#5C6EFF', bleuTxt: '#7A88FF', rose: '#FF5A42'
  };
  const D = "Anton, 'Arial Narrow', Impact, sans-serif";
  const B = "'Space Grotesk', system-ui, sans-serif";
  const M = "'Space Mono', ui-monospace, Menlo, monospace";

  const TXT = {
    fr: { debrief: 'DÉBRIEF', musique: 'DE MUSIQUE', morceaux: 'MORCEAUX', pic: 'PIC D\'ÉNERGIE', courbe: 'LA COURBE DE LA NUIT',
          attendu: 'attendu', demandes: 'DEMANDES JOUÉES', harmonie: 'HARMONIE', bpm: 'BPM MÉDIAN', artistes: 'ARTISTES',
          meilleur: 'MEILLEUR ENCHAÎNEMENT', meilleurs: 'MEILLEURS ENCHAÎNEMENTS', par: 'par', soiree: 'Ma soirée', ecart: 'd\'écart',
          pied: 'débrief par Liaison' },
    en: { debrief: 'DEBRIEF', musique: 'OF MUSIC', morceaux: 'TRACKS', pic: 'ENERGY PEAK', courbe: 'THE NIGHT\'S CURVE',
          attendu: 'expected', demandes: 'REQUESTS PLAYED', harmonie: 'HARMONY', bpm: 'MEDIAN BPM', artistes: 'ARTISTS',
          meilleur: 'BEST TRANSITION', meilleurs: 'BEST TRANSITIONS', par: 'by', soiree: 'My night', ecart: 'apart',
          pied: 'debrief by Liaison' }
  };

  /* Les polices de l'app doivent etre chargees AVANT de dessiner : un
     canvas ne se redessine pas tout seul quand elles arrivent. */
  async function polices() {
    if (!racine.document || !document.fonts || !document.fonts.load) return;
    try {
      await Promise.all([
        document.fonts.load('400 100px Anton'),
        document.fonts.load("500 40px 'Space Grotesk'"), document.fonts.load("700 40px 'Space Grotesk'"),
        document.fonts.load("400 30px 'Space Mono'"), document.fonts.load("700 30px 'Space Mono'")
      ]);
    } catch (e) {}
  }

  const virgule = (x, en) => en ? String(x) : String(x).replace('.', ',');
  function duree(min) {
    min = Math.max(0, Math.round(min || 0));
    const h = Math.floor(min / 60), m = min % 60;
    return h ? h + 'H' + String(m).padStart(2, '0') : m + ' MIN';
  }
  function dateLongue(iso, en) {
    const d = new Date(iso || Date.now());
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString(en ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).toUpperCase();
  }

  /* Le texte qui ne tient pas : on coupe aux mots, puis on reduit la
     taille jusqu'a ce que tout tienne dans le nombre de lignes voulu. */
  function lignesDe(ctx, texte, largeur) {
    const mots = String(texte).split(/\s+/).filter(Boolean);
    const out = [];
    let cur = '';
    for (const w of mots) {
      const essai = cur ? cur + ' ' + w : w;
      if (ctx.measureText(essai).width <= largeur || !cur) cur = essai;
      else { out.push(cur); cur = w; }
    }
    if (cur) out.push(cur);
    return out;
  }
  function ajuste(ctx, texte, largeur, maxLignes, taille, mini, police) {
    let t = taille, l;
    for (; t >= mini; t -= 4) {
      ctx.font = police(t);
      l = lignesDe(ctx, texte, largeur);
      if (l.length <= maxLignes && l.every(x => ctx.measureText(x).width <= largeur)) return { t: t, l: l };
    }
    ctx.font = police(mini);
    l = lignesDe(ctx, texte, largeur).slice(0, maxLignes);
    const dern = l.length - 1;
    while (dern >= 0 && ctx.measureText(l[dern] + '…').width > largeur && l[dern].length > 1) l[dern] = l[dern].slice(0, -1);
    if (lignesDe(ctx, texte, largeur).length > maxLignes) l[dern] = l[dern].replace(/\s+\S*$/, '') + '…';
    return { t: mini, l: l };
  }
  function coupe(ctx, texte, largeur) {
    let s = String(texte || '');
    if (ctx.measureText(s).width <= largeur) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > largeur) s = s.slice(0, -1);
    return s + '…';
  }
  function rond(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  /* La marque : deux chevrons qui se font face, un point au centre. */
  function marque(ctx, x, y, s) {
    const k = s / 24;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.lineWidth = 2.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = C.bleu2; ctx.beginPath(); ctx.moveTo(3.4, 3.4); ctx.lineTo(10, 12); ctx.lineTo(3.4, 20.6); ctx.stroke();
    ctx.strokeStyle = C.rose; ctx.beginPath(); ctx.moveTo(20.6, 3.4); ctx.lineTo(14, 12); ctx.lineTo(20.6, 20.6); ctx.stroke();
    ctx.fillStyle = C.encre; ctx.beginPath(); ctx.arc(12, 12, 2.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /* La courbe de la nuit : jouee (pleine) contre attendue (pointillee). */
  function courbe(ctx, x, y, w, h, pts, attendu, en) {
    const n = pts.length;
    if (!n) return;
    const bas = 46, haut = 64;
    const vals = pts.map(p => p.e).concat((attendu || []).filter(v => v != null));
    const lo = Math.max(0, Math.min.apply(null, vals) - 2);
    const X = i => n === 1 ? x + w / 2 : x + 20 + i * (w - 40) / (n - 1);
    const Y = v => y + haut + (1 - (Math.max(lo, Math.min(10, v)) - lo) / (10 - lo || 1)) * (h - haut - bas);
    const P = pts.map((p, i) => [X(i), Y(p.e)]);
    const chemin = () => {
      ctx.moveTo(P[0][0], P[0][1]);
      for (let i = 0; i < n - 1; i++) {
        const p0 = P[i - 1] || P[i], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2] || p2;
        ctx.bezierCurveTo(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
                          p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
      }
    };
    /* grille discrete */
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 2;
    for (let k = 1; k <= 3; k++) { const gy = y + haut + k * (h - haut - bas) / 4; ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke(); }
    /* l'aire jouee */
    if (n > 1) {
      const g = ctx.createLinearGradient(0, y + haut, 0, y + h - bas);
      g.addColorStop(0, 'rgba(53,73,240,0.55)'); g.addColorStop(1, 'rgba(53,73,240,0)');
      ctx.beginPath(); chemin(); ctx.lineTo(P[n - 1][0], y + h - bas); ctx.lineTo(P[0][0], y + h - bas); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
    }
    /* l'attendu */
    if (attendu && attendu.some(v => v != null)) {
      ctx.save(); ctx.setLineDash([14, 14]); ctx.strokeStyle = C.encre2; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); let debut = true;
      attendu.forEach((v, i) => { if (v == null) { debut = true; return; } if (debut) ctx.moveTo(X(i), Y(v)); else ctx.lineTo(X(i), Y(v)); debut = false; });
      ctx.stroke(); ctx.restore();
    }
    /* la ligne jouee */
    if (n > 1) {
      ctx.save(); ctx.shadowColor = 'rgba(92,110,255,0.6)'; ctx.shadowBlur = 24;
      ctx.beginPath(); chemin(); ctx.strokeStyle = C.bleu2; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore();
    }
    const ipic = pts.reduce((m, p, i) => p.e > pts[m].e ? i : m, 0);
    P.forEach((p, i) => {
      const pic = i === ipic;
      ctx.beginPath(); ctx.arc(p[0], p[1], pic ? 15 : 10, 0, Math.PI * 2);
      ctx.fillStyle = pic ? C.rose : C.fond; ctx.fill();
      ctx.lineWidth = pic ? 5 : 6; ctx.strokeStyle = pic ? C.fond : C.bleu2; ctx.stroke();
      if (pic) {
        ctx.save(); ctx.shadowColor = 'rgba(255,90,66,0.8)'; ctx.shadowBlur = 30;
        ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fillStyle = C.rose; ctx.fill(); ctx.restore();
      }
      /* aux bords, l'etiquette se range vers l'interieur : elle ne
         mord jamais le cadre */
      ctx.font = '700 30px ' + M; ctx.fillStyle = pic ? C.encre : C.encre2;
      const bord = n > 1 && i === 0 ? 'left' : n > 1 && i === n - 1 ? 'right' : 'center';
      ctx.textAlign = bord;
      ctx.fillText(virgule(pts[i].e, en), p[0] + (bord === 'left' ? -10 : bord === 'right' ? 10 : 0), p[1] - 30);
    });
    ctx.font = '400 26px ' + M; ctx.fillStyle = C.encre3;
    const pas = Math.max(1, Math.ceil(n / 8));
    pts.forEach((p, i) => { if (i % pas === 0 || i === n - 1) { ctx.textAlign = n === 1 ? 'center' : i === 0 ? 'left' : i === n - 1 ? 'right' : 'center'; ctx.fillText(p.h + 'H', X(i) + (i === 0 && n > 1 ? -20 : i === n - 1 && n > 1 ? 20 : 0), y + h - 8); } });
    ctx.textAlign = 'left';
  }

  /**
   * @param {HTMLCanvasElement} cv
   * @param {object} d   le debrief (sets:debrief → debrief)
   * @param {object} o   { format:'story'|'post', nom:bool, titres:bool, dj:'', en:bool, attendu:[..] }
   */
  function dessiner(cv, d, o) {
    o = o || {};
    const story = o.format !== 'post';
    const W = 1080, H = story ? 1920 : 1350;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const T = TXT[o.en ? 'en' : 'fr'];
    const G = 90, L = W - 2 * G;
    ctx.textBaseline = 'alphabetic';

    /* le fond : la nuit, une lampe bleue en haut, une braise en bas */
    ctx.fillStyle = C.fond; ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W * 0.85, 120, 0, W * 0.85, 120, 900);
    g.addColorStop(0, 'rgba(53,73,240,0.42)'); g.addColorStop(1, 'rgba(53,73,240,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(0, H, 0, 0, H, 760);
    g.addColorStop(0, 'rgba(255,90,66,0.20)'); g.addColorStop(1, 'rgba(255,90,66,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    /* grain tres leger, pour que l'aplat ne fasse pas « capture d'ecran » */
    let s = 7;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    ctx.fillStyle = 'rgba(255,255,255,0.018)';
    for (let i = 0; i < 2600; i++) ctx.fillRect(r() * W, r() * H, 2, 2);

    /* l'en-tete */
    marque(ctx, G, 78, 58);
    ctx.font = '400 50px ' + D; ctx.fillStyle = C.encre; ctx.fillText('LIAISON', G + 76, 126);
    ctx.font = '700 26px ' + M; ctx.fillStyle = C.bleuTxt; ctx.textAlign = 'right';
    ctx.fillText(T.debrief, W - G, 122); ctx.textAlign = 'left';

    let y = story ? 250 : 220;
    ctx.font = '400 28px ' + M; ctx.fillStyle = C.encre2;
    ctx.fillText(coupe(ctx, dateLongue(d.quand, o.en), L), G, y);

    /* le nom de la soiree */
    const nom = o.nom === false ? T.soiree : (d.nom || T.soiree);
    const tit = ajuste(ctx, String(nom).toUpperCase(), L, 2, story ? 124 : 100, 68, t => '400 ' + t + 'px ' + D);
    ctx.fillStyle = C.encre;
    y += 22;
    for (const l of tit.l) { y += tit.t * 0.98; ctx.fillText(l, G, y); }
    if (o.dj) {
      y += 64; ctx.font = '500 40px ' + B; ctx.fillStyle = C.encre2;
      const par = T.par + ' ';
      ctx.fillText(par, G, y);
      const wp = ctx.measureText(par).width;
      ctx.font = '700 40px ' + B; ctx.fillStyle = C.encre;
      ctx.fillText(coupe(ctx, o.dj, L - wp), G + wp, y);
    }

    /* les trois chiffres */
    y += story ? 160 : 140;
    const col = L / 3;
    const gros = [
      [duree(d.minutes), T.musique, C.encre],
      [String(d.morceaux || 0), T.morceaux, C.encre],
      [d.pic ? virgule(d.pic.e, o.en) : '—', T.pic, C.bleuTxt]
    ];
    gros.forEach((x, i) => {
      const t = ajuste(ctx, x[0], col - 44, 1, story ? 120 : 104, 60, q => '400 ' + q + 'px ' + D);
      ctx.fillStyle = x[2]; ctx.fillText(t.l[0], G + i * col, y);
      ctx.font = '700 24px ' + M; ctx.fillStyle = C.encre2;
      ctx.fillText(coupe(ctx, x[1], col - 20), G + i * col, y + 46);
    });

    /* la courbe */
    y += story ? 100 : 90;
    const hC = story ? 400 : 330;
    rond(ctx, G - 20, y, L + 40, hC, 34); ctx.fillStyle = C.surface; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = C.trait; ctx.stroke();
    ctx.font = '700 24px ' + M; ctx.fillStyle = C.encre2; ctx.fillText(T.courbe, G + 14, y + 52);
    if (o.attendu && o.attendu.some(v => v != null)) {
      ctx.textAlign = 'right'; ctx.font = '400 24px ' + M; ctx.fillStyle = C.encre3;
      ctx.fillText('┄ ' + T.attendu, W - G - 14, y + 52); ctx.textAlign = 'left';
    }
    courbe(ctx, G, y, L, hC, (d.courbe || []).map(c => ({ h: c.h, e: c.e })), o.attendu, o.en);
    y += hC;

    /* la deuxieme rangee */
    y += story ? 116 : 96;
    const H2 = d.enchainements || {};
    const sec = [
      d.demandes && d.demandes.recues ? [d.demandes.jouees + '/' + d.demandes.recues, T.demandes] : [String(d.artistes || 0), T.artistes],
      H2.medianeHarmonie != null ? [String(H2.medianeHarmonie), T.harmonie + ' /100'] : null,
      d.tempo ? [String(Math.round(d.tempo.median)), T.bpm] : null
    ].filter(Boolean);
    const col2 = L / Math.max(1, sec.length);
    sec.forEach((x, i) => {
      const t = ajuste(ctx, x[0], col2 - 24, 1, 84, 52, q => '400 ' + q + 'px ' + D);
      ctx.fillStyle = C.encre; ctx.fillText(t.l[0], G + i * col2, y);
      ctx.font = '700 22px ' + M; ctx.fillStyle = C.encre2; ctx.fillText(coupe(ctx, x[1], col2 - 20), G + i * col2, y + 40);
    });

    /* les meilleurs enchainements : autant qu'il en tient au-dessus du
       pied (trois au plus), jamais un qui deborde */
    const basUtile = H - 176;
    const hL = 132;
    const place = Math.floor((basUtile - (y + (story ? 100 : 86) + 30)) / hL);
    const m = (H2.meilleurs || []).slice(0, Math.max(0, Math.min(story ? 3 : 1, place)));
    if (m.length) {
      y += story ? 100 : 86;
      ctx.font = '700 24px ' + M; ctx.fillStyle = C.bleuTxt;
      ctx.fillText(m.length > 1 ? T.meilleurs : T.meilleur, G, y);
      y += 30;
      for (const x of m) {
        rond(ctx, G - 20, y, L + 40, hL - 16, 26); ctx.fillStyle = C.surface; ctx.fill(); ctx.strokeStyle = C.trait; ctx.lineWidth = 2; ctx.stroke();
        const cx = G + 38, cy = y + (hL - 16) / 2;
        const gg = ctx.createLinearGradient(cx - 40, cy - 40, cx + 40, cy + 40);
        gg.addColorStop(0, C.bleu2); gg.addColorStop(1, C.bleu);
        ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.fillStyle = gg; ctx.fill();
        ctx.font = '400 38px ' + D; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(String(x.note), cx, cy + 14); ctx.textAlign = 'left';
        const tx = G + 104, tl = L - 104 - 170;
        if (o.titres === false) {
          ctx.font = '700 36px ' + B; ctx.fillStyle = C.encre;
          ctx.fillText(coupe(ctx, x.cle, tl), tx, cy + 12);
        } else {
          ctx.font = '700 34px ' + B; ctx.fillStyle = C.encre; ctx.fillText(coupe(ctx, x.de, tl), tx, cy - 8);
          ctx.font = '500 32px ' + B; ctx.fillStyle = C.encre2;
          ctx.fillText(coupe(ctx, '→ ' + x.vers, tl), tx, cy + 36);
        }
        ctx.font = '400 24px ' + M; ctx.fillStyle = C.encre2; ctx.textAlign = 'right';
        ctx.fillText(o.titres === false ? virgule(x.tempo, o.en) + ' %' : x.cle, W - G, cy - 4);
        ctx.fillText(o.titres === false ? x.quand : virgule(x.tempo, o.en) + ' % · ' + x.quand, W - G, cy + 32);
        ctx.textAlign = 'left';
        y += hL;
      }
    }

    /* les genres */
    const top = ((d.variete && d.variete.top) || []).slice(0, 4);
    if (story && top.length && y + 26 + 60 <= basUtile) {
      y += 26;
      let x = G;
      ctx.font = '700 26px ' + M;
      for (const t of top) {
        const txt = String(t.nom).toUpperCase() + '  ' + t.part + '%';
        const w = ctx.measureText(txt).width + 44;
        if (x + w > W - G) break;
        rond(ctx, x, y, w, 60, 30); ctx.fillStyle = 'rgba(53,73,240,0.16)'; ctx.fill();
        ctx.strokeStyle = 'rgba(92,110,255,0.45)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = C.encre; ctx.fillText(txt, x + 22, y + 40);
        x += w + 14;
      }
    }

    /* le pied : la signature, et d'ou ca vient */
    const yp = H - 90;
    ctx.strokeStyle = C.trait; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(G, yp - 56); ctx.lineTo(W - G, yp - 56); ctx.stroke();
    ctx.font = '700 30px ' + M; ctx.fillStyle = C.encre; ctx.fillText('liaisondj.app', G, yp);
    ctx.font = '400 26px ' + M; ctx.fillStyle = C.encre3; ctx.textAlign = 'right';
    ctx.fillText(T.pied, W - G, yp); ctx.textAlign = 'left';
    return cv;
  }

  const api = { dessiner: dessiner, polices: polices, TXT: TXT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else racine.LiaisonCarte = api;
})(typeof window !== 'undefined' ? window : this);
