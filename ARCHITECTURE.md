# Liaison — architecture

> Ce fichier est ecrit pour etre lu par une IA qui decouvre le projet.
> Il decrit ce qui EXISTE, pourquoi c'est construit ainsi, et ce qu'il
> ne faut pas casser. Il n'y a rien a deviner ailleurs : si quelque
> chose manque ici, c'est un defaut de ce fichier, pas du lecteur.
>
> Convention d'ecriture du projet : **le code et les commentaires sont
> en francais SANS ACCENTS**. Les textes affiches a l'utilisateur, eux,
> portent leurs accents. Garder cette regle.

---

## 1. Ce qu'est Liaison, en trois phrases

Un DJ en cabine vient de lancer un morceau. Liaison, un petit widget
toujours au-dessus des autres fenetres, lui dit **quels morceaux de SA
bibliotheque s'enchainent le mieux apres celui-la**, en direct, et
pourquoi.

Rien ne sort de la machine : la bibliotheque, l'analyse audio et les
suggestions sont locales. Le reseau ne sert qu'a trois choses —
verifier la licence, annoncer une mise a jour, et servir la page des
invites en Wi-Fi local.

Le produit se vend a la licence depuis **liaisondj.app**.

---

## 2. Les deux moities du produit

| Moitie | Ou | Quoi |
|---|---|---|
| **L'application** | `liaison/` (ce depot) | Electron 32, macOS + Windows. Construite par GitHub Actions en `.dmg` et `.exe`. |
| **Le site** | `liaison-web/` (depot voisin) | Vercel. Pages statiques generees + douze fonctions serverless : paiement Stripe, signature des licences, telechargement. |

Les deux sont publies **ensemble**, par un seul script, depuis une
seule archive. Voir §4.

---

## 3. Les regles absolues

Ces regles ont chacune coute une soiree ratee ou une journee de
travail. Les enfreindre est toujours une regression.

1. **La porte trie, elle ne jette pas.** Chaque axe de notation est un
   SCORE, jamais un filtre. Un morceau sans tag de tonalite, sans BPM,
   sans genre, doit toujours pouvoir etre propose. La seule chose qui
   retire vraiment un morceau, c'est un filtre explicite demande par le
   DJ (`filters.js`) ou la liste rouge du client.
2. **Une liste vide est un bug.** Si le moteur ne propose rien,
   l'utilisateur doit voir **pourquoi**, nomme et en francais
   (`raisonDuVide()` dans `main.js`). Jamais un ecran muet.
3. **La source la plus fiable fait foi** (regle revue le 18/09/2026 ;
   elle disait « notre mesure fait foi » et elle ecrasait des grilles
   rekordbox justes). Un BPM ou une tonalite porte desormais sa
   PROVENANCE (`bpmSrc` / `keySrc`) et un rang de fiabilite
   (`library.fiabilite`) : rekordbox, Serato, Traktor et VirtualDJ
   valent 3 — ils ont analyse le fichier pour poser une grille sur
   laquelle le DJ mixe, on ne les contredit jamais, on signale
   seulement le desaccord. Notre mesure vaut 2. iTunes et les tags ID3
   valent 1 : ce sont des SAISIES, et notre mesure les corrige des
   qu'elle est sure. Un DJ qui n'a que le titre du morceau doit
   obtenir le meme service qu'un DJ qui a tout tague (§8.3).
4. **Rien ne bloque le fil principal.** L'analyse audio et l'analyse de
   structure tournent dans des `worker_threads`. Le widget doit
   repondre pendant qu'une bibliotheque de 22 000 titres s'analyse.
5. **Aucune ecriture destructive.** Tous les fichiers de donnees
   passent par `ecrire.js` (ecriture atomique : fichier temporaire puis
   `rename`). `fs.writeFileSync` sur un fichier de donnees est interdit.
6. **Les cles privees ne partent jamais.** `lib/keys.js` et
   `.keys.json` sont exclus de toute archive et de tout depot. Verifier
   avant chaque archive : `find . -iname '*keys*' | wc -l` doit rendre 0.
7. **Chaque correction porte son temoin.** Un test qui echoue AVANT le
   correctif et passe apres. On ne modifie pas un test pour le faire
   passer : on corrige le code, ou on justifie par une mesure pourquoi
   l'attente du test etait fausse.
8. **Toute correction de `analyze.js` monte `VERSION_MESURE`** dans
   `analysis.js`. La cle du cache est « chemin + taille + date » :
   sans ce numero, une mesure corrigee ne serait jamais relue chez un
   DJ qui a deja son cache, et la mise a jour ne changerait rien de
   visible pour lui. Voir §8.7.
9. **`npm run verifier` doit etre vert avant toute publication.**

---

## 4. Le rituel de publication

C'est le point le plus dangereux du projet — il a deja efface une
journee de travail. Le comprendre avant de toucher a quoi que ce soit.

**L'archive fait foi.** `PUBLIER.command` (sur le Mac, a la racine de
`~/Projets/Liaison/`) fait, dans l'ordre :

```
liaison-<VERSION>.tar.gz     <-- la SEULE source de verite
   |
   |-- rm -rf liaison-app/src          (le seul dossier dont l'archive est proprietaire)
   |-- deverse liaison/       par-dessus liaison-app/
   |-- deverse liaison-web/   par-dessus liaison-web/
   |-- range les doublons du Finder (« fichier 2.js ») dans _archives/doublons/
   |-- node build/verifier-config.js && node build/demarrage.js
   |-- git commit + tag v<VERSION> + push   -> GitHub Actions construit .dmg et .exe
   +-- git push liaison-web                 -> Vercel redeploie
```

Consequences a retenir :

- **Tout ce qui n'est pas dans l'archive est efface au prochain
  publish.** Modifier directement un fichier dans `liaison-app/` est
  inutile : il sera ecrase. Toute modification doit entrer dans la
  prochaine archive.
- La variable `VERSION` en tete de `PUBLIER.command` doit etre montee a
  chaque version, et correspondre au `package.json` de l'archive. Un
  garde-fou refuse de continuer si les deux divergent.
- **Ne jamais lancer `git` sur le Mac par un pont exterieur** : cela
  laisse un `index.lock` qui bloque `PUBLIER.command`.
- **Modifier `PUBLIER.command` de l'exterieur lui retire son droit
  d'execution.** `sed -i` ecrit un fichier neuf et le renomme par-dessus :
  le bit `+x` ne suit pas, et le double-clic repond
  `zsh: permission denied`. Toujours refaire `chmod +x PUBLIER.command`
  apres l'avoir modifie.
- **Ne jamais faire `tar x` directement dans le dossier monte** : il ne
  peut pas faire `unlink`. Utiliser une boucle `cat "$f" > "$APP/$f"`.

---

## 5. Le chemin d'une suggestion

C'est le coeur. Neuf etapes, du materiel jusqu'au widget.

```
  1. DETECTION      src/sources/*        « quel morceau tourne ? »
          |          Pro DJ Link (UDP 50002) | fichiers ouverts rekordbox
          |          | historique Serato | tracklist VirtualDJ | Icecast Traktor
          v
  2. RAPPROCHEMENT  engine.match()       texte -> ligne de bibliotheque (Dice + mots)
          |         exterieur.js         rien ne correspond ? on fabrique le morceau
          |                              a partir du fichier, ou du texte
          v
  3. BIBLIOTHEQUE   library.js           titre, artiste, bpm, key, genre, chemin
          |         autolibrary.js       lue automatiquement chez Serato/Traktor/
          |                              VirtualDJ/rekordbox/iTunes, ou par scan
          v
  4. ANALYSE        analysis.js          file d'attente, cache, priorites
          |         analyze-worker.js    -> analyze.js : ffmpeg -> 22050 Hz mono
          |                              -> energie, timbre[3], BPM + confiance
          |         structure.js         -> entree/sortie de batterie, grille
          v
  5. CONTEXTE       locales.js           pays x type de soiree -> ADN de genres
          |         filters.js           ce que la salle interdit ce soir
          |         soirees.js           reglages memorises par soiree
          |         clientlist.js        titres demandes / liste rouge
          v
  6. MOTEUR         engine.suggest()     crible tempo -> 11 axes -> note -> ordre
          |         plancher.js parente.js bulle.js epoque.js affinites.js genres.js
          v
  7. APPRENTISSAGE  gout.js              ce que CE DJ prend ou ignore -> poids
          v
  8. ORCHESTRATION  main.js              computeSuggestions(), setCurrent(),
          |                              envoyerNow(), raisonDuVide()
          v
  9. AFFICHAGE      src/ui/widget.html   via preload.js (contextBridge)
```

---

## 6. Carte des fichiers

### `src/` — le processus principal et la logique

| Fichier | Son travail, en une ligne |
|---|---|
| `main.js` | Le chef d'orchestre Electron : fenetres, menus, tray, tous les canaux IPC, l'etat de la soiree. Le plus gros fichier du projet. |
| `preload.js` | Le seul pont entre le processus principal et les pages. `contextBridge`, pas de `nodeIntegration`. |
| `engine.js` | Le moteur de notation. Aucune dependance Electron : testable seul, partage avec l'UI. |
| `plancher.js` | Ce que le morceau FAIT a la salle (remplit / vide la piste). Ne du temoin Sardines -> Aznavour. |
| `parente.js` | Est-ce que ces deux morceaux vivent dans le meme monde ? Table de proximite entre familles. Ne du temoin Informer -> L'amour l'amour l'amour. |
| `repertoire.js` | Le centre de gravite de SA bibliotheque — ecriture des titres, familles de genres — et ce qui n'en fait pas partie. Aucune liste de pays nulle part (§7.8). |
| `genres.js` | 28 familles de genres avec synonymes. Traduit les tags reels vers le vocabulaire des packs. |
| `bulle.js` | Mode « reste dans ce style » : un morceau d'ancrage fige auquel tout est compare. |
| `epoque.js` | Fraicheur et perissabilite : « vieux » n'est pas « demode ». |
| `affinites.js` | Ce que CE DJ enchaine reellement, appris de ses sets passes. |
| `gout.js` | Apprentissage des poids du moteur, par critere, en EMA. |
| `analysis.js` | Le service d'analyse : file, priorites, cache, rapport d'avancement, detection de panne. |
| `analyze.js` | L'analyse elle-meme : ffmpeg -> descripteurs. `estimateBPM` rend `{bpm, confiance}`. |
| `analyze-worker.js` | Le meme calcul, dans un fil separe. |
| `structure.js` | Entree et sortie de batterie, grille de phrases, courbe d'energie. |
| `structure-worker.js` | Idem, dans un fil separe. |
| `library.js` | Import et normalisation de bibliotheque, cache de scan, conversion Camelot. |
| `autolibrary.js` | Decouverte automatique : Serato, Traktor, VirtualDJ, rekordbox XML, iTunes, ou scan de dossiers. |
| `crates.js` | Les listes deja faites par le DJ (crates Serato, playlists rekordbox/Traktor). |
| `serato-db.js` | Lecture du format binaire `_Serato_/database V2`. |
| `filters.js` | Les interrupteurs de cabine. Un filtre retire, il ne fait jamais remonter. |
| `locales.js` | 12 pays x 8 types d'evenements = 96 contextes composables. |
| `soirees.js` | Reglages memorises par soiree, pour ne pas reconfigurer dans la voiture a 18 h. |
| `clientlist.js` | Titres demandes et liste rouge : texte colle, CSV, ou playlist Spotify. |
| `acquire.js` | Le titre demande n'est pas dans la bibliotheque : ou l'acheter, ou l'a-t-il deja sous un autre nom. |
| `landing.js` | L'atterrissage : finir a l'heure annoncee sans bruler sa derniere cartouche trop tot. |
| `moments.js` | Les deux moments de l'essai (rappel, fin), isoles pour etre testables. |
| `session.js` | Serveur des invites en Wi-Fi local, QR, journal du set, persistance. |
| `debrief.js` | Le retour de fin de soiree : courbe d'energie, meilleurs enchainements, variete. |
| `prepare.js` | Mode preparation : construire une cle USB la veille, sans ordinateur en cabine. |
| `setbuilder.js` | Rejouer un set sans le repeter. |
| `health.js` | La sante de la bibliotheque : fichiers morts, doublons, tonalites contradictoires. |
| `license.js` | Licence cote app : verification Ed25519, cache 30 jours hors ligne, sieges. |
| `maj.js` | Y a-t-il une version plus recente ? N'installe jamais rien tout seul. |
| `watcher.js` | Le widget n'apparait que quand un logiciel de mix tourne. |
| `exterieur.js` | Le morceau qui joue et qui n'est PAS dans la bibliotheque : fabrique depuis un fichier (tags ffprobe) ou depuis un simple texte. |
| `ecrire.js` | Ecriture atomique. **Passer par ici pour tout fichier de donnees.** |
| `tray-icon.js` | L'icone de la barre de menus, en PNG base64. |

### `src/sources/` — d'ou vient « le morceau en cours »

| Fichier | Protocole |
|---|---|
| `index.js` | `NowPlaying` : choisit la source, emet `{ text }`. |
| `prolink.js` | Pro DJ Link, UDP 50000/50001/50002. Le seul protocole qui annonce ce qui est CHARGE sur un deck. Demande du vrai materiel (CDJ/XDJ/DJM). |
| `rekordbox.js` | rekordbox seul sur un portable n'emet rien : on lit les **fichiers audio ouverts** par le processus (`lsof`), dont les chemins doivent etre **deschappes** (§6bis). |
| `serato.js` | Fin du fichier de session de l'historique, chaines UTF-16BE. |
| `virtualdj.js` | `Documents/VirtualDJ/Tracklists/AAAA-MM-JJ.txt`. |
| `traktor.js` | On se fait passer pour un serveur Icecast local (127.0.0.1:8000). |

### 6bis. Le piege le plus cher du projet : `lsof` echappe les accents

`lsof` remplace tout octet non ASCII d'un chemin par les quatre
caracteres `\xHH`. Mesure :

```
fichier  : /M/Mauvais Djo - Pilee (Gospel Version).mp3   (avec un vrai accent)
lsof rend: n/M/Mauvais Djo - Pil\xc3\xa9e (Gospel Version).mp3
```

Un seul defaut, **quatre symptomes sans rapport apparent** :

1. le chemin ne correspond a aucune entree de la bibliotheque, donc
   le morceau est declare **hors bibliotheque alors qu'il y est** ;
2. `ffprobe` ne trouve aucun fichier a ce nom : aucun tag, et le
   titre affiche retombe sur le nom de fichier, echappements
   compris — c'est le `PIL\XC3\XA9E (GOSPEL VERSION)` vu en cabine ;
3. `statSync` echoue aussi, donc l'analyse range le morceau en
   « injoignable » et ne le mesure **jamais** : ni tempo, ni
   tonalite, ni energie, pour toute la soiree ;
4. avant la 1.4.7, ou rien ne rattrapait les morceaux hors
   bibliotheque, le widget restait simplement **muet**. C'est
   l'origine de « j'ai des sons qui ne sont pas du tout reconnus ».

Ca ne se voit pas en anglais. Dans une bibliotheque francaise, ca
touche une grande part du catalogue. `deschapper()` et
`vraiChemin()` dans `sources/rekordbox.js` remettent les octets a
leur place, en verifiant sur le disque avant de trancher.

### `src/ui/` — les trois pages

| Fichier | Quoi |
|---|---|
| `widget.html` | Le widget de cabine. Toujours au-dessus, deplacable, compact. C'est la seule fenetre qu'un DJ regarde en soiree. |
| `settings.html` | Tous les reglages : bibliotheque, contexte, filtres, soirees, sante, preparation, debrief. |
| `licence.html` | Achat, activation, sieges, essai. |
| `da.css`, `fonts/` | La direction artistique commune. |

### `build/` — construction, tests, diagnostics

Voir §12 et §13.

---

## 7. Le moteur — `engine.js`

### 7.1 L'entree

```js
suggest(cur, library, opt) -> [{ track, score, why, ... }]
```

`opt` porte : `dna` (l'ADN de genres du contexte), `arc` (`up` / `hold`
/ `down`), `mode` (`crowd` / `trend`), `bulle`, `banned`, `trends`,
`wanted`, `marge`, `limit`.

### 7.2 La fenetre de tempo

Avant de noter, on retire ce qui ne peut pas se caler.

```js
const FENETRE = 0.03;                            // +/- 3 % par defaut
const PALIERS = [0.06, 0.10, null];              // le repli, dans l'ordre
passeLeCrible(bpmRef, bpm, marge, doubleOk)      // marge bornee a [0.01, 0.12]
```

**Histoire de ce nombre, parce qu'il a fait l'aller-retour.** Il valait
12 %, il est passe a 35 % le 14/09/2026 (« Soprano Cosmo doit proposer
Macklemore » : un DJ de mariage COUPE de 100 a 146), puis a 3 % le
18/09/2026. Les deux decisions sont justes et ne repondent pas a la
meme question : 35 % repondait a « que peut-on PROPOSER », 3 % repond a
« que peut-on CALER ». Un DJ qui beatmatch ne sort pas de la plage de
pitch de sa platine.

La coupure n'a pas disparu, elle est devenue un **repli explicite** :
quand moins de propositions que demande passent la fenetre, `suggest()`
la rouvre par paliers et marque `horsFenetre: true` sur tout ce qui
entre par la porte elargie — le widget affiche alors **HORS FENETRE**
en rouge. Le DJ voit ce qu'il voyait avant, en sachant que celui-la se
coupe au lieu de se caler.

Le **demi-temps et le double** ne sont plus admis par defaut : ils sont
musicalement vrais et illisibles en cabine, maintenant que le BPM est
la chose la plus visible de chaque ligne. `doubleAdmis` / `FAM_DOUBLE`
restent, derriere `opt.demiDouble === true`.

Le bareme `tempoScore` est recalibre sur la meme echelle : 100 sous
0,5 %, 85 a 1,5 %, 60 a 3 %, 6 a 6 %. L'ancien rendait 76 a 3 % et 37 a
6 %, ce qui laissait un titre injouable finir troisieme.

### 7.3 Les onze axes

Aucun axe n'est un filtre. Chacun rend 0 a 100, et chacun est pondere.
`m('x')` est le multiplicateur appris par `gout.js` pour cet axe.

```js
const wH     = sansTonalite ? 0 : 0.16 * m('h');          // harmonie (Camelot)
const wT     = 0.30 * m('tp');                             // tempo
const wE     = 0.15 * m('en') * (B ? 0.55 : 1);            // energie
const wI     = 0.14 * m('ti');                             // timbre
const wBulle = B ? 0.34 : 0;                               // proximite a l'ancre
const wCrowd = (B ? 0.05 : mode === 'crowd' ? 0.26 : 0.06) * m('cr');   // la salle
const wTrend = (B ? 0.03 : mode === 'trend' ? 0.18 : 0.04) * m('td');   // tendance
const wFr    = 0.14 * m('fr') * (B ? 0.4 : 1);             // fraicheur (epoque.js)
const wAf    = 0.12 * m('af');                             // affinites du DJ
const wPl    = 0.17 * m('pl');                             // plancher (plancher.js)
const wPa    = 0.24 * m('pa') * (B ? 0.3 : 1);             // parente (parente.js)
const wRp    = REP ? 0.18 : 0;                             // repertoire (repertoire.js)
const W = wH + wT + wE + wI + wCrowd + wTrend + wBulle + wFr + wAf + wPl + wPa + wRp;
```

`wRp` est le seul poids qui n'est **pas** appris par `gout.js`, et
c'est volontaire : les autres disent une PREFERENCE du DJ, celui-ci dit
un FAIT sur sa bibliotheque. L'adaptation est deja dans la mesure
elle-meme (§7.8).

`B` = mode bulle actif. En bulle, l'ancre prend 34 % et tout le reste
s'efface proportionnellement.

**Priorite demandee par les DJs : BPM d'abord, puis le style, puis la
roue de Camelot.** C'est exactement ce que disent les poids —
tempo 0,30 ; parente + plancher = 0,41 ; harmonie 0,16.

### 7.8 `repertoire.js` — le corps etranger

Ne du retour : « certains DJ ont des sons bizarres d'autres pays dans
la bibliotheque, ceux-la on va eviter de les proposer ».

**Ce qu'on ne fait pas** : aucune liste de langues, de pays ou de
genres « exotiques ». Le repertoire normal d'un DJ marocain a Bruxelles
est le corps etranger d'un DJ de mariage en Bourgogne, et l'inverse est
tout aussi vrai. Une liste ecrite ici trancherait pour les deux et se
tromperait au moins une fois sur deux.

**Ce qu'on fait** : on mesure le CENTRE DE GRAVITE de SA bibliotheque,
sur deux axes lisibles sans rien deviner —

- l'**ECRITURE** des titres et des artistes, comptee caractere par
  caractere (latin, cyrillique, arabe, han, kana, hangul, grec, hebreu,
  devanagari, thai…). Une ecriture sous 2 % de la bibliotheque est un
  corps etranger ;
- la **FAMILLE DE GENRE** dominante, via `genres.famillesDe` — qui rend
  une **Map**, pas un tableau ; la confondre ne plante pas, ca rend
  l'axe muet en silence (cf. §16).

Le centre est calcule **une fois par import** dans `main.js`
(`repCentre`), jamais par suggestion : c'est un parcours complet.

Le morceau hors repertoire est **relegue, jamais ecarte** — il sort en
fin de liste avec sa raison affichee (« rare dans ta bibliotheque »), et
il remonte au rang normal des que le DJ en joue un : `repertoire.ouvrir()`
ouvre la porte de cette ecriture et de cette famille pour la soiree
(`repOuvertes`). Sous 300 titres, l'axe se tait : une petite
bibliotheque n'a pas de centre de gravite, elle n'a que des exceptions.

Banc : `build/test-repertoire.js`, dont le cas 5 est la preuve par le
miroir — chez un DJ russe, c'est la chanson francaise qui est etrangere.

### 7.4 Les inconnus

Le piege principal du projet : **un axe qui rend 50 quand il ne sait
pas donne des points gratuits a l'inconnu**, qui bat alors le connu.

```js
const H_INCONNU  = 42;   // tonalite du candidat absente
const EN_INCONNU = 38;   // energie non mesuree
const TI_INCONNU = 34;   // timbre non mesure
const sansTonalite = !cur.key;   // le morceau EN COURS n'a pas de tonalite
const sansTempo    = !(cur.bpm > 0);
```

Deux cas differents, deux traitements differents :

- **le CANDIDAT n'a pas l'info** : note d'inconnu, sous la moyenne,
  jamais eliminatoire ;
- **le morceau EN COURS n'a pas l'info** : l'axe ne classe plus
  personne — on le **retire du total** (`wH = 0`, `TEMPO_MUET`) au lieu
  de le laisser ecraser l'echelle et donner « 83, 82, 81, 81 ».

### 7.5 L'ordre final

```js
const CASSE = 12;   // dans ordonner()
```

Un candidat dont le plancher casse la piste part **en fin de liste**,
jamais a la poubelle. Le DJ garde le dernier mot.

### 7.6 `plancher.js` — ce que le morceau fait a la salle

Le temoin d'origine : « apres Les Sardines, il me propose Charles
Aznavour ». Sur la roue de Camelot ca se tient, en genre aussi (les
deux sont de la variete francaise), en tempo encore mieux. Mais l'un
remplit la piste et l'autre la vide.

`plancher(track) -> { v, sur }` combine tempo, energie mesuree,
densite d'attaques (`timbre[1]`) et famille. `continuite(cur, cand, arc)`
ne penalise que **les chutes**, et se detend quand `arc === 'down'`
(le DJ redescend volontairement).

Mesure : Sardines 89, Aznavour 25, transition notee 4 — « casse la piste ».

### 7.7 `parente.js` — le meme monde ?

Le temoin d'origine : « Informer (ragga) me propose L'amour l'amour
l'amour (chanson) ». Reproduit a l'execution : l'ordre etait Bon
Entendeur, Corneille, Benabar, et Inner Circle en 4e.

Une table `PROCHES` d'environ 45 paires, symetrisee au chargement avec
propagation a deux sauts. La courbe est **plate en haut, raide en bas** :

```js
const SEUIL_VOISIN = 0.55, NOTE_VOISIN = 82, ETRANGER = 18;
```

Valeurs de reference : meme famille 100, disco/funk 97, EDM/tech house
85, disco/techno 48, ragga/chanson 27. **Une famille inconnue des deux
cotes rend 50** : un tag manquant ne coute jamais rien.

---

## 8. L'analyse — « notre mesure fait foi »

### 8.1 Le probleme

Beaucoup de DJs n'ont que le titre du morceau, sans BPM ni tonalite.
D'autres ont des tags faux herites d'iTunes. Dans les deux cas,
Liaison doit se comporter **comme un professionnel : mesurer lui-meme**.

### 8.2 La chaine

```
analysis.js (file + cache + priorites + version de mesure)
   -> analyze-worker.js  (worker_thread)
      -> analyze.js
         -> ffmpeg (ffmpeg-static) : decode -> mono 22050 Hz float32
            (a partir de 20 s ; repli au debut si le morceau est court)
         -> energie, timbre[3], chroma par pics, estimateBPM
```

`estimateBPM` aligne un peigne de pulsations sur l'enveloppe
d'attaques. Le peigne mesure un **CONTRASTE** — ce qu'il ramasse sous
ses dents moins ce qu'il ramasse a mi-chemin — et non une hauteur
moyenne : une moyenne est aveugle a la moitie du tempo, puisqu'un
peigne deux fois trop lache tombe toujours sur un temps. La fenetre
d'octave va de **70 a 190 BPM**. **La confiance vaut
`1 - (meilleur rival non harmonique / pic)`**.

### 8.2bis Les quatre mesures, et ce qu'elles valaient avant

Bilan mesure sur vingt-trois fichiers synthetises a tempo, tonalite
et caractere connus (`build/test-analyse.js` en rejoue l'essentiel) :

| Mesure | Avant | Apres | Ce qui n'allait pas |
|---|---|---|---|
| tempo exact | 89 % | 94 % | la fenetre d'octave commencait a 82 : une ballade a 76 BPM ressortait a 152, et `plancher.js` la notait alors « ca danse » (74) au lieu de « la piste se vide » (26) |
| confiance du tempo | 0,59 moy. | 0,68 moy. | la moyenne du peigne confondait un tempo et sa moitie |
| tonalite exacte | **33 %** | **89 %** | le chroma additionnait toutes les cases de la FFT des 60 Hz. La case a 75 Hz s'arrondit en « re », et c'est la que vit la grosse caisse : l'analyse repondait re mineur ou majeur 12 fois sur 18 |
| energie | **5 pour tout le monde** | 1 a 10 | `densite = moyenne(flux) / centile98(flux)` disait l'exact contraire de ce qu'elle pretendait : un morceau qui frappe fort tombait a 0,10, une nappe sans aucun temps montait a 0,57. Du bruit blanc obtenait 7, un titre de club 5 |

La meme valeur inversee alimentait **`timbre[1]`**, que `plancher.js`
lit comme « percussif contre tenu ». `plancher.js` etait donc juste,
et nourri a l'envers — ce qu'aucun de ses tests ne pouvait voir,
puisqu'ils fabriquaient eux-memes leurs entrees. C'est le defaut qui
produisait « apres Les Sardines, il me propose Charles Aznavour ».

### 8.3 La regle de decision

```js
const SUR_TEMPO   = 0.55;   // calibre sur de vrais fichiers audio
const SUR_TONALITE = 0.72;
```

Calibrage : des WAV synthetises avec ffmpeg donnent 0,57-0,70 sur des
battements nets, et un bruit sans battement culmine a 0,47. D'ou 0,55.

Dans **`_arbitrer(t, patch)`** — et non plus dans `_resultat` : l'arbitrage
y vivait, il ne tournait donc QUE sur une analyse fraiche. Chez un DJ qui
utilise deja Liaison, la quasi-totalite des morceaux arrive par le cache :
corriger la regle ne changeait strictement rien chez lui. `_arbitrer` est
appele aux **trois** points de rencontre — cache au chargement, cache a
l'ajout, resultat d'un fil — et il est idempotent.

```js
const FORT = 3;
const rangBpm = t.bpm > 0 ? lib.fiabilite(t.bpmSrc) : 0;   // 3 fort / 2 nous / 1 saisie

if (!rangBpm)            { /* rien : on comble, 'liaison' ou 'liaison-incertain' */ }
else if (rangBpm >= FORT){ /* grille rekordbox & co : intouchable, on pose bpmDoute */ }
else if (surTempo)       { /* saisie iTunes/ID3 contre mesure sure : la mesure gagne */ }
else                     { /* rien de sur en face : on garde la saisie */ }
```

**Le cas Mamma Mia** : 105 dans un champ iTunes contre 130 mesures avec
confiance — la mesure gagne, `bpmTag` garde 105. Si c'etait rekordbox qui
disait 105, on garderait 105 et on poserait `bpmDoute` : le DJ mixe sur SA
grille, le contredire en cabine ne sert a rien.

**L'exception d'octave reste** : si le DJ a tague 140 et que nous mesurons
70, c'est le meme rythme et sa grille est calee sur 140 — on garde 140.
Sans elle, notre mesure cassait des grilles justes.

Etats possibles portes par la piste : `bpmSource` (la provenance —
`rekordbox`, `serato`, `traktor`, `virtualdj`, `itunes`, `tag`,
`liaison`, `liaison-incertain`), `bpmTag` (l'ancien tag garde en cas de
desaccord franc), `bpmCorrige`, `bpmDeduit`, `bpmDoute` + `bpmMesure`
(desaccord signale mais NON applique, source forte). Idem cote tonalite.
L'interface les affiche en clair, et le widget grise un BPM ou une cle
marques `liaison-incertain`.

**La tonalite : combler et contredire sont deux questions.** Le seuil
severe de 0,72 servait aux deux, d'ou une roue de Camelot vide de bout
en bout chez un DJ dont la seule source est iTunes — qui n'a aucun champ
tonalite. Depuis le 18/09/2026 : on **comble** des que la mesure rend
quelque chose (affiche « 8A ? » en gris), on ne **contredit** qu'avec le
seuil severe, et seulement contre une source faible.

**Et une partie des « ? » ne venait pas d'un tag manquant mais d'un tag
qu'on ne savait pas lire.** `toCamelot` comprend desormais la notation
ouverte de Mixed In Key (`1m` = 8A, `12d` = 7B), les suffixes d'energie
(`8A - Energy 7`), les formes longues et espacees (`A minor`, `Db Major`,
`A-Flat Minor`, `A moll`) et le zero devant (`08a`). 35 ecritures
couvertes, banc dans `build/test-fenetre.js` et `build/test-maj-biblio.js`.
`VERSION_TAGS` est passe a **3** pour que les caches existants soient
relus : sans ca, la correction n'atteindrait aucun DJ deja installe.

### 8.4 Ne jamais echouer en silence

`analysis.js` compte `rates`, `reussis`, `derniereErreur`,
`mesuresUtiles`, et `panne()` rend une cause nommee :

| Cle | Quand |
|---|---|
| `analyse-sans-fils` | les `worker_threads` n'ont pas demarre — immediat |
| `analyse-echoue` | >= 80 % d'echecs apres 20 tentatives, avec le texte d'erreur reel |
| `analyse-sans-resultat` | 40 reussites, moins de 10 % donnant un tempo |

`main.js` la remonte **une fois par cause** via `send('conseils', ...)`
plus un toast rouge.

### 8.5 La barre d'avancement

`_rapport()` compte **prets / total de la bibliotheque**, jamais de la
file. Sinon la barre recule quand on change de morceau — defaut
signale, corrige.

### 8.6 Les priorites

`prioriserAnalyse()` (dans `main.js`) place en tete : le morceau en
cours, puis les suggestions affichees, puis — **quand `current.bpm` est
0** — les 100 premiers du vivier filtre. Le morceau que le DJ vient de
lancer ne doit jamais attendre derriere 20 000 autres.

### 8.7 La version de la mesure

```js
const VERSION_MESURE = 2;   // dans analysis.js
```

Le cache d'analyse est ecrit sous la forme `{ __mesure, e }`. Au
chargement, un fichier d'une autre version — ou de l'ancien format
sans version — est **jete**, et `charger()` rend `mesurePerimee:
true` pour que `main.js` previenne le DJ.

C'est ce qui rend une correction d'analyse reellement visible. Sans
ce numero, un DJ qui met a jour garderait ses vingt-deux mille
anciens resultats pour toujours : la cle du cache ne depend que du
fichier, jamais de la facon dont on l'a mesure.

**A monter a chaque changement de `analyze.js` qui modifie une
valeur rendue.**

Il existe un second numero, independant : `VERSION_TAGS` dans
`library.js`, pour le cache de **lecture des tags**
(`scan-cache.json`). A monter quand on lit les tags autrement — par
exemple en preferant l'annee d'origine a celle de l'edition. Son
cout est une relecture ffprobe (quelques minutes), pas une
reanalyse audio (plusieurs heures).

### 8.8 L'annee d'un remaster n'est pas l'annee de la chanson

« Version originale : ca propose des morceaux vieillots. Version
remasterisee : ca propose des morceaux actuels. Pourtant c'est la
meme chanson. »

`anneeDeLaMusique()` dans `library.js` lit d'abord les tags
d'origine (`TORY`, `TDOR`, `originaldate`, `originalyear`) ; a
defaut, si le titre ou l'album annonce une reedition, l'annee est
marquee **`anneeIncertaine`**. `epoque.js` et `bulle.js` la
traitent alors comme inconnue.

Et « inconnue » ne veut plus dire « 62 pour tout le monde » :
l'ignorance coute **en proportion de ce que la famille doit a son
epoque** (`USURE_INCONNUE`). Ne pas dater un disco coute 2 points,
ne pas dater de l'EDM en coute 37. Le contraire revenait a punir
un genre intemporel d'une ignorance qui ne lui coute rien — c'est
le defaut qu'a attrape le temoin ecrit pour les reeditions.

---

## 9. L'apprentissage — `gout.js`

```js
const CRITERES = ['h','tp','en','ti','cr','td','fr','af','pl','pa'];
const MINI = 12;        // en dessous : on observe, on ne change rien
const PLEIN = 40;       // au-dela : l'apprentissage vaut a plein
const AMPLITUDE = 2.2;  // de l'ecart moyen au multiplicateur
```

Pour chaque suggestion prise ou ignoree, on met a jour une moyenne
mobile exponentielle par critere, et entre `MINI` et `PLEIN` on applique
une rampe : personne ne veut que l'app change de personnalite au
douzieme morceau.

**Piege deja tombe une fois** : `vide().ema` listait 6 cles alors que
`CRITERES` en a 10. Les axes `fr`, `af`, `pl` n'apprenaient rien — en
silence, parce que le test `isFinite` de `engine.m()` transformait
`NaN` en 1. Les cles se derivent desormais de `CRITERES`, et on
assainit au chargement. **Ne jamais reecrire cette liste a la main.**

---

## 10. L'interface

### 10.1 Trois fenetres, un seul pont

`preload.js` expose `window.liaison` par `contextBridge`. Pas de
`nodeIntegration`. Toute nouvelle fonctionnalite d'interface passe par
un canal declare la.

### 10.2 Les canaux

Du renderer vers le principal (`invoke`) — une soixantaine, groupes par
prefixe :

```
config:*  locales:*  library:*  source:*  suggest  rescue  now:*  track:*
bulle:*   client:*   structure:*  gout:*   soirees:*  analysis:*
filters:* landing:*  health:*  prepare:*  sets:*  session:*  share:*
licence:* license:*  tarifs:*  maj:*  widget:*  drag:*  qr:*  stats:*  apps:*
```

Du principal vers le renderer (`send`) :

```
now  suggestions  analysis  progress  library  filters  bulle  client
requests  status  conseils  toast  license  maj  app  raw
```

### 10.3 `envoyerNow()` — un seul endroit

L'en-tete du widget (titre, BPM, tonalite, energie, structure) est
emise **par une seule fonction**, appelee depuis `setCurrent`,
`scheduleStructRefresh` et `onTrack`. Elle porte aussi les drapeaux
`mesure`, `tempoDeduit`, `tempoCorrige`, `tonaliteDeduite`,
`tonaliteCorrigee`, `structure`. Ajouter un champ d'en-tete ailleurs
produit des incoherences d'affichage — passer par la.

### 10.4 L'affichage des inconnus

```js
const chiffre = (v) => (v > 0 ? Number(v).toFixed(1).replace('.', ',') : null);
```

- `'…'` = pas encore mesure ;
- `'—'` = mesure, sans resultat ;
- jamais `0.0`, qui se lit comme une valeur et fait croire a une panne.

Meme regle pour la structure : « Analyse de la structure… » pendant le
calcul, « Pas de structure nette sur ce morceau » apres.

### 10.5 Quand il n'y a rien a proposer

`raisonDuVide(cur, vivier, tam)` nomme **la premiere porte fermee** :

| Cle | Ce que l'utilisateur lit |
|---|---|
| `vide-sans-tempo` | Liaison mesure ce morceau, patiente quelques secondes |
| `vide-filtres` | les filtres de ce soir retirent tout |
| `vide-disque` | les fichiers ne sont pas accessibles (disque debranche) |
| `vide-tout-joue` | tout le vivier a deja ete joue |
| `vide-tempo` | rien ne se cale a ce tempo, elargir la marge |

---

## 11. Les donnees sur le disque

Tout dans `app.getPath('userData')`, tout ecrit par `ecrire.js`.

| Fichier | Contenu |
|---|---|
| `config.json` | Reglages, contexte, listes du client. |
| `analysis-cache.json` | Resultats d'analyse, cle = chemin + horodatage du fichier. |
| `structure-cache.json` | Structures calculees, elaguees regulierement. |
| `scan-cache.json` | Cache du scan de dossiers. |
| `sets.json` | Journal des soirees : chaque morceau, heure, duree, ce qui etait propose. |
| `gout.json` | Les poids appris. |
| `soirees.json` | Les soirees preparees. |
| `license.json` | La licence signee, valable 30 jours hors ligne. |

---

## 12. Licences et securite

- Le serveur signe une licence en **Ed25519** ; l'app la verifie avec
  la cle publique embarquee et la garde **30 jours**. Une coupure
  reseau n'interrompt jamais un set.
- La licence est liee a un `deviceId` derive de la machine. Les paliers
  (`TIERS`) donnent un nombre de **sieges** : `pass` 1, `resident` 2,
  `collectif` 5, `ami` 20. `api/liberer.js` rend un siege quand le DJ
  change de portable.
- **La cle privee vit uniquement dans les variables d'environnement
  Vercel** (`LICENSE_PRIVATE_KEY`, `FRIEND_CODES`). `lib/keys.js`
  existe sur le disque pour les essais, et `PUBLIER.command` verifie a
  chaque publication qu'il n'est pas suivi par git.
- Le paquet est durci a la construction (`build/afterPack.js` +
  `@electron/fuses`) : pas de `nodeIntegration`, pas de debogage a
  distance, verification de l'integrite ASAR.
- **Ne jamais demander, recevoir ni ecrire la cle secrete Stripe ou la
  cle Resend.** Elles n'ont aucune raison d'apparaitre dans une
  conversation ni dans un fichier du depot.

---

## 13. Les tests

`npm run verifier` enchaine vingt-deux suites. Toutes doivent passer.

| Suite | Ce qu'elle protege |
|---|---|
| `verifier-config` | la configuration electron-builder est acceptee |
| `demarrage` | l'app demarre vraiment (faux Electron) |
| `test-moments` | les deux moments de l'essai |
| `test-chemins` | resolution des chemins, y compris dans l'ASAR |
| `test-suggestions` | le moteur : ordre, cribles, aucune liste vide |
| `test-rekordbox` | detection par fichiers ouverts, filtrage des pids |
| `test-essai` | l'essai et son expiration |
| `test-bulle` | le mode bulle |
| `test-prolink` | parsing des paquets, partage de port |
| `test-epoque` | fraicheur contre perissabilite |
| `test-affinites` | ce que le DJ enchaine reellement |
| `test-plancher` | Sardines contre Aznavour |
| `test-parente` | Informer contre L'amour l'amour l'amour |
| `test-tags` | « notre mesure fait foi », y compris l'exception d'octave |
| `test-analyse` | ce que Liaison mesure lui-meme, sur de l'audio synthetise a tempo et tonalite connus — et le cache qui doit oublier quand la mesure change |
| `test-fenetre` | la fenetre de tempo a 3 %, son repli par paliers, l'elagage des disparus, la hierarchie des sources — et que le CACHE passe lui aussi par l'arbitrage |
| `test-repertoire` | le corps etranger relegue sans jamais etre ecarte, mesure sur SA bibliotheque (cas 5 : la preuve par le miroir) |
| `test-maj-biblio` | ce que le DJ change — retag, reanalyse rekordbox, fichier repare — remonte jusqu'a Liaison |
| `test-points-de-mix` | **banc d'integration** : demarre main.js pour de vrai, importe des morceaux fabriques a la volee, declare un titre sur le deck et attend le plan. Le seul banc qui teste l'ASSEMBLAGE et non les pieces |
| `test-detection` | le morceau qui tourne doit s'afficher, meme hors bibliotheque |
| `test-rekordbox` | contient aussi le temoin des accents echappes par `lsof` (§6bis) |
| `test-widget` | le rendu reel du widget (Playwright) |
| `test-licence-ui` | le parcours d'achat et d'activation (Playwright) |

**La discipline du temoin** : chaque suite contient au moins un cas qui
reproduit un defaut rapporte par un vrai DJ, avec le symptome exact.
Ce sont ces cas-la qui ne doivent jamais etre assouplis.

**Piege deja tombe** : un chemin absolu vers `playwright` s'etait glisse
dans `test-licence-ui.js` et cassait `npm run verifier` sur toute autre
machine, y compris le runner. Resoudre les modules, jamais coder un
chemin en dur.

**Piege deja tombe, deuxieme** : pendant des mois, chaque piece des
points de mix avait son banc — `structure()`, `mixPlan()`, le pool de
fils — et AUCUN ne verifiait qu'un plan finissait par arriver dans la
liste. Chaque piece marchait, l'assemblage non : le DJ voyait « points de
mix en cours de calcul… » toute la soiree. C'est ce qu'a corrige
`test-points-de-mix.js`. Quand un symptome traverse plusieurs modules, le
banc doit le traverser aussi.

**`LIAISON_FFMPEG` / `LIAISON_FFPROBE`** remplacent les binaires livres.
Utile sur un banc qui tourne sur une autre architecture, et surtout comme
contournement chez un DJ dont l'antivirus met ffmpeg en quarantaine —
symptome : aucune tonalite, aucun tempo mesure, aucun point de mix, sur
toute la bibliotheque.

---

## 14. Les outils de diagnostic

Quand un DJ dit « ca ne marche pas », on ne devine pas : on mesure.

| Outil | Question a laquelle il repond |
|---|---|
| `node build/diagnostic.js` | La chaine complete : ffmpeg (resolution, existence, executable, `-version`), `worker_threads`, lecture de bibliotheque avec couverture des tags, un vrai `analyze()` sur trois de ses morceaux, et les fichiers ouverts par rekordbox croises avec la bibliotheque. **C'est le premier outil a lancer sur toute panne rapportee.** |
| `node build/pourquoi.js "<titre A>" "<titre B>"` | Pourquoi B n'est pas propose apres A : presence en bibliotheque, passage du crible, note par axe. Avec un seul titre : les trois portes (bibliotheque / extension / fichier accessible), puis la verification en direct des fichiers ouverts par rekordbox. |
| `node build/sonde-decks.js` | Sonde 40 s : quels fichiers audio sont ouverts, avec compteurs de descripteurs et positions de lecture. |
| `node build/banc-familles.js` | Banc de mesure sur six profils de DJ : accord de style, de tempo, de direction d'energie. Sert a prouver qu'un changement ne fait regresser aucun profil. |
| `node build/versions.js "<titre>"` | **« Ca depend des versions »** : met cote a cote tous les fichiers du meme titre — tags, familles de genre, annees, mesures, et les cinq propositions de chacun — puis nomme ce qui differe. Repond en une commande a « pourquoi ce rip marche et pas l'autre ». |
| `node build/banc-suggestions.js` | Performance et couverture sur une grosse bibliotheque. |

Mesures de reference actuelles : style 100 %, tempo 100 %, energie
42-59 % selon le profil. Sur 22 000 titres : ~20 ms en moyenne, 141 ms
au pire, **zero liste vide** sur 30 configurations de bibliotheque et
de filtres.

---

## 15. Le site — `liaison-web/`

| Dossier | Quoi |
|---|---|
| `public/` | Le site, **genere** par les scripts de `outils/`. Ne pas editer a la main. |
| `outils/` | Les generateurs (Python + Node) : pages, blog, FAQ, plan du site, images Open Graph, tarifs, verification du balisage. |
| `api/` | Douze fonctions serverless — **douze est la limite du forfait Hobby**. Tout `.js` pose dans `api/` compte comme une fonction : les modules partages vivent dans `lib/`. |
| `lib/` | `lib.js` (commun), `release.js` (cache GitHub), `keys.js` (**jamais dans git**). |

Les fonctions : `checkout` et `webhook` (Stripe), `activate`,
`validate`, `liberer`, `cle` (licences), `etat`, `version`,
`telecharger` (constructions GitHub), `tarifs`, `contact`.

Point d'attention : `api/tarifs.js` existe pour que la page ne mente
jamais — le HTML est ecrit a la construction et porte le tarif du jour,
alors qu'une page servie depuis le cache pourrait afficher un ancien
prix tout en facturant le nouveau.

---

## 16. Ce qui est fragile — a lire avant de modifier

1. **`main.js` fait 2 400 lignes.** L'etat de la soiree y vit. Avant
   d'ajouter une variable d'etat, chercher si elle existe deja.
2. **Pro DJ Link sur macOS** : `reusePort` rend `ENOTSUP` sur BSD —
   mesure. Seul `reuseAddr` fonctionne, donc la seule protection sur
   Mac est de **rendre le port quand rekordbox demarre**
   (`PARTAGES`, `lierPartage`). Ne pas « simplifier » cette echelle.
3. **Le decoupage des artistes** : le separateur est
   `/\s*[;|]\s*|\s+\/\s+/`. Un `/` nu transformait `AC/DC` en
   `AC, DC`. Les espaces autour du `/` sont obligatoires.
4. **`pids()` dans `rekordbox.js`** : il faut distinguer « `ps` a
   echoue » de « aucun rekordbox reel ». Un compteur `lues` le fait.
   Le raccourci `cb(vrais.length ? vrais : tous)` reintroduit le bug.
5. **La courbe de parente doit rester plate en haut.** Une courbe
   lineaire faisait passer EDM 2012 devant Tech House 2025 —
   `test-epoque` l'attrape.
6. **Ne pas renvoyer un objet augmente d'une propriete** (du type
   `new Number(bpm)` avec `.confiance`) : la propriete disparait au
   passage par JSON entre le worker et le principal. Rendre un objet
   `{ bpm, confiance }`.
7. **Un banc qui tire au sort ne prouve rien.** L'audio synthetise de
   `test-analyse.js` utilise un generateur a graine fixe, jamais
   `Math.random()`. Un test qui change de resultat d'une execution a
   l'autre finit par etre relance jusqu'a ce qu'il passe.
8. **Reconnaitre a tort est pire que ne pas reconnaitre.** `match()`
   refuse un rapprochement sous 0,85 quand le texte annonce un artiste
   qui ne ressemble pas a celui du candidat — sans quoi « Queen -
   Dancing in the Street » devient « Dancing Queen » d'ABBA (mesure :
   0,63, au-dessus du seuil) et toutes les propositions partent d'une
   base fausse.
9. **Le niveau sonore n'entre pas dans l'energie.** Mesure : le meme
   fichier a -9 dB puis compresse et remonte donnait energie 7 et 10.
   `energyScore` vise « energie du morceau en cours + un pas » avec
   16 points de raideur par unite : trois crans d'ecart changent la
   liste entiere, et deux pressages du meme disque donnaient deux
   soirees. Les trois mesures qui composent l'energie sont des
   RAPPORTS, donc insensibles au gain. Ne pas y remettre de dB.
10. **Une entree de `scan-cache.json` est un TABLEAU compact**, pas un
   objet. `diagnostic.js` et `pourquoi.js` la lisaient comme un objet
   et rendaient des morceaux sans titre ni tempo — le diagnostic
   annoncait alors « ta bibliotheque n'a presque aucun tempo » a un
   DJ dont tout allait bien. Passer par `build/_biblio.js`.
11. **L'axe energie est le plus faible** (42-59 % d'accord). Il ne peut
   pas etre ameliore honnetement sans de vrais `sets.json` de soirees
   jouees. Ne pas le « regler » a l'aveugle en bougeant des constantes.

---

## 17. Vocabulaire du projet

| Terme | Sens |
|---|---|
| **le vivier** | l'ensemble des candidats apres filtres, avant notation |
| **le crible** | le pre-filtre de tempo |
| **la bulle** | le mode « reste dans ce style », avec un morceau d'ancrage |
| **le plancher** | ce que le morceau fait a la piste de danse |
| **la parente** | la proximite de monde entre deux morceaux |
| **l'arc** | la direction voulue de l'energie : `up`, `hold`, `down` |
| **l'ADN** | le profil de genres du contexte (pays x evenement) |
| **le pack** | un contexte compose, dans `locales.js` |
| **le temoin** | le cas de test qui reproduit un defaut rapporte |
| **le conseil** | un message nomme affiche a l'utilisateur, avec sa cle |
| **l'atterrissage** | la fin de set planifiee, dans `landing.js` |

---

## 18. Par ou commencer, selon la tache

| Si la tache est… | Lire d'abord |
|---|---|
| « les suggestions sont mauvaises » | `engine.js` §7, puis `plancher.js` et `parente.js`, puis lancer `build/pourquoi.js` |
| « le morceau en cours n'est pas detecte » | `src/sources/` §6 et `src/exterieur.js`, puis `build/diagnostic.js` et `build/sonde-decks.js` |
| « rien ne s'affiche alors que le son tourne » | `src/exterieur.js`, puis `adopterFichier()` / `adopterTexte()` dans `main.js` |
| « l'energie / la tonalite / le tempo sont faux » | §8.2bis, puis `build/test-analyse.js` — et **monter `VERSION_MESURE`** |
| « les BPM sont faux ou a zero » | `analysis.js` (§8.3, `_arbitrer`) et `analyze.js` §8 |
| « il n'affiche jamais la cle » | `toCamelot` dans `library.js` §8.3, puis le seuil de comblement dans `_arbitrer` |
| « les points de mix restent en chargement » | `planFor()` dans `main.js`, `structureEstimee()` dans `structure.js`, puis lancer `build/test-points-de-mix.js` |
| « il me propose des morceaux que j'ai supprimes » | `elaguerDisparus()` dans `library.js`, `jouable()` dans `engine.js`, et le conseil `rekordbox-xml-perime` |
| « il me propose des trucs qui n'ont rien a voir » | `repertoire.js` §7.8 |
| « l'app ne dit rien quand ca rate » | `raisonDuVide()` et `panne()` §8.4 et §10.5 |
| « l'interface affiche n'importe quoi » | `envoyerNow()` §10.3, puis `widget.html` |
| « la licence / le paiement » | `license.js` §12, puis `liaison-web/api/` §15 |
| « publier » | §4, **entierement**, avant de toucher a quoi que ce soit |
