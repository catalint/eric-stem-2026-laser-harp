// Generate a `robots` mode: 10 short droid-style synth sound effects.
// Sensors 1–5: R2-D2-ish (urgent square-wave warbles, pitch sweeps, vibrato).
// Sensors 6–10: BB-8-ish (cuter, smoother chirps with rounder timbre).
//
// All sounds: 48 kHz / 16-bit / stereo, sub-second length, fade-in + fade-out.

import { writeFileSync, mkdirSync } from "fs";

const RATE = 48000;
const CHANNELS = 2;
const OUT_DIR = "sounds/robots";

// ----- waveforms -----
const square = (phase: number, duty = 0.5): number => (phase % 1 < duty ? 1 : -1);
const tri    = (phase: number): number => 4 * Math.abs((phase % 1) - 0.5) - 1;
const sine   = (phase: number): number => Math.sin(2 * Math.PI * phase);

// ----- envelopes -----
function adsr(t: number, dur: number, atk: number, rel: number): number {
  if (t < atk) return t / atk;
  if (t > dur - rel) return Math.max(0, (dur - t) / rel);
  return 1;
}

// ----- helpers -----
type Voice = (t: number) => number; // returns -1..1 audio at time t (seconds)

function render(dur: number, voice: Voice): Buffer {
  const numFrames = Math.floor(RATE * dur);
  const dataSize = numFrames * CHANNELS * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(CHANNELS, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * CHANNELS * 2, 28);
  buf.writeUInt16LE(CHANNELS * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);

  // peak normalize to 0.9 of full scale
  const out = new Float32Array(numFrames);
  let peak = 0;
  for (let i = 0; i < numFrames; i++) {
    const t = i / RATE;
    out[i] = voice(t);
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const scale = peak > 0 ? 0.9 / peak : 1;

  for (let i = 0; i < numFrames; i++) {
    const v = Math.max(-1, Math.min(1, out[i] * scale)) * 32767;
    buf.writeInt16LE(v | 0, 44 + i * 4);
    buf.writeInt16LE(v | 0, 44 + i * 4 + 2);
  }
  return buf;
}

// Phase accumulator for varying frequency over time.
function makePhase(): { tick: (freqHz: number) => number } {
  let phase = 0;
  return {
    tick(freqHz: number) {
      phase += freqHz / RATE;
      return phase;
    },
  };
}

// ----- R2-D2 voices (1–5) -----

// 1. Three-step "beep boop bop" cascade.
function r2_cascade(): { dur: number; voice: Voice } {
  const dur = 0.85;
  const steps = [780, 520, 350]; // descending
  const stepDur = dur / steps.length;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const idx = Math.min(steps.length - 1, Math.floor(t / stepDur));
      const inStep = t - idx * stepDur;
      const env = adsr(inStep, stepDur, 0.005, stepDur * 0.6);
      const vib = steps[idx] + 8 * sine(t * 7);
      return square(ph.tick(vib), 0.5) * env * 0.8;
    },
  };
}

// 2. Excited fast warble (rapid pitch modulation).
function r2_warble(): { dur: number; voice: Voice } {
  const dur = 0.7;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const center = 700 + 200 * Math.sin((t / dur) * Math.PI);
      const fm = center + 220 * sine(t * 14);
      return square(ph.tick(fm), 0.45) * adsr(t, dur, 0.01, 0.05) * 0.85;
    },
  };
}

// 3. Question — rising arpeggio + beep tail.
function r2_question(): { dur: number; voice: Voice } {
  const dur = 0.95;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      let f: number;
      if (t < 0.55) {
        // upward sweep 300 → 1100 Hz
        f = 300 + (1100 - 300) * (t / 0.55);
      } else if (t < 0.7) {
        f = 0; // gap
      } else {
        f = 1100; // emphatic beep at top
      }
      if (f === 0) return 0;
      const env = adsr(t, dur, 0.01, 0.04);
      return square(ph.tick(f), 0.5) * env * 0.85;
    },
  };
}

// 4. Alarmed scream — rapid up/down sweeps with heavy vibrato.
function r2_scream(): { dur: number; voice: Voice } {
  const dur = 1.0;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      // Two sweeps: 400→1400→500
      const u = t / dur;
      const ramp = u < 0.5 ? u * 2 : (1 - u) * 2;
      const f = 400 + ramp * 1000 + 80 * sine(t * 22);
      return square(ph.tick(f), 0.5) * adsr(t, dur, 0.005, 0.07) * 0.85;
    },
  };
}

// 5. Curious whistle — slow rising sine, brighter timbre.
function r2_whistle(): { dur: number; voice: Voice } {
  const dur = 0.9;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const f = 500 + 700 * (t / dur) + 6 * sine(t * 5);
      const v = sine(ph.tick(f)) * 0.6 + sine(ph.tick(f) * 2) * 0.3;
      return v * adsr(t, dur, 0.04, 0.12) * 0.85;
    },
  };
}

// ----- BB-8 voices (6–10): rounder, brighter, cuter -----

// 6. Cute upward chirp.
function bb_chirp(): { dur: number; voice: Voice } {
  const dur = 0.45;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const f = 700 + 900 * (t / dur);
      return tri(ph.tick(f)) * adsr(t, dur, 0.005, 0.06) * 0.85;
    },
  };
}

// 7. Two affirmative beeps.
function bb_double(): { dur: number; voice: Voice } {
  const dur = 0.55;
  const beepLen = 0.18;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      let inBeep = false;
      let local = 0;
      let f = 0;
      if (t < beepLen)            { inBeep = true; local = t;            f = 900;  }
      else if (t < 0.30)          { /* gap */ }
      else if (t < 0.30 + beepLen){ inBeep = true; local = t - 0.30;     f = 1200; }
      if (!inBeep) return 0;
      const env = adsr(local, beepLen, 0.005, 0.04);
      return tri(ph.tick(f)) * env * 0.85;
    },
  };
}

// 8. Gentle sustained hum with slight vibrato.
function bb_hum(): { dur: number; voice: Voice } {
  const dur = 0.9;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const f = 520 + 14 * sine(t * 5);
      const v = sine(ph.tick(f)) * 0.6 + tri(ph.tick(f)) * 0.25;
      return v * adsr(t, dur, 0.05, 0.12) * 0.8;
    },
  };
}

// 9. Excited burble — series of small chirps.
function bb_burble(): { dur: number; voice: Voice } {
  const dur = 0.85;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const chirpLen = 0.09;
      const idx = Math.floor(t / chirpLen);
      const inChirp = t - idx * chirpLen;
      const f = 600 + (idx % 3) * 220 + 220 * (inChirp / chirpLen);
      const env = adsr(inChirp, chirpLen, 0.003, chirpLen * 0.5);
      const overall = adsr(t, dur, 0.02, 0.08);
      return tri(ph.tick(f)) * env * overall * 0.85;
    },
  };
}

// 10. Inquisitive coo — gentle rising-then-falling sine.
function bb_coo(): { dur: number; voice: Voice } {
  const dur = 0.9;
  const ph = makePhase();
  return {
    dur,
    voice: (t) => {
      const u = t / dur;
      const f = 480 + 380 * Math.sin(u * Math.PI);
      return sine(ph.tick(f)) * adsr(t, dur, 0.05, 0.15) * 0.85;
    },
  };
}

const sounds = [
  r2_cascade,  // 1
  r2_warble,   // 2
  r2_question, // 3
  r2_scream,   // 4
  r2_whistle,  // 5
  bb_chirp,    // 6
  bb_double,   // 7
  bb_hum,      // 8
  bb_burble,   // 9
  bb_coo,      // 10
];

mkdirSync(OUT_DIR, { recursive: true });
for (let i = 0; i < sounds.length; i++) {
  const { dur, voice } = sounds[i]();
  const buf = render(dur, voice);
  writeFileSync(`${OUT_DIR}/${i + 1}.wav`, buf);
  console.log(`  ${i + 1}.wav  ${(dur * 1000) | 0} ms  ${i < 5 ? "R2-D2" : "BB-8"}`);
}
