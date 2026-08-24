# Rien de secret dans ce depot

Ce depot est **public** : il sert uniquement a construire le `.dmg` et le `.exe`
et a les publier dans les Releases GitHub.

Ce qui doit rester **hors** de ce depot, toujours :

| Element | Ou il vit |
|---|---|
| Cle privee de signature des licences (Ed25519) | Projet Vercel `liaison`, dossier `liaison-web/api/_keys.js`, jamais pousse ici |
| Code amis | Meme endroit |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Variables d'environnement Vercel |

Ce depot ne contient que la **cle publique** (`src/license.js`), qui sert a
verifier une licence. Elle est faite pour etre lue par tout le monde : elle ne
permet pas d'en fabriquer une.

`.gitignore` bloque deja `web/`, `.env` et `*.pem`.
