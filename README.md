# Liaison

Widget de cabine pour DJ : il lit le morceau charge sur le deck et propose,
en direct, les titres de ta bibliotheque qui s'enchainent vraiment —
harmonie (roue de Camelot), tempo, timbre, energie de la salle.

- **Site et telechargement** : https://liaison-gamma-five.vercel.app
- **Premiere ouverture** (macOS et Windows previennent au premier lancement) :
  https://liaison-gamma-five.vercel.app/premiere-ouverture.html

## Sources reconnues

| Logiciel | Ce qui est detecte | Latence |
|---|---|---|
| Pro DJ Link (rekordbox, CDJ) | le morceau **charge** | immediate |
| Serato DJ Pro | le morceau joue | ~1,5 s |
| VirtualDJ | le morceau joue | ~1,5 s |
| Traktor Pro | le morceau joue | immediate (Broadcasting 127.0.0.1:8000) |

La bibliotheque est lue automatiquement dans la base du logiciel : rien a
exporter, rien a importer. Ce qui manque est analyse en local (ffmpeg + FFT),
sans qu'aucun fichier ne quitte la machine.

## Construire

```bash
npm ci
npm start            # lance l'app en developpement
npm run dist:mac     # .dmg  (Apple Silicon + Intel)
npm run dist:win     # .exe
```

Pousser un tag `vX.Y.Z` declenche la construction sur GitHub et attache les
fichiers a la Release. En pratique : `bash publier.sh`.

## Licences

L'app verifie une licence signee en Ed25519 avec la cle publique embarquee
dans `src/license.js`, et la garde en cache 30 jours : une coupure reseau
n'interrompt jamais un set. Voir `SECRETS.md` pour ce qui ne doit jamais
arriver dans ce depot.
