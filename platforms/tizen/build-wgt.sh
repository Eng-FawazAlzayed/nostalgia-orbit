#!/usr/bin/env bash
# Builds an UNSIGNED Tizen package from dist/bundle.
# Samsung TVs only install packages signed with YOUR author + distributor
# certificate made for YOUR TV (see docs/TIZEN.md). Sign with:
#   tizen package -t wgt -s <certificate-profile> -- dist/tizen
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/dist/tizen"
rm -rf "$OUT" && mkdir -p "$OUT"
cp -r "$ROOT/dist/bundle/." "$OUT/"
cp "$ROOT/platforms/tizen/config.xml" "$OUT/"
cp "$ROOT/assets/icon-512.png" "$OUT/icon.png"
(cd "$OUT" && zip -qr "$ROOT/dist/NostalgiaOrbit-unsigned.wgt" .)
echo "Built dist/NostalgiaOrbit-unsigned.wgt"
