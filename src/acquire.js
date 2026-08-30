'use strict';
/* ============================================================
   Liaison — trouver ce qui manque.

   Le probleme reel : un titre est demande, le DJ ne l'a pas, et il
   lui faut le fichier vite. La reponse n'est pas de l'extraire d'une
   plateforme de streaming — c'est de l'emmener en deux clics la ou il
   s'achete, et de verifier d'abord qu'il ne l'a pas deja sous un
   autre nom.

   Trois etages, du moins cher au plus cher en temps :
     1. « tu l'as peut-etre deja »  — rapprochement flou, seuil bas
     2. l'achat au titre            — Beatport, Qobuz, Bandcamp, iTunes
     3. l'abonnement de cabine      — Beatport/Beatsource LINK, qui
                                      jouent dans Serato et rekordbox
                                      sans fichier a telecharger
   ============================================================ */

const q = s => encodeURIComponent(String(s || '').trim());

/** Ou acheter ce titre. Recherche pre-remplie, aucun compte requis pour chercher. */
function buyLinks(entry) {
  const a = entry.artist || '';
  const t = entry.title || '';
  const both = (a ? a + ' ' : '') + t;
  return [
    { id: 'beatport', name: 'Beatport',  url: 'https://www.beatport.com/search?q=' + q(both),
      note: 'electronique, WAV et AIFF' },
    { id: 'qobuz',    name: 'Qobuz',     url: 'https://www.qobuz.com/fr-fr/search?q=' + q(both),
      note: 'francais, achat en FLAC' },
    { id: 'bandcamp', name: 'Bandcamp',  url: 'https://bandcamp.com/search?q=' + q(both),
      note: 'independants, sans DRM' },
    { id: 'itunes',   name: 'iTunes',    url: 'https://music.apple.com/fr/search?term=' + q(both),
      note: 'catalogue grand public' },
    { id: 'juno',     name: 'Juno',      url: 'https://www.junodownload.com/search/?q%5Ball%5D%5B%5D=' + q(both),
      note: 'fonds de catalogue' }
  ];
}

/** Les abonnements qui jouent directement dans le logiciel de mix. */
const POOLS = [
  { name: 'Beatsource LINK', url: 'https://www.beatsource.com/link',
    note: "Open format — le repertoire mariage et club. Joue dans Serato et rekordbox, avec un cache hors ligne." },
  { name: 'Beatport LINK', url: 'https://www.beatport.com/link',
    note: 'Electronique. Meme principe, meme integration.' }
];

/**
 * « Tu l'as peut-etre deja. »
 * Le rapprochement strict a echoue, mais un seuil plus bas rattrape les
 * ecarts d'ecriture : un remix note autrement, un accent oublie, un
 * featuring ecrit a l'envers. On propose, on n'impose pas.
 */
function nearMisses(entry, library, match, limit) {
  const qy = (entry.artist ? entry.artist + ' ' : '') + entry.title;
  const out = [];
  const seen = new Set();
  for (const th of [0.5, 0.44, 0.38]) {
    const m = match(qy, library, th);
    if (m && !seen.has(m.track.id)) {
      seen.add(m.track.id);
      out.push({ id: m.track.id, artist: m.track.artist, title: m.track.title,
                 score: Math.round(m.score * 100) });
      if (out.length >= (limit || 2)) break;
    }
  }
  return out;
}

/** La liste de courses, en texte collable dans un panier ou un mail. */
function shoppingList(missing) {
  return (missing || [])
    .map(m => (m.artist ? m.artist + ' - ' : '') + m.title)
    .join('\n');
}

module.exports = { buyLinks, POOLS, nearMisses, shoppingList };
