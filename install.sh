#!/bin/sh
# Installs the latest Hopper release into /Applications on macOS.
#   curl -fsSL https://raw.githubusercontent.com/PasqualeCapuano/hopper/main/install.sh | sh
set -eu

REPO="PasqualeCapuano/hopper"
APP="/Applications/Hopper.app"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Questo script è per macOS. Su Windows usa install.ps1." >&2
  exit 1
fi

echo "Cerco l'ultima versione di Hopper…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o 'https://[^"]*\.dmg' | head -n 1)
if [ -z "$URL" ]; then
  echo "Nessun dmg trovato nell'ultima release." >&2
  exit 1
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
echo "Scarico $(basename "$URL")…"
curl -fsSL "$URL" -o "$TMP/Hopper.dmg"

MNT="$TMP/mnt"
mkdir -p "$MNT"
if ! hdiutil attach "$TMP/Hopper.dmg" -nobrowse -quiet -mountpoint "$MNT" < /dev/null; then
  echo "Impossibile montare il dmg." >&2
  exit 1
fi

pkill -x hopper 2>/dev/null || true
rm -rf "$APP"
cp -R "$MNT/Hopper.app" "$APP"
hdiutil detach "$MNT" -quiet

# The build is not notarized yet: clear the quarantine flag so Gatekeeper
# does not block it with "unidentified developer".
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "Hopper installata in $APP. La avvio."
open -a "$APP"
echo "Premi ⌥ Space per aprirla. Le impostazioni sono nell'icona rossa nella barra dei menu."
