'use strict';
/* ============================================================
   LE FILTRE PAR STYLE DOIT AFFICHER DES MOTS, ET FILTRER.

   Panne constatee : en ouvrant « Style », le DJ voyait un rang de
   pastilles sans texte — seulement des nombres — et cliquer
   dessus ne changeait rien.

   La cause n'etait ni dans le calcul des styles ni dans le
   filtrage : les deux marchaient. C'etait un DESACCORD DE
   CONTRAT. genresDuDJ() rend { cle, libelle, n, famille } ; le
   widget lisait « g.tag », qui n'existe pas. L'etiquette sortait
   vide, data-g sortait vide, et le cote principal jetait la
   chaine vide avec un .filter(Boolean).

   Personne ne pouvait le voir : pas d'exception, pas de log, une
   interface qui s'affiche « normalement » et un filtre qui ne
   filtre pas. C'est exactement la panne muette qu'on a deja
   rencontree deux fois cette semaine — le champ « name » lu
   « nom », et ffprobe qui ne demarre pas.

   Ce test ne verifie donc pas seulement la correction : il tient
   le CONTRAT entre les deux cotes. Il lit les champs que la page
   utilise vraiment et exige qu'ils existent sur ce que le cote
   principal envoie.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const genres = require('../src/genres');
const filtres = require('../src/filters');

let ko = 0;
function verifier(quoi, ok, detail) {
  console.log('  ' + (ok ? 'ok   ' : 'RATE ') + quoi.padEnd(58) + (ok || !detail ? '' : '  — ' + detail));
  if (!ok) ko++;
}

console.log('\n- Le filtre par style -\n');

/* Une bibliotheque comme celle d'un DJ : orthographes melangees,
   une etiquette anecdotique, et des accents. */
function morceau(id, tags) { return { id: id, title: 't' + id, artist: 'a', tags: tags }; }
const biblio = [];
for (let i = 0; i < 40; i++) biblio.push(morceau(i, ['House']));
for (let i = 40; i < 70; i++) biblio.push(morceau(i, ['house']));      /* meme style, autre casse */
for (let i = 70; i < 95; i++) biblio.push(morceau(i, ['Variété française']));
for (let i = 95; i < 110; i++) biblio.push(morceau(i, ['Hip-Hop']));
biblio.push(morceau(999, ['Zoukk']));                                   /* une coquille isolee */

const liste = genres.genresDuDJ(biblio, 18);
verifier('la bibliotheque rend des styles', liste.length > 0, liste.length + ' styles');

/* ------------------------------------------------------------
   LE CONTRAT : les champs que la page lit doivent exister.

   On ne recopie pas la liste des champs a la main — on la LIT
   dans widget.html, a l'endroit ou les pastilles sont fabriquees.
   Le jour ou quelqu'un y ecrit « g.machin », ce test tombe, au
   lieu de laisser sortir une interface muette.
   ------------------------------------------------------------ */
const page = fs.readFileSync(path.join(__dirname, '..', 'src', 'ui', 'widget.html'), 'utf8');
const bloc = page.slice(page.indexOf('box.innerHTML = liste.map(g =>'));
const rendu = bloc.slice(0, bloc.indexOf('.join(\'\');'));
const champs = Array.from(new Set((rendu.match(/\bg\.([A-Za-z_$][\w$]*)/g) || [])
  .map(x => x.slice(2))));
verifier('on a bien trouve le rendu des pastilles dans la page',
  champs.length > 0, champs.join(', '));
for (const c of champs) {
  verifier('la page lit « g.' + c + ' », et le cote principal l\'envoie',
    liste.every(g => g[c] !== undefined),
    'absent de { ' + Object.keys(liste[0] || {}).join(', ') + ' }');
}

/* L'etiquette affichee doit etre un mot, pas un vide ni un nombre. */
const libelles = liste.map(g => g.libelle);
verifier('chaque style porte un libelle non vide',
  libelles.every(x => typeof x === 'string' && x.trim().length > 1), JSON.stringify(libelles.slice(0, 4)));
verifier('et ce libelle n\'est pas un nombre deguise',
  libelles.every(x => !/^\d+$/.test(String(x).trim())), JSON.stringify(libelles.slice(0, 4)));

/* L'orthographe la plus repandue l'emporte : 40 « House » contre
   30 « house ». Le DJ doit lire la sienne. */
const house = liste.find(g => genres.aplatir(g.libelle) === genres.aplatir('house'));
verifier('l\'orthographe la plus frequente du DJ est retenue',
  !!house && house.libelle === 'House', house && house.libelle);
verifier('et les deux graphies sont comptees ensemble',
  !!house && house.n === 70, house && String(house.n));

/* ------------------------------------------------------------
   ET SURTOUT : cliquer doit filtrer.

   On envoie exactement ce que la pastille mettrait dans data-g,
   et on verifie que le tamis retient les bons morceaux.
   ------------------------------------------------------------ */
const choisi = house ? house.libelle : libelles[0];
const retenus = filtres.apply(biblio, { genres: [choisi] });
const tracks = retenus.tracks || retenus;
verifier('choisir un style retient les morceaux de ce style',
  tracks.length === 70, tracks.length + ' morceaux retenus');
verifier('et laisse dehors ceux des autres styles',
  tracks.every(t => genres.aplatir(t.tags[0]) === genres.aplatir('house')));

/* L'accent ne doit pas empecher le rapprochement. */
const variete = liste.find(g => /vari/i.test(g.libelle));
const rv = filtres.apply(biblio, { genres: [variete.libelle] });
verifier('un style accentue filtre aussi bien',
  (rv.tracks || rv).length === 25, String((rv.tracks || rv).length));

/* Une etiquette portee par un seul morceau sur cent-dix n'est pas
   un style : elle ne doit pas encombrer le tiroir. */
verifier('la coquille isolee n\'est pas proposee',
  !liste.some(g => /zoukk/i.test(g.libelle)), JSON.stringify(libelles));

/* Rien de choisi : rien n'est retire. */
const rien = filtres.apply(biblio, { genres: [] });
verifier('sans style choisi, toute la bibliotheque passe',
  (rien.tracks || rien).length === biblio.length, String((rien.tracks || rien).length));

console.log(ko ? '\n' + ko + ' cas en echec.\n'
               : '\nstyles : les pastilles portent des mots, et elles filtrent.\n');
process.exit(ko ? 1 : 0);
