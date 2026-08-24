#!/usr/bin/env bash
# ============================================================
#  Liaison — publier l'app en telechargement.
#  Une seule commande :  ./publier.sh
#  Elle cree le depot GitHub, pousse le code, declenche la
#  construction du .dmg et du .exe, et affiche les deux adresses
#  a coller dans Vercel.
# ============================================================
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
BLEU=$'\033[34m'; GRAS=$'\033[1m'; FIN=$'\033[0m'

echo "${GRAS}Liaison $VERSION${FIN}"
echo

if ! command -v gh >/dev/null; then
  echo "Il manque l'outil GitHub en ligne de commande."
  echo "Installe-le puis relance :"
  echo "    ${BLEU}brew install gh && gh auth login${FIN}"
  exit 1
fi
gh auth status >/dev/null 2>&1 || { echo "Connecte-toi d'abord : ${BLEU}gh auth login${FIN}"; exit 1; }

if [ ! -d .git ]; then
  echo "-- creation du depot --"
  git init -q
  git add -A
  git -c user.email=liaison@local -c user.name=Liaison commit -qm "Liaison $VERSION"
  gh repo create liaison --private --source=. --push
else
  echo "-- mise a jour du depot --"
  git add -A
  git diff --cached --quiet || git commit -qm "Liaison $VERSION"
  git push -q origin HEAD 2>/dev/null || git push -q -u origin HEAD
fi

echo "-- declenchement de la construction --"
git tag -f "v$VERSION" >/dev/null
git push -f origin "v$VERSION" >/dev/null 2>&1
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

echo
echo "GitHub construit le .dmg et le .exe. Compte 8 a 10 minutes."
echo "Suivi : ${BLEU}https://github.com/$REPO/actions${FIN}"
echo
echo "${GRAS}Rien d autre a faire.${FIN} Le site connait deja ces adresses :"
echo "  mac   ${BLEU}https://github.com/$REPO/releases/download/v$VERSION/Liaison-$VERSION-arm64.dmg${FIN}"
echo "  intel ${BLEU}https://github.com/$REPO/releases/download/v$VERSION/Liaison-$VERSION-x64.dmg${FIN}"
echo "  win   ${BLEU}https://github.com/$REPO/releases/download/v$VERSION/Liaison-Setup-$VERSION.exe${FIN}"
echo
echo "Des que la construction est verte, le bouton Telecharger de"
echo "${BLEU}https://liaison-gamma-five.vercel.app${FIN} sert le fichier."
