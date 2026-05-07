import { resolve } from "path";
import { existsSync } from "fs";
import {
  getCurrentMode,
  getDemoTrackMs,
  hasDemoTrack,
  loadDemoTrack,
  playDemoTrack,
  playSound,
  playSoundFromMode,
  setMode,
  stopAllPlayingSounds,
} from "./sound";

const isWindows = process.platform === "win32";

// Phase 1 — robots intro: a sweep through sensors 1–10 in `robots` mode.
const ROBOTS_INTRO_GAP_MS = 320;
const PAUSE_AFTER_INTRO_MS = 900;

// Phase 2A (Linux): full orchestrated John Williams tracks rendered from MIDI.
const STARWARS_TRACKS = [
  "imperial-bitmidi",
  "main-title-bitmidi",
  "cantina",
];
const PAUSE_BETWEEN_TRACKS_MS = 1500;
const PAUSE_BEFORE_LOOP_MS = 2500;

// Phase 2B (Windows): sensor-based songs in `starwars` mode (single-note
// monophonic, since the PowerShell SoundPlayer daemon is one-sound-per-sensor).
//
// `starwars` mode mapping (scripts/generate-gm.ts → Brass Section, octave low):
//   1=G2  2=F♯2 3=B♭2 4=C3  5=D3  6=E♭3 7=F3  8=F♯3 9=G3  10=B♭3
const Q = 460;
const E = Q / 2;
const DQ = Q + E;
const H = Q * 2;
const W = Q * 4;

type Beat = [sensor: number, gapMs: number];
type Song = { name: string; beats: Beat[] };

const WINDOWS_SONGS: Song[] = [
  {
    name: "Imperial March",
    beats: [
      [1, Q], [1, Q], [1, H],
      [6, DQ], [3, E], [1, H],
      [6, DQ], [3, E], [1, H],
      [5, Q], [5, Q], [5, H],
      [6, DQ], [3, E], [2, H],   // F♯ bridge dip
      [6, DQ], [3, E], [1, W],
    ],
  },
  {
    name: "Star Wars Main Title",
    beats: [
      [7, Q], [7, Q], [7, Q], [7, Q],
      [10, W],
      [7, E], [6, E], [5, E], [4, E],
      [10, H], [7, Q], [7, Q],
      [6, E], [5, E], [4, E], [4, E],
      [10, H], [7, H],
      [6, E], [5, E], [4, E], [6, E],
      [10, W],
    ],
  },
  {
    name: "Anakin's Theme",
    beats: [
      [6, H], [7, Q], [9, Q],
      [7, Q], [6, Q], [5, H],
      [6, Q], [9, Q], [7, Q], [6, Q],
      [5, Q], [7, Q], [6, H],
      [3, Q], [6, Q], [3, Q], [1, H],
    ],
  },
];
const WIN_PAUSE_BETWEEN_SONGS_MS = 2000;

const renderedDir = resolve(__dirname, "..", "sounds", ".demo-rendered");

let timer: NodeJS.Timeout | null = null;
let active = false;
let prevMode: string | null = null;
let starwarsTracks: string[] = [];
let winSongIdx = 0;

function loadStarwarsTracks(): string[] {
  const loaded: string[] = [];
  for (const name of STARWARS_TRACKS) {
    if (hasDemoTrack(name)) { loaded.push(name); continue; }
    const path = resolve(renderedDir, `${name}.wav`);
    if (existsSync(path)) {
      try { loadDemoTrack(name, path); loaded.push(name); }
      catch (e) { console.warn(`[demo] failed to load ${name}: ${(e as Error).message}`); }
    }
  }
  return loaded;
}

export function isDemoActive(): boolean {
  return active;
}

export function startDemo(): void {
  if (active) return;
  active = true;
  prevMode = getCurrentMode();

  if (isWindows) {
    setMode("robots");
    console.log("[demo] starting (Windows mode)");
    runRobotsIntroWindows(0);
  } else {
    if (starwarsTracks.length === 0) starwarsTracks = loadStarwarsTracks();
    console.log(`[demo] starting — robots intro then ${starwarsTracks.length} Star Wars track(s)`);
    runRobotsIntroLinux(0);
  }
}

export function stopDemo(): void {
  if (!active) return;
  active = false;
  if (timer) { clearTimeout(timer); timer = null; }

  if (isWindows) {
    // Restore the user's mode so their next beam-break plays the right sound.
    if (prevMode) setMode(prevMode);
  } else {
    // Cut off any orchestrated track immediately.
    stopAllPlayingSounds();
  }
  prevMode = null;
  console.log("[demo] stopped (interaction detected)");
}

function schedule(fn: () => void, ms: number): void {
  timer = setTimeout(() => { if (active) fn(); }, ms);
}

// --- Linux phases (multi-mode mixer) ---

function runRobotsIntroLinux(sensor: number): void {
  if (!active) return;
  if (sensor >= 10) {
    console.log("[demo] robots intro done");
    schedule(() => runStarwarsLinux(0), PAUSE_AFTER_INTRO_MS);
    return;
  }
  console.log(`[demo] robots[${sensor + 1}]`);
  playSoundFromMode("robots", sensor + 1);
  schedule(() => runRobotsIntroLinux(sensor + 1), ROBOTS_INTRO_GAP_MS);
}

function runStarwarsLinux(idx: number): void {
  if (!active) return;
  if (starwarsTracks.length === 0 || idx >= starwarsTracks.length) {
    schedule(() => runRobotsIntroLinux(0), PAUSE_BEFORE_LOOP_MS);
    return;
  }
  const name = starwarsTracks[idx];
  const ms = getDemoTrackMs(name);
  console.log(`[demo] track: ${name} (${(ms / 1000).toFixed(1)}s)`);
  playDemoTrack(name);
  schedule(() => runStarwarsLinux(idx + 1), ms + PAUSE_BETWEEN_TRACKS_MS);
}

// --- Windows phases (sensor-based songs through PS SoundPlayer) ---

function runRobotsIntroWindows(sensor: number): void {
  if (!active) return;
  if (sensor >= 10) {
    console.log("[demo] robots intro done; switching to starwars");
    setMode("starwars");
    schedule(() => runStarwarsWindows(), PAUSE_AFTER_INTRO_MS);
    return;
  }
  console.log(`[demo] robots[${sensor + 1}]`);
  playSound(sensor + 1);
  schedule(() => runRobotsIntroWindows(sensor + 1), ROBOTS_INTRO_GAP_MS);
}

function runStarwarsWindows(): void {
  if (!active) return;
  const song = WINDOWS_SONGS[winSongIdx % WINDOWS_SONGS.length];
  winSongIdx++;
  console.log(`[demo] song: ${song.name}`);
  let i = 0;
  const step = (): void => {
    if (!active) return;
    if (i >= song.beats.length) {
      // After the last song, swap back to robots and loop.
      if (winSongIdx % WINDOWS_SONGS.length === 0) {
        setMode("robots");
        schedule(() => runRobotsIntroWindows(0), PAUSE_BEFORE_LOOP_MS);
      } else {
        schedule(runStarwarsWindows, WIN_PAUSE_BETWEEN_SONGS_MS);
      }
      return;
    }
    const [sensor, gap] = song.beats[i++];
    playSound(sensor);
    timer = setTimeout(step, gap);
  };
  step();
}
