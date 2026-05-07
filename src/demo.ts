import { resolve } from "path";
import { existsSync } from "fs";
import {
  getDemoTrackMs,
  hasDemoTrack,
  loadDemoTrack,
  playDemoTrack,
  playSoundFromMode,
  stopAllPlayingSounds,
} from "./sound";

// Phase 1: a quick "wake-up" sweep through sensors 1–10 in `robots` mode.
const ROBOTS_INTRO_GAP_MS = 320;
const PAUSE_AFTER_INTRO_MS = 900;

// Phase 2: full orchestrated John Williams tracks rendered from MIDI.
// File naming matches scripts/render-demo.sh output in sounds/.demo-rendered/.
const STARWARS_TRACKS = [
  "imperial-bitmidi",
  "main-title-bitmidi",
  "cantina",
];
const PAUSE_BETWEEN_TRACKS_MS = 1500;
const PAUSE_BEFORE_LOOP_MS = 2500;

const renderedDir = resolve(__dirname, "..", "sounds", ".demo-rendered");

let timer: NodeJS.Timeout | null = null;
let active = false;

function loadStarwarsTracks(): string[] {
  const loaded: string[] = [];
  for (const name of STARWARS_TRACKS) {
    if (hasDemoTrack(name)) { loaded.push(name); continue; }
    const path = resolve(renderedDir, `${name}.wav`);
    if (existsSync(path)) {
      try {
        loadDemoTrack(name, path);
        loaded.push(name);
      } catch (e) {
        console.warn(`[demo] failed to load ${name}: ${(e as Error).message}`);
      }
    }
  }
  return loaded;
}

let starwarsTracks: string[] = [];

export function isDemoActive(): boolean {
  return active;
}

export function startDemo(): void {
  if (active) return;
  active = true;
  if (starwarsTracks.length === 0) starwarsTracks = loadStarwarsTracks();
  console.log(`[demo] starting — robots intro then ${starwarsTracks.length} Star Wars track(s)`);
  runRobotsIntro(0);
}

export function stopDemo(): void {
  if (!active) return;
  active = false;
  if (timer) { clearTimeout(timer); timer = null; }
  stopAllPlayingSounds();
  console.log("[demo] stopped (interaction detected)");
}

function schedule(fn: () => void, ms: number): void {
  timer = setTimeout(() => { if (active) fn(); }, ms);
}

function runRobotsIntro(sensor: number): void {
  if (!active) return;
  if (sensor >= 10) {
    schedule(() => runStarwars(0), PAUSE_AFTER_INTRO_MS);
    return;
  }
  playSoundFromMode("robots", sensor + 1);
  schedule(() => runRobotsIntro(sensor + 1), ROBOTS_INTRO_GAP_MS);
}

function runStarwars(idx: number): void {
  if (!active) return;
  if (starwarsTracks.length === 0 || idx >= starwarsTracks.length) {
    // Loop back to the robots intro after a longer pause.
    schedule(() => runRobotsIntro(0), PAUSE_BEFORE_LOOP_MS);
    return;
  }
  const name = starwarsTracks[idx];
  const ms = getDemoTrackMs(name);
  console.log(`[demo] track: ${name} (${(ms / 1000).toFixed(1)}s)`);
  playDemoTrack(name);
  schedule(() => runStarwars(idx + 1), ms + PAUSE_BETWEEN_TRACKS_MS);
}
