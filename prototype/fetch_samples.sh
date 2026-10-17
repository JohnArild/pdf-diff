#!/usr/bin/env bash
# Download the OpenHornet test drawings (rev - and rev A of OHC0003 "ASSY, KNOBS" and
# OH2A2A1-1 "ASSY, LEFT LIP MODULE")
# from github.com/jrsteensen/OpenHornet at the commits that introduced them.
# These files are third-party, licensed CC BY-NC-SA 4.0 by the OpenHornet project,
# and are intentionally NOT committed to this repository.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p samples
BASE="https://raw.githubusercontent.com/jrsteensen/OpenHornet"
DIR="release/OHC_Common_Parts/OHC0003%20-%20ASSY%2C%20KNOBS"
# rev -  (initial release), commit 02316bfbb4 "Initial commit of WIP Release Package"
curl -fL -o "samples/OHC0003_rev-_v28.pdf" \
  "$BASE/02316bfbb4/$DIR/OHC0003%20-%20ASSY%2C%20KNOBS_-_v28.pdf"
# rev A, commit c0f62eed89 "OHC0003-A-4RUDGB3: UPDATED INDICA AND FINISH (#1080)"
curl -fL -o "samples/OHC0003_revA_v29.pdf" \
  "$BASE/c0f62eed89/$DIR/OHC0003%20-%20ASSY%2C%20KNOBS_A_v29.pdf"
# expected git blob ids: 980ca947bac52c5bf05176a04ade2f64da94b2e5 (rev -), d8a68b6414a2f1dff74dff8e643071e2b012f479 (rev A)

DIR2="release/OH2_Lower_Instrument_Panel/OH2A2A1%20-%20ASSY%2C%20LEFT%20LIP%20MODULE"
F2="OH2A2A1-1%20-%20ASSY%2C%20LEFT%20LIP%20MODULE"
# rev -  v6 (681522 bytes), commit d5fc02c103 "Added missing FN 5 balloon" (file removed again in 272988fdbc)
curl -fL -o "samples/OH2A2A1-1_rev-_v6.pdf" "$BASE/d5fc02c103/$DIR2/${F2}_-_v6.pdf"
# rev A  v7 (727255 bytes), commit 272988fdbc "Revert to Mega Rev 3 based ABSIS Bus Master (#1110)"
curl -fL -o "samples/OH2A2A1-1_revA_v7.pdf" "$BASE/272988fdbc/$DIR2/${F2}_A_v7.pdf"
# expected git blob ids: c1fb69b0d0cf8844f6aba46742dd4c44c3190598 (rev -), dd09d82f7995e08a4fabbb9892b2c374e8fd2901 (rev A)

for f in samples/*.pdf; do echo "$f  blob $(git hash-object "$f" 2>/dev/null || echo '?')"; done
