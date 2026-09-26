'use strict';
/* ============================================================
   L'affiche des invites : une page A4 (le QR en grand) et quatre
   chevalets A6 a poser sur les tables. Pur HTML : main.js l'imprime
   en PDF, les bancs la rendent dans Chromium.
   ============================================================ */
function htmlAffiche(o) {
  const en = !!o.en, svg = o.svg, local = !!o.local, police = o.police;
  const nom = String(o.nom || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = en
    ? { h: 'Request a song', s: 'Scan with your phone camera — pick a track, the DJ sees it.', p: 'No app, no account.',
        c: 'Request<br>a song', local: 'Connect to the venue Wi-Fi first.' }
    : { h: 'Demande ton morceau', s: 'Scanne avec l\'appareil photo — choisis un titre, le DJ le voit.', p: 'Sans appli, sans compte.',
        c: 'Demande<br>ton morceau', local: 'Connecte-toi d\'abord au Wi-Fi du lieu.' };
  const marque = '<svg viewBox="0 0 24 24" fill="none" width="22" height="22"><path d="M3.4 3.4 10 12l-6.6 8.6" stroke="#1F35D8" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.6 3.4 14 12l6.6 8.6" stroke="#E8402A" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="#141518"/></svg>';
  const chevalet = '<div class="ch"><div class="chq">' + svg + '</div><div class="cht">' + T.c + '</div>' +
    (nom ? '<div class="chn">' + nom + '</div>' : '') + '<div class="chm">' + marque + '<span>LIAISON</span></div></div>';
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    '@font-face{font-family:Anton;src:url("' + police('anton-400.woff2') + '")}' +
    '@font-face{font-family:G;src:url("' + police('grotesk-400.woff2') + '")}' +
    '@font-face{font-family:G;font-weight:700;src:url("' + police('grotesk-700.woff2') + '")}' +
    '@font-face{font-family:M;src:url("' + police('mono-400.woff2') + '")}' +
    '@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:G,sans-serif;color:#141518}' +
    '.pg{width:210mm;height:297mm;page-break-after:always;position:relative;overflow:hidden;background:#F5F1E8}' +
    '.a{padding:22mm 20mm;display:flex;flex-direction:column;align-items:center;text-align:center;height:100%}' +
    '.a .m{display:flex;align-items:center;gap:8px;font-family:M;letter-spacing:.3em;font-size:11pt;color:#5A5D64}' +
    '.a h1{font-family:Anton;font-weight:400;text-transform:uppercase;font-size:64pt;line-height:.95;margin:14mm 0 5mm;letter-spacing:.01em}' +
    '.a .n{font-family:M;font-size:14pt;letter-spacing:.14em;text-transform:uppercase;color:#1F35D8;margin-bottom:9mm}' +
    '.a .q{width:118mm;height:118mm;padding:6mm;background:#fff;border-radius:6mm;box-shadow:0 2mm 8mm rgba(0,0,0,.12)}' +
    '.a .q svg{width:100%;height:100%}' +
    '.a .s{font-size:17pt;margin:10mm 0 3mm;max-width:150mm;line-height:1.35}.a .p{font-family:M;font-size:11pt;color:#5A5D64}' +
    '.a .l{margin-top:4mm;font-family:M;font-size:11pt;color:#E8402A}' +
    '.a .u{margin-top:auto;font-family:M;font-size:10pt;color:#5A5D64;word-break:break-all}' +
    '.g{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:210mm;height:297mm}' +
    '.ch{border:.3mm dashed #C3BCA9;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8mm;text-align:center}' +
    '.chq{width:62mm;height:62mm;background:#fff;padding:3mm;border-radius:3mm}.chq svg{width:100%;height:100%}' +
    '.cht{font-family:Anton;text-transform:uppercase;font-size:24pt;line-height:1;margin-top:6mm}' +
    '.chn{font-family:M;font-size:9pt;letter-spacing:.12em;text-transform:uppercase;color:#1F35D8;margin-top:3mm}' +
    '.chm{display:flex;align-items:center;gap:5px;font-family:M;font-size:8pt;letter-spacing:.3em;color:#5A5D64;margin-top:5mm}.chm svg{width:14px;height:14px}' +
    '</style></head><body>' +
    '<div class="pg"><div class="a"><div class="m">' + marque + '<span>LIAISON</span></div><h1>' + T.h + '</h1>' +
    (nom ? '<div class="n">' + nom + '</div>' : '') + '<div class="q">' + svg + '</div><div class="s">' + T.s + '</div>' +
    '<div class="p">' + T.p + '</div>' + (local ? '<div class="l">' + T.local + '</div>' : '') +
    '<div class="u">' + String(o.url || '').replace(/[&<>]/g, '') + '</div></div></div>' +
    '<div class="pg"><div class="g">' + chevalet + chevalet + chevalet + chevalet + '</div></div>' +
    '</body></html>';
  return html;
}
module.exports = { htmlAffiche };
