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

// Phase 2 (Linux only) — orchestrated MIDI renders.
const STARWARS_TRACKS = [
  "imperial-bitmidi",
  "main-title-bitmidi",
  "cantina",
];
const PAUSE_BETWEEN_TRACKS_MS = 1500;
const PAUSE_BETWEEN_SONGS_MS = 1500;
const PAUSE_BEFORE_LOOP_MS = 2500;

// Note durations (ms). Q is the demo's quarter-note tempo.
const Q = 460;
const E = Q / 2;
const DQ = Q + E;
const H = Q * 2;
const W = Q * 4;

type Beat = [sensor: number, gapMs: number];
type Song = { name: string; mode: string; beats: Beat[] };

// Sensor-based songs played on both platforms. The `mode` field selects the
// instrument bank. harp/marimba/bell/synth all use a C-major diatonic
// mapping (1=C3 2=D3 3=E3 4=F3 5=G3 6=A3 7=B3 8=C4 9=D4 10=E4); starwars is
// a brass section one octave lower (1=G2 2=F♯2 3=B♭2 4=C3 5=D3 6=E♭3 7=F3
// 8=F♯3 9=G3 10=B♭3) which is why Imperial March's bridge dip lands on 2.
const SONGS: Song[] = [
  {
    name: "Twinkle Twinkle Little Star",
    mode: "harp",
    beats: [
      [1, Q], [1, Q], [5, Q], [5, Q], [6, Q], [6, Q], [5, H],
      [4, Q], [4, Q], [3, Q], [3, Q], [2, Q], [2, Q], [1, H],
      [5, Q], [5, Q], [4, Q], [4, Q], [3, Q], [3, Q], [2, H],
      [5, Q], [5, Q], [4, Q], [4, Q], [3, Q], [3, Q], [2, H],
      [1, Q], [1, Q], [5, Q], [5, Q], [6, Q], [6, Q], [5, H],
      [4, Q], [4, Q], [3, Q], [3, Q], [2, Q], [2, Q], [1, W],
    ],
  },
  {
    name: "Mary Had a Little Lamb",
    mode: "harp",
    beats: [
      [3, Q], [2, Q], [1, Q], [2, Q], [3, Q], [3, Q], [3, H],
      [2, Q], [2, Q], [2, H], [3, Q], [5, Q], [5, H],
      [3, Q], [2, Q], [1, Q], [2, Q], [3, Q], [3, Q], [3, Q], [3, Q],
      [2, Q], [2, Q], [3, Q], [2, Q], [1, W],
    ],
  },
  {
    name: "Old MacDonald Had a Farm",
    mode: "harp",
    beats: [
      [1, Q], [1, Q], [1, Q], [5, Q], [6, Q], [6, Q], [5, H],
      [3, Q], [3, Q], [2, Q], [2, Q], [1, H],
      [1, Q], [1, Q], [1, Q], [5, Q], [6, Q], [6, Q], [5, H],
      [3, Q], [3, Q], [2, Q], [2, Q], [1, H],
      [5, Q], [5, Q], [1, Q], [1, Q], [5, Q], [5, Q], [1, Q], [1, Q],
      [1, Q], [1, Q], [1, Q], [5, Q], [6, Q], [6, Q], [5, H],
      [3, Q], [3, Q], [2, Q], [2, Q], [1, W],
    ],
  },
  {
    name: "Row Row Row Your Boat",
    mode: "harp",
    beats: [
      [1, Q], [1, Q], [1, Q], [2, Q], [3, H],
      [3, Q], [2, Q], [3, Q], [4, Q], [5, H],
      [8, E], [8, E], [8, E], [5, E], [5, E], [5, E],
      [3, E], [3, E], [3, E], [1, E], [1, E], [1, E],
      [5, Q], [4, Q], [3, Q], [2, Q], [1, W],
    ],
  },
  {
    name: "Hot Cross Buns",
    mode: "harp",
    beats: [
      [3, Q], [2, Q], [1, H],
      [3, Q], [2, Q], [1, H],
      [1, E], [1, E], [1, E], [1, E], [2, E], [2, E], [2, E], [2, E],
      [3, Q], [2, Q], [1, W],
    ],
  },
  {
    name: "Imperial March",
    mode: "starwars",
    beats: [
      [1, Q], [1, Q], [1, H],
      [6, DQ], [3, E], [1, H],
      [6, DQ], [3, E], [1, H],
      [5, Q], [5, Q], [5, H],
      [6, DQ], [3, E], [2, H],
      [6, DQ], [3, E], [1, W],
    ],
  },
  {
    name: "Star Wars Main Title",
    mode: "starwars",
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
    mode: "starwars",
    beats: [
      [6, H], [7, Q], [9, Q],
      [7, Q], [6, Q], [5, H],
      [6, Q], [9, Q], [7, Q], [6, Q],
      [5, Q], [7, Q], [6, H],
      [3, Q], [6, Q], [3, Q], [1, H],
    ],
  },
];

const renderedDir = resolve(__dirname, "..", "sounds", ".demo-rendered");

let timer: NodeJS.Timeout | null = null;
let active = false;
let prevMode: string | null = null;
let starwarsTracks: string[] = [];
let songIdx = 0;

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
  songIdx = 0;
  prevMode = getCurrentMode();

  if (isWindows) {
    setMode("robots");
    console.log("[demo] starting (Windows mode)");
    runRobotsIntroWindows(0);
  } else {
    if (starwarsTracks.length === 0) starwarsTracks = loadStarwarsTracks();
    console.log(`[demo] starting — robots intro, ${starwarsTracks.length} orchestrated track(s), then ${SONGS.length} song(s)`);
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

// ── Linux: robots intro → MIDI tracks → sensor songs → loop ──

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
    songIdx = 0;
    schedule(() => runSongsPhase(), PAUSE_BETWEEN_TRACKS_MS);
    return;
  }
  const name = starwarsTracks[idx];
  const ms = getDemoTrackMs(name);
  console.log(`[demo] track: ${name} (${(ms / 1000).toFixed(1)}s)`);
  playDemoTrack(name);
  schedule(() => runStarwarsLinux(idx + 1), ms + PAUSE_BETWEEN_TRACKS_MS);
}

// ── Windows: robots intro → sensor songs → loop ──

function runRobotsIntroWindows(sensor: number): void {
  if (!active) return;
  if (sensor >= 10) {
    console.log("[demo] robots intro done; starting songs");
    songIdx = 0;
    schedule(() => runSongsPhase(), PAUSE_AFTER_INTRO_MS);
    return;
  }
  console.log(`[demo] robots[${sensor + 1}]`);
  playSound(sensor + 1);
  schedule(() => runRobotsIntroWindows(sensor + 1), ROBOTS_INTRO_GAP_MS);
}

// ── Songs phase: shared by both platforms ──
//
// Linux uses playSoundFromMode so the user's `currentMode` is never touched —
// pre-loaded samples for every mode live in the mixer. Windows has to swap
// modes (its PowerShell SoundPlayer daemon is one-sample-per-sensor) so we
// setMode at the start of each song, then stopDemo restores prevMode.

function runSongsPhase(): void {
  if (!active) return;
  if (songIdx >= SONGS.length) {
    songIdx = 0;
    if (isWindows) {
      setMode("robots");
      schedule(() => runRobotsIntroWindows(0), PAUSE_BEFORE_LOOP_MS);
    } else {
      schedule(() => runRobotsIntroLinux(0), PAUSE_BEFORE_LOOP_MS);
    }
    return;
  }
  const song = SONGS[songIdx++];
  console.log(`[demo] song: ${song.name} (${song.mode})`);
  if (isWindows) setMode(song.mode);
  playSongBeats(song, 0, () => {
    schedule(() => runSongsPhase(), PAUSE_BETWEEN_SONGS_MS);
  });
}

function playSongBeats(song: Song, i: number, onDone: () => void): void {
  if (!active) return;
  if (i >= song.beats.length) { onDone(); return; }
  const [sensor, gap] = song.beats[i];
  if (isWindows) playSound(sensor);
  else playSoundFromMode(song.mode, sensor);
  timer = setTimeout(() => playSongBeats(song, i + 1, onDone), gap);
}
