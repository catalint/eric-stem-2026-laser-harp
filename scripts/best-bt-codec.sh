#!/bin/bash
# Pick the highest-fidelity A2DP profile on every connected BlueZ card.
# Order: LDAC > aptX-HD > aptX > AAC > SBC-XQ > SBC. Falls through if none found.
#
# Profile names from WirePlumber are unstable (the "primary" codec gets the
# bare 'a2dp-sink' name; others get a suffix). Match by the description
# string instead — it always contains 'codec <NAME>'.

set -u

priority_codecs=(LDAC aptX-HD aptX AAC SBC-XQ SBC)

mapfile -t cards < <(pw-cli ls Device 2>/dev/null \
  | awk '/id [0-9]+/ { id=$2; gsub(",", "", id) } /bluez_card\./ { print id }')

for card in "${cards[@]}"; do
  # Build "desc|index" rows from EnumProfile.
  rows=$(pw-cli enum-params "$card" EnumProfile 2>/dev/null | awk '
      /Profile:index/       { getline; if ($1=="Int")    { idx=$2 } }
      /Profile:description/ { getline; if ($1=="String") {
          sub(/^[ \t]*String "/, "")
          sub(/"$/, "")
          print $0 "|" idx
      } }')

  best_idx=""; best_codec=""
  for codec in "${priority_codecs[@]}"; do
    idx=$(echo "$rows" | awk -F'|' -v c="codec ${codec})" 'index($1,c){print $2; exit}')
    if [ -n "$idx" ]; then
      best_idx=$idx; best_codec=$codec; break
    fi
  done

  [ -z "$best_idx" ] && continue

  current=$(wpctl inspect "$card" 2>/dev/null | awk -F'"' '/device\.profile\.name/ { print $2 }')
  echo "[bt-codec] card $card: best=$best_codec (idx $best_idx), current='$current'"
  wpctl set-profile "$card" "$best_idx" 2>&1 || true
done
