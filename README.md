# Liaison

Widget de cabine pour DJ : il lit le morceau charge sur le deck et propose, en
direct, les titres de ta bibliotheque qui s'enchainent vraiment — harmonie
(roue de Camelot), tempo, timbre, energie de la salle — puis donne les trois
instants ou agir : lancer, basculer les basses, sortir.

Tout le calcul se fait sur la machine du DJ. Aucun fichier, aucun titre et
aucun historique de lecture ne sort.

- **Site et telechargement** : https://liaisondj.app
- **Premiere ouverture** (macOS et Windows previennent au premier lancement) :
  https://liaisondj.app/premiere-ouverture.html

## Sources reconnues

| Logiciel | Ce qui est detecte | Latence |
|---|---|---|
| Pro DJ Link (rekordbox, CDJ) | le morceau **charge** | immediate |
| Serato DJ Pro | le morceau joue | ~1,5 s |
| VirtualDJ | le morceau joue | ~1,5 s |
| Traktor Pro | le morceau joue | immediate (Broadcasting 127.0.0.1:8000) |

La bibliotheque est lue automatiquement dans la base du logiciel : rien a
exporter, rien a importer. Ce qui manque est analyse en local (ffmpeg + FFT).

## Le code, en dix lignes

    src/main.js        le processus principal : fenetres, IPC, barre de menus
    src/preload.js     le pont contextBridge — la seule surface exposee a l'UI
    src/engine.js      la notation des candidats sur six criteres
    src/structure.js   intro, breaks, outro, grille de phrases
    src/library.js     lecture des bases Serato/Traktor/VirtualDJ/iTunes
    src/license.js     verification Ed25519, cache 30 jours, niveaux
    src/moments.js     quand parler au DJ de son essai — regles pures
    src/gout.js        ce que Liaison apprend des choix reels du DJ
    src/debrief.js     le bilan de fin de soiree
    src/ecrire.js      ecritures atomiques (temp + fsync + rename + .bak)
    src/ui/            widget.html, settings.html, licence.html

## Construire et verifier

```bash
npm ci
npm start            # lance l'app en developpement
npm run verifier     # config, demarrage, moments, fenetre de licence
npm run dist:mac     # .dmg  (Apple Silicon + Intel)
npm run dist:win     # .exe
```

`npm run verifier` doit passer avant toute publication. Il controle que la
configuration electron-builder est valide, que `main.js` se charge, que les
vingt chemins de demarrage repondent sans erreur, que les regles des moments
d'essai sont respectees, et que la fenetre de licence ne coupe aucun bouton.

## Publier

Pousser un tag `vX.Y.Z` declenche la construction sur GitHub et attache les
trois fichiers a la Release.

- Depuis ce depot seul : `bash publier.sh`
- Depuis le poste de travail, app **et** site en une fois :
  `bash ~/Desktop/Liaison/PUBLIER.command`

## Licences

L'app verifie une licence signee en Ed25519 avec la cle publique embarquee
dans `src/license.js`, et la garde en cache 30 jours : une coupure reseau
n'interrompt jamais un set. Voir `SECRETS.md` pour ce qui ne doit jamais
arriver dans ce depot.
