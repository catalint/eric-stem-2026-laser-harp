#!/usr/bin/env node
// Post-install: render the orchestrated demo tracks from sounds/.demo-src/*.mid
// into sounds/.demo-rendered/*.wav using fluidsynth + FluidR3 GM SoundFont.
//
// Skips silently on Windows (the demo only runs on Linux/macOS) and never
// fails npm install — at worst the user runs scripts/render-demo.sh manually.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

if (process.platform === "win32") {
  console.log("[postinstall] skipping demo render on Windows");
  process.exit(0);
}

const SF = "/usr/share/sounds/sf2/FluidR3_GM.sf2";
const SRC = resolve("sounds/.demo-src");
const OUT = resolve("sounds/.demo-rendered");

const which = spawnSync("which", ["fluidsynth"], { stdio: "ignore" });
if (which.status !== 0) {
  console.log("[postinstall] fluidsynth not installed — skipping demo render");
  console.log("                 install with:  sudo apt install fluidsynth fluid-soundfont-gm");
  process.exit(0);
}
if (!existsSync(SF)) {
  console.log(`[postinstall] missing ${SF} — install fluid-soundfont-gm`);
  process.exit(0);
}
if (!existsSync(SRC)) {
  console.log(`[postinstall] no source MIDIs at ${SRC} — nothing to render`);
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
const midis = readdirSync(SRC).filter((f) => f.endsWith(".mid"));
let rendered = 0;
let skipped = 0;
for (const mid of midis) {
  const out = resolve(OUT, basename(mid, ".mid") + ".wav");
  if (existsSync(out)) { skipped++; continue; }
  process.stdout.write(`[postinstall] rendering ${mid}... `);
  const r = spawnSync(
    "fluidsynth",
    ["-ni", "-F", out, "-r", "48000", "-T", "wav", "--gain", "0.7", SF, resolve(SRC, mid)],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (r.status === 0) { rendered++; console.log("ok"); }
  else                { console.log(`failed: ${r.stderr?.toString().trim()}`); }
}
console.log(`[postinstall] demo render: ${rendered} new, ${skipped} cached`);
