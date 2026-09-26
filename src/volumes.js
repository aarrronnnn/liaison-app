'use strict';
/* ============================================================
   OU VIT REELLEMENT LE FICHIER QU'UNE BASE DESIGNE.

   Trois des cinq formats de bibliotheque ecrivent un chemin qui
   n'est PAS absolu : ils le donnent relatif au volume, et rangent
   le volume a part — ou pas du tout.

     Serato    « Music/x.mp3 », le volume est celui qui porte
               le dossier _Serato_
     Traktor   DIR="/:Music/:" FILE="x.mp3" VOLUME="D:"
               (sous macOS, VOLUME est le NOM du volume)
     rekordbox file://localhost/D:/Music/x.mp3   — absolu, lui
     iTunes    file://localhost/D:/Music/x.mp3   — absolu aussi
     VirtualDJ FilePath absolu

   Les deux premiers ont produit le meme bug, a des mois
   d'intervalle : le chemin rendu n'avait pas de racine, aucun
   fichier ne repondait, l'elagage « fichier introuvable » faisait
   son travail, et la bibliotheque tombait a zero. Sans une erreur.

   Et ce bug est INVISIBLE sur la machine de developpement : sur le
   disque de demarrage d'un Mac, « / » + chemin tombe juste. Il ne
   se voit que sur Windows, ou sur un volume externe — c'est-a-dire
   chez la moitie des DJ et sur le disque qu'ils emportent.

   Ce module tient la regle une fois pour toutes, et il NE DEVINE
   PAS : il propose les interpretations possibles et garde celle
   qui designe un fichier existant.
   ============================================================ */
const fs = require('fs');

/** La racine du volume qui porte ce fichier de base. */
function racineDuVolume(fichier, plateforme) {
  const win = (plateforme || process.platform) === 'win32';
  const f = String(fichier || '');
  if (win) {
    const m = /^([A-Za-z]:)[\\/]/.exec(f);
    return m ? m[1] + '\\' : '';
  }
  const m = /^(\/Volumes\/[^/]+)(?=\/)/.exec(f)
         || /^(\/media\/[^/]+\/[^/]+)(?=\/)/.exec(f)
         || /^(\/mnt\/[^/]+)(?=\/)/.exec(f);
  return m ? m[1] : '';
}

function estAbsolu(p, win) {
  return win ? /^[A-Za-z]:[\\/]/.test(p) : String(p).startsWith('/');
}

function parDefaut(x) {
  try { return fs.statSync(x).isFile(); } catch (e) { return false; }
}

/**
 * Le chemin reel d'un morceau.
 *
 * @param {string} p     chemin tel que la base l'ecrit
 * @param {string} base  racine du volume (peut etre vide)
 * @param {{plateforme?:string, existe?:Function, autres?:string[]}} opt
 */
function resoudre(p, base, opt) {
  opt = opt || {};
  const plateforme = opt.plateforme || process.platform;
  const win = plateforme === 'win32';
  const existe = opt.existe || parDefaut;
  const sep = win ? '\\' : '/';
  const brut = String(p || '');

  /* ------------------------------------------------------------
     POURQUOI ON NE PEUT PAS SE FIER AU SLASH INITIAL.

     Un DIR de Traktor commence TOUJOURS par « / » et n'est
     pourtant pas un chemin absolu : il est relatif au volume que
     l'attribut VOLUME designe a cote. « /Music/x.mp3 » sur le SSD
     « SSD DJ » veut dire /Volumes/SSD DJ/Music/x.mp3.

     Une premiere version rendait donc le chemin tel quel des qu'il
     commencait par un slash — et se trompait exactement comme
     avant sur les volumes externes.

     On construit donc TOUTES les lectures plausibles, celle du
     chemin nu comprise, et c'est le disque qui tranche. On ne rend
     une supposition que si aucune ne repond.
     ------------------------------------------------------------ */
  const nu = brut.replace(/^[\\/]+/, '');
  const candidats = [];
  const poser = b => {
    if (b === undefined || b === null) return;
    const r = String(b).replace(/[\\/]+$/, '');
    if (!r) return;
    candidats.push(r + sep + (win ? nu.replace(/\//g, '\\') : nu));
  };
  poser(base);
  for (const a of (opt.autres || [])) poser(a);
  const absolu = estAbsolu(brut, win);
  if (absolu) candidats.push(brut);
  if (!win && !absolu) candidats.push('/' + nu);

  for (const c of candidats) if (existe(c)) return c;
  /* Rien ne repond — disque debranche, par exemple. On rend la
     lecture la plus probable, pour que l'elagage puisse encore
     distinguer « efface » de « hors ligne ». */
  if (absolu) return brut;
  return candidats[0] || brut;
}

/**
 * Traktor range le volume a part, et pas de la meme facon selon le
 * systeme : « D: » sous Windows, le NOM du volume sous macOS. On
 * fabrique donc les racines plausibles, et resoudre() tranche sur
 * l'existence du fichier.
 */
function racinesTraktor(volume, plateforme) {
  const v = String(volume || '').trim();
  if (!v) return [];
  const win = (plateforme || process.platform) === 'win32';
  if (win) return [/^[A-Za-z]:$/.test(v) ? v + '\\' : v];
  /* macOS : « Macintosh HD » est le disque de demarrage, les autres
     sont montes sous /Volumes. On propose les deux, dans cet ordre. */
  return ['/Volumes/' + v, ''];
}

/* ============================================================
   LES VRAIS DOSSIERS « MUSIQUE » ET « DOCUMENTS ».

   Windows 11 pousse la sauvegarde OneDrive : Musique et Documents
   sont alors deplaces dans OneDrive (…\OneDrive\Musique), et un
   disque D: peut aussi les accueillir. Serato y range _Serato_,
   Traktor et VirtualDJ y rangent leurs bases. On ne cherchait que
   sous le dossier personnel : bibliotheque vide, et aucune
   detection du morceau en cours avec Serato.

   main.js fournit les chemins que le systeme connait (ils suivent
   la redirection) ; on garde les emplacements classiques en plus.
   ============================================================ */
function uniques(l) {
  const vus = new Set(), out = [];
  for (const p of l) {
    if (!p) continue;
    const k = process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p;
    if (vus.has(k)) continue;
    vus.add(k); out.push(p);
  }
  return out;
}
function dossiersMusique() {
  const os = require('os'), path = require('path');
  const h = os.homedir(), od = process.env.OneDrive || process.env.OneDriveConsumer || '';
  return uniques([
    process.env.LIAISON_MUSIQUE,
    path.join(h, 'Music'), path.join(h, 'Musique'), path.join(h, 'Musik'),
    od && path.join(od, 'Music'), od && path.join(od, 'Musique'), od && path.join(od, 'Musik')
  ]);
}
function dossiersDocuments() {
  const os = require('os'), path = require('path');
  const h = os.homedir(), od = process.env.OneDrive || process.env.OneDriveConsumer || '';
  return uniques([
    process.env.LIAISON_DOCUMENTS,
    path.join(h, 'Documents'),
    od && path.join(od, 'Documents')
  ]);
}

module.exports = { racineDuVolume, resoudre, estAbsolu, racinesTraktor, dossiersMusique, dossiersDocuments };
