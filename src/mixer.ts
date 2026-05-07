import { ChildProcess, spawn } from "child_process";
import { readFileSync } from "fs";
import { Writable, Readable } from "stream";

const RATE = 48000;
const CHANNELS = 2;
const FRAMES_PER_CHUNK = Math.round(RATE * 0.010); // 10 ms per write
const FADE_IN_FRAMES = Math.round(RATE * 0.003);   // 3 ms
const FADE_OUT_FRAMES = Math.round(RATE * 0.015);  // 15 ms
const TAIL_FADE_FRAMES = Math.round(RATE * 0.020); // 20 ms tail to soften end of sample
// 32 KB → ~170 ms of stereo s16 buffered ahead. Smaller = lower latency,
// bigger = more slack against JS event-loop jitter. With drain-driven pumping
// this is the dominant source of trigger latency on the source side.
const TARGET_QUEUE_BYTES = 32 * 1024;

type Sample = { pcm: Int16Array; frames: number };
type Voice = {
  sample: Sample;
  pos: number;
  key: string;
  fading: boolean;
  fadePos: number;
};

const samples = new Map<string, Sample>();
const voices: Voice[] = [];

type MixerProc = ChildProcess & { stdin: Writable; stderr: Readable };
let proc: MixerProc | null = null;

function parseWav(buf: Buffer): Int16Array {
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a RIFF file");
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "data") {
      const start = buf.byteOffset + off + 8;
      // Copy into a fresh, aligned ArrayBuffer so Int16Array view is safe.
      const ab = new ArrayBuffer(size);
      Buffer.from(ab).set(buf.subarray(off + 8, off + 8 + size));
      return new Int16Array(ab);
    }
    off += 8 + size + (size & 1); // chunks are word-aligned
  }
  throw new Error("no data chunk in WAV");
}

export function startMixer(): void {
  if (proc) return;
  const child = spawn(
    "pw-cat",
    [
      "--playback",
      "--raw",
      "--rate", String(RATE),
      "--channels", String(CHANNELS),
      "--format", "s16",
      "--latency", "50ms",
      "--target", "@DEFAULT_AUDIO_SINK@",
      "-",
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  ) as MixerProc;
  proc = child;
  child.stderr.on("data", (b: Buffer) => {
    process.stderr.write(`[mixer] ${b}`);
  });
  child.stdin.on("drain", pump);
  child.on("exit", (code) => {
    console.error(`[mixer] pw-cat exited (code ${code}); restarting in 1s`);
    proc = null;
    setTimeout(startMixer, 1000);
  });
  // Prime the pipeline.
  pump();
}

export function loadSample(key: string, wavPath: string): void {
  const pcm = parseWav(readFileSync(wavPath));
  samples.set(key, { pcm, frames: pcm.length / CHANNELS });
}

export function hasSample(key: string): boolean {
  return samples.has(key);
}

export function getSampleDurationMs(key: string): number {
  const s = samples.get(key);
  return s ? (s.frames / RATE) * 1000 : 0;
}

export function clearSamples(): void {
  samples.clear();
}

export function playSample(key: string): void {
  const sample = samples.get(key);
  if (!sample) return;
  // Monophonic per key: fade out any active voice with this same key.
  // Different keys mix freely (polyphony across modes/sensors).
  for (const v of voices) {
    if (v.key === key && !v.fading) {
      v.fading = true;
      v.fadePos = 0;
    }
  }
  voices.push({ sample, pos: 0, key, fading: false, fadePos: 0 });
}

// Fade out every currently-playing voice. Used by the demo to cut off long
// orchestrated tracks the moment a real beam interrupt arrives.
export function stopAllVoices(): void {
  for (const v of voices) {
    if (!v.fading) { v.fading = true; v.fadePos = 0; }
  }
}

function renderChunk(): Buffer {
  const out = new Int16Array(FRAMES_PER_CHUNK * CHANNELS);
  for (let f = 0; f < FRAMES_PER_CHUNK; f++) {
    let l = 0;
    let r = 0;
    for (const v of voices) {
      if (v.pos >= v.sample.frames) continue;

      let gain = 1;
      if (v.pos < FADE_IN_FRAMES) gain *= v.pos / FADE_IN_FRAMES;
      const remaining = v.sample.frames - v.pos;
      if (remaining < TAIL_FADE_FRAMES) gain *= remaining / TAIL_FADE_FRAMES;
      if (v.fading) {
        const fg = Math.max(0, 1 - v.fadePos / FADE_OUT_FRAMES);
        gain *= fg;
        v.fadePos++;
      }

      const i = v.pos * CHANNELS;
      l += v.sample.pcm[i] * gain;
      r += v.sample.pcm[i + 1] * gain;
      v.pos++;
    }
    out[f * CHANNELS] = l > 32767 ? 32767 : l < -32768 ? -32768 : l;
    out[f * CHANNELS + 1] = r > 32767 ? 32767 : r < -32768 ? -32768 : r;
  }

  for (let i = voices.length - 1; i >= 0; i--) {
    const v = voices[i];
    if (v.pos >= v.sample.frames) voices.splice(i, 1);
    else if (v.fading && v.fadePos >= FADE_OUT_FRAMES) voices.splice(i, 1);
  }

  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

function pump(): void {
  if (!proc?.stdin || proc.stdin.destroyed) return;
  // Keep ~1.5 s of audio buffered ahead. We ignore write()'s false return
  // (Node's default 16 KB highWaterMark is way too small for our needs);
  // 'drain' fires once below HWM and we refill back to the target.
  while (proc.stdin.writableLength < TARGET_QUEUE_BYTES) {
    proc.stdin.write(renderChunk());
  }
}

export function shutdownMixer(): void {
  if (proc) {
    proc.removeAllListeners("exit");
    proc.stdin.end();
    proc.kill("SIGTERM");
    proc = null;
  }
}
