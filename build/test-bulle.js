'use strict';
/* ============================================================
   « Je mixe Terrien en detresse, et il me propose Boney M. »

   Le rapport vient de Peter Helliot, DJ, en cabine. Rien n'etait
   casse : meme tempo, tonalites compatibles, et un pack de
   mariage francais porte le disco aussi haut que la variete. Le
   moteur repondait parfaitement a la question qu'on lui posait —
   « quel est le meilleur enchainement pour faire monter cette
   soiree ? »

   Ce n'etait pas la question. Pour une soiree a theme, elle est :
   « qu'est-ce qui RESSEMBLE a ce que je viens de passer ? »

   Ce fichier verifie les quatre choses qui font que le mode tient
   en vraie soiree, et pas seulement sur le papier :

     1. la bulle ecarte le morceau hors style — la porte se ferme ;
     2. sans bulle, RIEN ne change : le comportement par defaut
        n'est pas touche d'un point ;
     3. la bulle ne derive pas : ancree une fois, elle ne se laisse
        pas emmener ailleurs par la chaine des propositions ;
     4. une bulle trop etroite ne rend jamais une liste vide.

   Et il porte son temoin : on rejoue le cas signale SANS la bulle
   pour verifier que le defaut se reproduit bien. Un essai qui
   passerait au vert sur l'ancien code ne prouverait rien.
   ============================================================ */
const engine = require('../src/engine.js');
const bulle = require('../src/bulle.js');
const lib = require('../src/library.js');

let echecs = 0;
function verifier(quoi, condition, detail) {
  if (!condition) echecs++;
  console.log('  %s %s%s', condition ? 'ok  ' : 'RATE', quoi.padEnd(54),
              detail ? '  — ' + detail : '');
}

/* Les morceaux passent par finalize() : c'est le vrai chemin, celui
   qui pose les etiquettes, les identifiants et l'annee. Un essai qui
   fabrique ses objets a la main ne prouve rien — la lecon de
   test-suggestions.js, payee une fois. */
function viaBibliotheque(bruts) {
  const out = lib.finalize(bruts.map(b => Object.assign({}, b)));
  for (let i = 0; i < out.length; i++) {
    if (bruts[i].analyse) {
      out[i].analyzed = true;
      out[i].energy = bruts[i].energy;
      out[i].timbre = bruts[i].timbre;
    }
  }
  return out;
}
const nom = t => (t.path || '').replace('/m/', '').replace('.mp3', '');

/* ------------------------------------------------------------
   La scene, reconstituee.

   Le morceau joue : de la variete francaise des annees 2000.
   Le faux ami : du disco de 1978, meme tempo, meme tonalite,
   tres connu — donc tres bien note par un pack de mariage.
   Les bons : de la variete francaise de la meme decennie.
   ------------------------------------------------------------ */
const JOUE = { path: '/m/joue.mp3', artist: 'Peter H.', title: 'Terrien en detresse',
  genre: 'Chanson francaise', bpm: 124, key: '8A', duration: 230, year: 2003, pop: 70,
  analyse: true, energy: 6, timbre: [0.4, 0.5, 0.4] };

const DISCO = { path: '/m/disco.mp3', artist: 'Boney M.', title: 'Daddy Cool',
  genre: 'Disco', bpm: 124, key: '8A', duration: 230, year: 1976, pop: 95,
  analyse: true, energy: 7, timbre: [0.45, 0.5, 0.45] };

function varieteFr(i) {
  return { path: '/m/var' + i + '.mp3', artist: 'Artiste ' + i, title: 'Titre ' + i,
    genre: 'Variete francaise', bpm: 123 + (i % 3), key: '8A', duration: 220,
    year: 2000 + (i % 7), pop: 55 + (i % 10),
    analyse: true, energy: 6, timbre: [0.42, 0.52, 0.41] };
}
/* Un pack de mariage francais : les deux genres y sont hauts. C'est
   exactement ce qui rendait le disco legitime. */
const DNA = { 'variete': 82, 'chanson francaise': 82, 'disco': 80, 'funk': 70, 'pop': 70 };

/* ============================================================
   TEMOIN — le defaut se reproduit-il encore sans la bulle ?
   ============================================================ */
{
  const bib = viaBibliotheque([JOUE, DISCO, varieteFr(1), varieteFr(2)]);
  const r = engine.suggest(bib[0], bib, { limit: 4, arc: 'up', dna: DNA, mode: 'crowd' });
  const noms = r.map(x => nom(x.track));
  const place = noms.indexOf('disco');
  console.log('\n  temoin — sans bulle, ordre : ' + noms.join(', '));
  verifier('temoin : le disco est bien propose sans la bulle',
           place !== -1, place === -1 ? 'le cas signale ne se reproduit plus'
                                      : 'en position ' + (place + 1));
}

/* ============================================================
   1. La porte : dans la bulle, le hors-style sort.
   ============================================================ */
{
  const bruts = [JOUE, DISCO];
  for (let i = 1; i <= 8; i++) bruts.push(varieteFr(i));
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);
  verifier('1. la bulle lit l\'epoque de la bibliotheque',
           B && B.avecAnnees === true, B ? B.etiquette + ' (' + B.partAnnees + ' % d\'annees)' : 'aucune');
  const r = engine.suggest(bib[0], bib, { limit: 4, arc: 'up', dna: DNA, mode: 'crowd', bulle: B });
  const noms = r.map(x => nom(x.track));
  verifier('1bis. le disco de 1976 ne sort plus',
           !noms.includes('disco'), 'propose : ' + noms.join(', '));
  verifier('1ter. la liste est pleine malgre le filtre',
           r.length === 4, r.length + ' propositions');
  verifier('1quater. tout ce qui sort est marque dans la bulle',
           r.every(x => x.dansBulle && x.bulle >= 60),
           'notes de bulle : ' + r.map(x => x.bulle).join(', '));
}

/* ============================================================
   2. Sans bulle, rien ne bouge.

   Un mode qui deplacerait le comportement par defaut serait une
   regression deguisee en fonctionnalite. On compare donc le
   classement obtenu sans « bulle » a celui d'avant : il doit etre
   identique, morceau pour morceau et note pour note.
   ============================================================ */
{
  const bruts = [JOUE, DISCO];
  for (let i = 1; i <= 8; i++) bruts.push(varieteFr(i));
  const bib = viaBibliotheque(bruts);
  /* ---------- comment ce cas doit etre ecrit ----------
     La premiere version comparait suggest(...) a suggest(..., bulle:
     null). Or le moteur lit « opt.bulle || null » : les deux appels
     etaient strictement identiques. Le test ne pouvait pas echouer,
     et ne prouvait rien.

     On fige donc le resultat attendu EN DUR — l'ordre et les notes
     relevees sur le moteur d'avant la bulle. Si une correction future
     deplace le comportement par defaut d'un seul point, ce cas
     tombe, et c'est exactement ce qu'on lui demande. */
  const ATTENDU = 'disco=95 var1=92 var4=92 var5=92 var6=92';
  const obtenu = engine.suggest(bib[0], bib, { limit: 5, arc: 'up', dna: DNA, mode: 'crowd' })
    .map(x => nom(x.track) + '=' + x.total).join(' ');
  verifier('2. sans bulle, le classement d\'avant est intact',
           obtenu === ATTENDU, obtenu === ATTENDU ? obtenu : obtenu + '  (attendu : ' + ATTENDU + ')');
}

/* ============================================================
   3. La bulle ne derive pas.

   C'est la raison d'etre de l'ancrage. Une bulle qui suivrait le
   morceau en cours se deplacerait d'un pas a chaque titre : du
   disco de 1978 au nu-disco de 2015 en six enchainements, chacun
   parfaitement justifie — le defaut d'origine, en plus lent.

   On simule donc une chaine : a chaque tour, on joue la premiere
   proposition, et on verifie qu'au bout de dix titres on est
   toujours dans la meme decennie que l'ancrage.
   ============================================================ */
{
  const bruts = [JOUE];
  /* un chemin de fuite : une passerelle tous les cinq ans, de 2003
     jusqu'aux annees 70. Chaque pas est petit, la somme est enorme. */
  for (let i = 0; i < 8; i++) {
    bruts.push({ path: '/m/pont' + i + '.mp3', artist: 'Pont ' + i, title: 'Pont ' + i,
      genre: i < 4 ? 'Variete francaise' : 'Disco', bpm: 124, key: '8A', duration: 220,
      year: 2000 - i * 4, pop: 70, analyse: true, energy: 6, timbre: [0.42, 0.5, 0.42] });
  }
  for (let i = 1; i <= 10; i++) bruts.push(varieteFr(i));
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);
  /* On joue vraiment : chaque titre retenu entre dans la memoire de
     la soiree, comme en cabine. Sans ca, l'essai tournerait en rond
     entre deux morceaux et validerait une bulle qui ne derive pas
     pour la mauvaise raison. */
  let cur = bib[0], derive = 0;
  const parcours = [], joues = [], distincts = new Set();
  for (let tour = 0; tour < 12; tour++) {
    const r = engine.suggest(cur, bib, { limit: 3, arc: 'up', dna: DNA, mode: 'crowd',
                                         bulle: B, recent: joues });
    if (!r.length) break;
    cur = r[0].track;
    joues.push(cur);
    distincts.add(cur.id);
    parcours.push(cur.year);
    if (Math.abs(cur.year - B.annee) > 10) derive++;
  }
  verifier('3. douze enchainements plus loin, on est encore dans l\'epoque',
           derive === 0, 'annees traversees : ' + parcours.join(', '));
  /* Une bulle qui ne derive pas mais qui tourne sur trois morceaux
     n'est pas un mode, c'est une boucle. Le theme retrecit le vivier :
     il ne doit pas l'effondrer. */
  verifier('3bis. et la soiree ne tourne pas en boucle',
           distincts.size >= 9, distincts.size + ' morceaux distincts sur 12');
}

/* ============================================================
   4. Une bulle etroite ne rend jamais rien de vide.

   La regle de toute cette application : une liste vide est la
   pire reponse possible. Si la bulle ne contient pas de quoi
   remplir, on ouvre la porte — et on marque ce qui en sort.
   ============================================================ */
{
  /* Le morceau joue est d'un genre que rien d'autre ne partage. */
  const seul = Object.assign({}, JOUE, { genre: 'Bagad breton', path: '/m/seul.mp3' });
  const bruts = [seul];
  for (let i = 1; i <= 8; i++) bruts.push(varieteFr(i));
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);
  const r = engine.suggest(bib[0], bib, { limit: 4, arc: 'up', dna: DNA, mode: 'crowd', bulle: B });
  verifier('4. bulle introuvable : on propose quand meme', r.length === 4,
           r.length + ' propositions');
  verifier('4bis. et ce qui sort est marque hors bulle',
           r.some(x => !x.dansBulle), 'dansBulle : ' + r.map(x => x.dansBulle).join(', '));
  const sos = engine.rescue(bib[0], bib, { limit: 3, dna: DNA, bulle: B });
  verifier('4ter. le SOS repond aussi en bulle', sos.length > 0, sos.length + ' propositions');
}

/* ============================================================
   5. Sans annee dans la bibliotheque, l'epoque est retiree —
      pas devinee.
   ============================================================ */
{
  const sansAn = t => { const c = Object.assign({}, t); delete c.year; return c; };
  const bruts = [sansAn(JOUE), sansAn(DISCO)];
  for (let i = 1; i <= 8; i++) bruts.push(sansAn(varieteFr(i)));
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);
  verifier('5. aucune annee : l\'axe des epoques est desactive',
           B && B.avecAnnees === false, B ? B.etiquette : 'aucune');
  const r = engine.suggest(bib[0], bib, { limit: 4, arc: 'up', dna: DNA, mode: 'crowd', bulle: B });
  verifier('5bis. la famille suffit a ecarter le disco',
           !r.map(x => nom(x.track)).includes('disco'),
           'propose : ' + r.map(x => nom(x.track)).join(', '));
}

/* ============================================================
   6. La memoire de variete ne combat plus la bulle.

   Les deux mecaniques se contredisaient : la bulle pousse la meme
   famille en avant, la memoire penalise la famille qui occupe plus
   d'un cinquieme des vingt-quatre derniers titres. Sur une soiree
   a theme, la penalite se declenchait des le quatrieme morceau et
   le mode se defaisait tout seul. La penalite d'ARTISTE, elle,
   doit rester : une soiree annees 80 n'est pas une soiree Michael
   Jackson.
   ============================================================ */
{
  const bruts = [JOUE];
  for (let i = 1; i <= 10; i++) bruts.push(varieteFr(i));
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);
  /* vingt-quatre titres de la meme famille viennent d'etre joues */
  const recent = [];
  for (let i = 0; i < 24; i++) recent.push(bib[1 + (i % 10)]);
  const opts = { limit: 3, arc: 'up', dna: DNA, mode: 'crowd', recent: recent };
  const sans = engine.suggest(bib[0], bib, opts);
  const avec = engine.suggest(bib[0], bib, Object.assign({}, opts, { bulle: B }));
  verifier('6. en bulle, la saturation de genre ne penalise plus',
           avec[0].variete > sans[0].variete,
           'penalite : ' + Math.round(sans[0].variete) + ' sans bulle, ' +
           Math.round(avec[0].variete) + ' en bulle');
  /* Meme artiste que le dernier joue : la penalite doit tenir.
     La premiere version acceptait « le morceau n'est pas dans la
     liste » comme preuve — c'est-a-dire qu'elle passait sans avoir
     rien observe, et elle serait passee de la meme facon si la
     penalite avait ete supprimee. On demande donc TOUTE la liste,
     et on exige de voir la penalite. */
  const autreDuMeme = viaBibliotheque([JOUE, varieteFr(1), varieteFr(2)]);
  autreDuMeme[2].artist = autreDuMeme[1].artist;   /* deux titres du meme artiste */
  const B2 = bulle.ancrer(autreDuMeme[0], autreDuMeme);
  const tout = engine.suggest(autreDuMeme[0], autreDuMeme,
    { limit: 9, arc: 'up', dna: DNA, mode: 'crowd', bulle: B2, recent: [autreDuMeme[1]] });
  const ligne = tout.find(x => x.track.id === autreDuMeme[2].id);
  verifier('6bis. mais la repetition d\'artiste reste penalisee',
           !!ligne && ligne.variete < -20,
           ligne ? 'penalite ' + Math.round(ligne.variete) + ' sur « ' + ligne.track.artist + ' »'
                 : 'RATE : le morceau n\'a meme pas ete note');
}

/* ============================================================
   7. La porte trie, elle ne jette pas.

   Premiere version : « si les morceaux dans la bulle ne
   remplissent pas la liste, on prend la liste normale ». Elle
   jetait donc les morceaux DANS la bulle. Avec quatre titres dans
   le theme et une licence qui en ouvre cinq, le DJ recevait cinq
   propositions hors sujet ; a trois, il en recevait trois, toutes
   bonnes. Le client qui paie le plus recevait le pire resultat, et
   le mode avait l'air de s'eteindre tout seul.
   ============================================================ */
{
  /* ---------- pourquoi ces quatre-la ne se ressemblent pas ----------
     La premiere version donnait aux quatre titres du theme une
     analyse faite ET une annee. Or ce sont justement ces deux
     preferences — « le mesure devant l'inconnu », « l'epoque connue
     devant l'epoque muette » — qui, appliquees a la liste entiere au
     lieu de chaque groupe, defaisaient la porte de la bulle. Le test
     ne pouvait donc pas voir le defaut qu'il existe pour surveiller.

     Deux des quatre sont donc laisses sans analyse et sans annee :
     ce sont les plus faibles a tous les autres egards, et ils
     doivent quand meme passer devant vingt titres hors theme,
     analyses et dates. */
  const bruts = [JOUE];
  for (let i = 1; i <= 4; i++) {
    const t = varieteFr(i);
    if (i >= 3) { delete t.analyse; delete t.energy; delete t.timbre; t.year = null; }
    bruts.push(t);
  }
  for (let i = 1; i <= 20; i++)                                  /* vingt hors sujet, parfaitement calables */
    bruts.push({ path: '/m/tk' + i + '.mp3', artist: 'Techno ' + i, title: 'Tk ' + i,
      genre: 'Techno', bpm: 124, key: '8A', duration: 220, year: 2018, pop: 60,
      analyse: true, energy: 6, timbre: [0.4, 0.5, 0.4] });
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);
  for (const limite of [3, 4, 5, 7]) {
    const r = engine.suggest(bib[0], bib, { limit: limite, arc: 'up', dna: DNA, mode: 'crowd', bulle: B });
    const dedans = r.filter(x => x.dansBulle).length;
    verifier('7. limite ' + limite + ' : les 4 du theme sortent en premier',
             dedans === Math.min(4, limite) &&
             r.slice(0, Math.min(4, limite)).every(x => x.dansBulle),
             r.map(x => nom(x.track) + (x.dansBulle ? '' : ' [hors]')).join(', '));
  }
  /* ---------- le temoin ----------
     On rejoue l'ancienne regle — « les mesures d'abord, sur la liste
     entiere » — pour verifier qu'elle produisait bien le defaut. Sans
     ce controle, ce cas passerait au vert sur l'ancien code aussi. */
  {
    const limite = 5;
    const notes = engine.suggest(bib[0], bib, { limit: 40, arc: 'up', dna: DNA, mode: 'crowd', bulle: B });
    const dans = notes.filter(x => x.dansBulle), dehors = notes.filter(x => !x.dansBulle);
    const ancienVivier = dans.length >= limite ? dans : dans.concat(dehors);
    const mes = ancienVivier.filter(x => x.track.analyzed);
    const ancien = (mes.length >= limite * 2 ? mes : ancienVivier).slice(0, limite);
    const dedansAvant = ancien.filter(x => x.dansBulle).length;
    console.log('\n  temoin — ancienne regle a limite 5 : %d titres du theme sur 5 (regle actuelle : 4)',
                dedansAvant);
    if (dedansAvant >= 4) {
      echecs++;
      console.error('  RATE le temoin ne reproduit plus le defaut : ce cas ne prouve rien.');
    }
  }

  /* ============================================================
     11. Le deja-joue ne double pas le neuf, meme non analyse.

     Meme mecanique que ci-dessus, vue de l'autre bout : quatre
     titres du theme jamais joues mais pas encore analyses, douze
     titres du theme deja passes ce soir et analyses. La preference
     pour le mesure, appliquee apres coup, rendait cinq rediffusions
     sur cinq alors que quatre titres neufs attendaient.
     ============================================================ */
  {
    const b2 = [JOUE];
    for (let i = 1; i <= 4; i++) {                  /* neufs, pas analyses */
      const t = varieteFr(i); delete t.analyse; delete t.energy; delete t.timbre;
      b2.push(t);
    }
    for (let i = 5; i <= 16; i++) b2.push(varieteFr(i));   /* analyses, deja joues */
    const bib2 = viaBibliotheque(b2);
    const B2 = bulle.ancrer(bib2[0], bib2);
    const joues = bib2.slice(5);
    const r = engine.suggest(bib2[0], bib2, { limit: 5, arc: 'up', dna: DNA, mode: 'crowd',
                                              bulle: B2, recent: joues });
    const neufs = r.filter(x => !joues.some(j => j.id === x.track.id)).length;
    verifier('11. les titres neufs passent devant les rediffusions',
             neufs === 4, neufs + ' neufs sur 5 — ' +
             r.map(x => nom(x.track) + (joues.some(j => j.id === x.track.id) ? ' [deja]' : '')).join(', '));
  }

  const sos = engine.rescue(bib[0], bib, { limit: 3, dna: DNA, bulle: B });
  verifier('7bis. le SOS aussi met le theme devant',
           sos.filter(x => x.dansBulle).length === 3,
           sos.map(x => nom(x.track) + (x.dansBulle ? '' : ' [hors]')).join(', '));
}

/* ============================================================
   8. Une bulle sans prise ne se pose pas.

   Ancree sur un morceau sans genre reconnu ET sans annee, la bulle
   ne pouvait rien filtrer — mais elle continuait de deplacer les
   poids : l'ADN de soiree tombait de 0,26 a 0,05, la courbe passait
   en « tenir », la penalite de genre etait levee. Mesure : sur un
   pack de mariage francais, la variete francaise disparaissait des
   propositions, remplacee par du schlager et de la country, toutes
   affichees « dans la bulle ».

   Appuyer sur un bouton de theme ne doit jamais rendre les
   suggestions PIRES.
   ============================================================ */
{
  const muet = { path: '/m/muet.mp3', artist: 'Inconnu', title: 'Sans etiquette',
    genre: '', bpm: 124, key: '8A', duration: 220, pop: 50,
    analyse: true, energy: 6, timbre: [0.4, 0.5, 0.4] };
  const bruts = [muet];
  for (let i = 1; i <= 6; i++) bruts.push(varieteFr(i));
  for (let i = 1; i <= 6; i++)
    bruts.push({ path: '/m/sch' + i + '.mp3', artist: 'Schlager ' + i, title: 'S ' + i,
      genre: 'Schlager', bpm: 124, key: '8A', duration: 220, pop: 50,
      analyse: true, energy: 6, timbre: [0.4, 0.5, 0.4] });
  const bib = viaBibliotheque(bruts);
  /* on retire les annees : plus aucune prise */
  for (const t of bib) t.year = null;
  const B = bulle.ancrer(bib[0], bib);
  verifier('8. sans genre ni annee, on refuse de poser la bulle',
           B && B.impossible === true, B ? (B.raison || B.etiquette) : 'null');
}

/* ============================================================
   9. La cloture epinglee ne blanchit pas son etiquette.

   Elle traverse le crible de tempo et la porte de la bulle — c'est
   un choix delibere du DJ. Mais un reggaeton de 2022 reserve pour
   la fin d'une soiree annees 80 doit s'afficher CLOTURE ET HORS
   BULLE : la premiere version le declarait dans le theme.
   ============================================================ */
{
  /* Juste assez de concurrents pour que la liste soit pleine : une
     cloture reservee est un choix, pas un favori — on verifie
     qu'elle SORT et qu'elle est bien etiquetee, pas qu'elle gagne. */
  const bruts = [JOUE];
  for (let i = 1; i <= 4; i++) bruts.push(varieteFr(i));
  bruts.push({ path: '/m/fin.mp3', artist: 'Fin', title: 'La derniere',
    genre: 'Reggaeton', bpm: 96, key: '3A', duration: 220, year: 2022, pop: 90,
    analyse: true, energy: 8, timbre: [0.9, 0.1, 0.9] });
  const bib = viaBibliotheque(bruts);
  const cloture = bib[bib.length - 1];
  const B = bulle.ancrer(bib[0], bib);
  const r = engine.suggest(bib[0], bib, { limit: 5, arc: 'up', dna: DNA, mode: 'crowd',
                                          bulle: B, epingle: cloture.id });
  const ligne = r.find(x => x.track.id === cloture.id);
  verifier('9. la cloture reservee ressort quand meme', !!ligne,
           ligne ? 'note ' + ligne.total : 'absente');
  verifier('9bis. mais elle est marquee hors bulle',
           ligne && ligne.cloture === true && ligne.dansBulle === false,
           ligne ? 'cloture=' + ligne.cloture + ' dansBulle=' + ligne.dansBulle : '');
}

/* ============================================================
   10. La boucle — le defaut qu'a revele la correction precedente.

   Une fois la porte de la bulle reparee (cas 7), une soiree a
   theme de 120 enchainements sur 22 000 titres ne tenait plus que
   VINGT-QUATRE morceaux distincts : chaque titre rejoue cinq fois.
   La porte classait par appartenance avant de regarder la note, si
   bien qu'un titre du theme deja passe passait devant un titre neuf
   hors theme.

   Rejouer cinq fois le meme morceau gache une soiree bien plus
   surement qu'un ecart de style. L'ordre est donc : dans la bulle
   et pas encore joue, puis hors bulle et pas encore joue, puis le
   reste.
   ============================================================ */
{
  /* Six titres dans le theme, dix hors theme : de quoi tenir seize
     enchainements sans jamais se repeter. */
  const bruts = [JOUE];
  for (let i = 1; i <= 6; i++) bruts.push(varieteFr(i));
  for (let i = 1; i <= 10; i++)
    bruts.push({ path: '/m/tk' + i + '.mp3', artist: 'Techno ' + i, title: 'Tk ' + i,
      genre: 'Techno', bpm: 124, key: '8A', duration: 220, year: 2018, pop: 60,
      analyse: true, energy: 6, timbre: [0.4, 0.5, 0.4] });
  const bib = viaBibliotheque(bruts);
  const B = bulle.ancrer(bib[0], bib);

  let cur = bib[0];
  const joues = [], distincts = new Set(), horsApres = [];
  for (let tour = 0; tour < 14; tour++) {
    const r = engine.suggest(cur, bib, { limit: 3, arc: 'up', dna: DNA, mode: 'crowd',
                                         bulle: B, recent: joues });
    if (!r.length) break;
    cur = r[0].track;
    joues.push(cur); distincts.add(cur.id);
    if (tour >= 6) horsApres.push(!r[0].dansBulle);
  }
  verifier('10. quatorze titres joues, quatorze titres differents',
           distincts.size === 14, distincts.size + ' distincts');
  /* Et la preuve que c'est bien l'arbitrage attendu : une fois les
     six titres du theme epuises, l'application SORT de la bulle au
     lieu de les rejouer — en le marquant. */
  verifier('10bis. le theme epuise, on sort plutot que de rejouer',
           horsApres.some(Boolean),
           'sorties de bulle apres le 6e titre : ' + horsApres.filter(Boolean).length);
}

if (echecs) {
  console.error('\n' + echecs + ' cas de bulle en echec.');
  process.exit(1);
}
console.log('\nbulle : la soiree a theme reste dans son epoque et son style.');
