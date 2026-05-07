#!/bin/bash
# Render the multi-track demo MIDIs (sounds/.demo-src/*.mid) to long
# orchestrated WAVs (sounds/.demo-rendered/*.wav) using fluidsynth + the
# FluidR3 GM SoundFont. Output is gitignored — run this once after clone.
#
# Requires:  fluidsynth, fluid-soundfont-gm  (apt install fluidsynth fluid-soundfont-gm)

set -euo pipefail

SF=/usr/share/sounds/sf2/FluidR3_GM.sf2
SRC=sounds/.demo-src
OUT=sounds/.demo-rendered

if [ ! -f "$SF" ]; then
  echo "Missing $SF — apt install fluid-soundfont-gm" >&2
  exit 1
fi
if ! command -v fluidsynth >/dev/null; then
  echo "Missing fluidsynth — apt install fluidsynth" >&2
  exit 1
fi

mkdir -p "$OUT"
for mid in "$SRC"/*.mid; do
  name=$(basename "$mid" .mid)
  out="$OUT/$name.wav"
  echo "Rendering $name..."
  fluidsynth -ni -F "$out" -r 48000 -T wav --gain 0.7 "$SF" "$mid" 2>&1 \
    | grep -v '^FluidSynth' || true
done
echo "Done. Files in $OUT/"
