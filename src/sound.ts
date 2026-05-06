import { ChildProcessWithoutNullStreams, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import ffmpegPath from "ffmpeg-static";

const daemonScript = resolve(__dirname, "..", "scripts", "sound-daemon.ps1");
const soundsDir = resolve(__dirname, "..", "sounds");
const cacheDir = resolve(soundsDir, ".converted");

type Mode = {
  name: string;
  paths: Map<number, string>;
};

const modes = new Map<string, Mode>();
const channels = new Map<number, ChildProcessWithoutNullStreams>();
let currentMode: Mode | null = null;

function ensureWav(srcPath: string, modeName: string, sensor: number): string {
  if (srcPath.toLowerCase().endsWith(".wav")) return srcPath;
  if (!ffmpegPath) throw new Error("ffmpeg-static not available");

  const outDir = resolve(cacheDir, modeName);
  mkdirSync(outDir, { recursive: true });
  const dst = resolve(outDir, `${sensor}.wav`);

  if (existsSync(dst) && statSync(dst).mtimeMs >= statSync(srcPath).mtimeMs) {
    return dst;
  }
  const r = spawnSync(
    ffmpegPath,
    [
      "-y",
      "-i", srcPath,
      "-acodec", "pcm_s16le",
      "-ar", "44100",
      "-ac", "2",
      "-hide_banner", "-loglevel", "error",
      dst,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr.toString().trim()}`);
  return dst;
}

function loadMode(name: string, dir: string) {
  const mode: Mode = { name, paths: new Map() };
  for (const f of readdirSync(dir)) {
    const m = f.match(/^(\d+)\.(wav|m4a|mp3|ogg|flac|aac)$/i);
    if (!m) continue;
    const sensor = parseInt(m[1], 10);
    const src = resolve(dir, f);
    try {
      mode.paths.set(sensor, ensureWav(src, name, sensor));
    } catch (e) {
      console.warn(`[mode ${name}] ${f}: ${(e as Error).message}`);
    }
  }
  if (mode.paths.size > 0) modes.set(name, mode);
  console.log(`Loaded mode '${name}': ${mode.paths.size} samples`);
}

function discoverModes() {
  for (const entry of readdirSync(soundsDir)) {
    if (entry.startsWith(".")) continue;
    const path = resolve(soundsDir, entry);
    if (statSync(path).isDirectory()) loadMode(entry, path);
  }
}

function spawnChannel(sensor: number, wavPath: string): ChildProcessWithoutNullStreams {
  const ps = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      daemonScript,
      "-WavFile",
      wavPath,
    ],
    { windowsHide: true },
  );

  ps.stdout.on("data", (chunk: Buffer) => {
    if (chunk.toString().trim() === "ready") {
      console.log(`Sensor ${sensor} channel ready`);
    }
  });

  ps.stderr.on("data", (chunk: Buffer) => {
    console.error(`[sensor ${sensor}]`, chunk.toString().trim());
  });

  ps.on("exit", (code) => {
    console.error(`Sensor ${sensor} channel exited (code ${code}); restarting...`);
    channels.delete(sensor);
    setTimeout(() => {
      const path = currentMode?.paths.get(sensor);
      if (path) channels.set(sensor, spawnChannel(sensor, path));
    }, 500);
  });

  return ps;
}

export function initSoundChannels(numSensors: number, defaultMode: string) {
  discoverModes();

  const mode = modes.get(defaultMode) ?? modes.get([...modes.keys()][0]);
  if (!mode) {
    console.warn("No sound modes found");
    return;
  }
  currentMode = mode;
  console.log(`Mode: ${mode.name}`);

  for (let i = 1; i <= numSensors; i++) {
    const path = mode.paths.get(i);
    if (path) channels.set(i, spawnChannel(i, path));
  }
}

export function setMode(name: string): boolean {
  const mode = modes.get(name);
  if (!mode) {
    console.warn(`Unknown mode: ${name} (available: ${[...modes.keys()].join(", ")})`);
    return false;
  }
  currentMode = mode;
  for (const [sensor, ch] of channels) {
    const path = mode.paths.get(sensor);
    if (path && !ch.stdin.destroyed) {
      ch.stdin.write(`load ${path}\n`);
    }
  }
  console.log(`Mode: ${name}`);
  return true;
}

export function listModes(): string[] {
  return [...modes.keys()];
}

export function getCurrentMode(): string | null {
  return currentMode?.name ?? null;
}

export function cycleMode(): string | null {
  const names = [...modes.keys()];
  if (names.length === 0) return null;
  const idx = currentMode ? names.indexOf(currentMode.name) : -1;
  const next = names[(idx + 1) % names.length];
  setMode(next);
  return next;
}

export function playSound(sensor: number) {
  const ch = channels.get(sensor);
  if (ch && !ch.stdin.destroyed) {
    ch.stdin.write("play\n");
  }
}
