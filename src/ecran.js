'use strict';
/* Ramene un rectangle de fenetre dans une zone utile d'ecran.
   Pur calcul, pour pouvoir l'eprouver sans Electron. */
function ramener(b, wa, marge) {
  const m = marge == null ? 8 : marge;
  const width = Math.max(1, Math.min(b.width, wa.width - 2 * m));
  const height = Math.max(1, Math.min(b.height, wa.height - 2 * m));
  const x = Math.min(Math.max(b.x, wa.x + m), wa.x + wa.width - width - m);
  const y = Math.min(Math.max(b.y, wa.y + m), wa.y + wa.height - height - m);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
module.exports = { ramener };
