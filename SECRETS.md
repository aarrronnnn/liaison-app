# Rien de secret dans ce depot

Ce depot est **public** : il sert uniquement a construire le `.dmg` et le `.exe`
et a les publier dans les Releases GitHub.

Ce qui doit rester **hors** de ce depot, toujours :

| Element | Ou il vit |
|---|---|
| Cle privee de signature des licences (Ed25519) | Projet Vercel `liaison`, dossier `liaison-web/api/_keys.js`, jamais pousse ici |
| Code amis | Meme endroit |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Variables d'environnement Vercel |
| Cle d'API Last.fm (classements) | Variable d'environnement `LASTFM_CLE` du projet Vercel `liaison`. Jamais dans l'application. |

Ce depot ne contient que la **cle publique** (`src/license.js`), qui sert a
verifier une licence. Elle est faite pour etre lue par tout le monde : elle ne
permet pas d'en fabriquer une.

`.gitignore` bloque deja `web/`, `.env`, `*.pem` et `src/cle-construction.js`.

## La cle Last.fm, en pratique

Les classements du panneau **Titres a avoir** viennent de Last.fm, sous accord
commercial au nom de Liaison (obtenu en septembre 2026 — garder la confirmation
ecrite, c'est elle qui separe l'integration d'une violation resiliable).

**La cle ne quitte jamais Vercel.** Elle vit dans la variable d'environnement
`LASTFM_CLE` du projet Vercel `liaison`, exactement comme la cle Stripe et la cle
de signature des licences. L'application ne la porte pas, ne l'a jamais en
memoire, et n'en a pas besoin : elle appelle `liaisondj.app/api/classements`.

Une premiere version posait la cle dans les binaires a la construction, depuis un
secret de depot GitHub. C'etait une erreur, pour quatre raisons :

1. **Extractible.** Une cle dans un `.dmg` s'ouvre avec un utilitaire `asar`.
2. **Non revocable.** Cle perdue ou revoquee = reconstruire, republier, et
   attendre que chaque DJ mette a jour. La fonction restait cassee des semaines.
3. **Le quota.** L'accord est au nom de Liaison et c'est lui qui paie chaque
   appel. Mille DJ = mille appels. Via le relais et le cache du reseau de
   diffusion, c'est **un appel par pays et par trois heures**, quel que soit le
   nombre de DJ.
4. **L'attribution.** Last.fm demande d'etre credite : un seul endroit a tenir.

Le secret de depot GitHub `LIAISON_LASTFM_CLE` **n'est plus utilise** : l'etape
qui le lisait a ete retiree de `build.yml`. S'il existe encore, il peut etre
supprime.

`src/cle-construction.js` reste possible en local, bloque par `.gitignore`, et ne
sert qu'a appeler Last.fm directement pour depanner sans passer par le relais.
Les binaires livres n'en ont pas.

**Ce qui transite par le relais :** un code pays sur deux lettres. Rien d'autre.
Pas de bibliotheque, pas de titre, pas d'identifiant de machine. La promesse
« tout reste sur ta machine » tient : le relais ne peut pas savoir ce qu'un DJ
possede ni ce qu'il joue.

**La liste blanche des pays dans `api/classements.js` n'est pas de la
decoration** : sans elle, le parametre partirait tel quel vers Last.fm et cette
adresse deviendrait un relais ouvert que n'importe qui pourrait utiliser sur
notre quota.
