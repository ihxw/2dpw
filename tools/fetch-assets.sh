#!/usr/bin/env bash
# Fetch third-party open-source art into assets/vendor (git-ignored).
# Flare (https://github.com/flareteam/flare-game) — art under CC-BY-SA 3.0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/assets/vendor/flare-game"

if [ ! -d "$DEST/.git" ]; then
  git clone --depth 1 --filter=blob:none --sparse https://github.com/flareteam/flare-game.git "$DEST"
fi

git -C "$DEST" sparse-checkout set --no-cone \
  /mods/fantasycore/images/ \
  /mods/fantasycore/animations/ \
  /mods/fantasycore/tilesetdefs/ \
  /mods/fantasycore/enemies/ \
  /mods/fantasycore/engine/ \
  /mods/empyrean_campaign/maps/ \
  /CREDITS.txt /LICENSE.txt /README.md

echo "Flare art ready at $DEST ($(git -C "$DEST" rev-parse --short HEAD))"
