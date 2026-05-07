// Render note banks using FluidSynth + the FluidR3 General MIDI SoundFont.
//
// Builds a tiny MIDI file per (instrument, note), runs fluidsynth in
// non-realtime mode to render a 48 kHz / 16-bit / stereo WAV, then trims
// any leading silence so the attack lines up with sample 0 in the WAV.
//
// Output: sounds/<dir>/1..10.wav for each entry in BANKS.

import { execFileSync, spawnSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const RATE = 48000;
const SF = "/usr/share/sounds/sf2/FluidR3_GM.sf2";

// MIDI note numbers — C3 = 48.
const DIATONIC = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64]; // C3 D3 E3 F3 G3 A3 B3 C4 D4 E4

// Star Wars pitch set, one octave below the laser-harp diatonic so Imperial
// March hits actual bass register: G2 F♯2 B♭2 C3 D3 E♭3 F3 F♯3 G3 B♭3.
// Sensor 2 (F♯2) is the dramatic dip in Imperial March's bridge.
const STARWARS_NOTES = [43, 42, 46, 48, 50, 51, 53, 54, 55, 58];

// Each bank: dir name, GM program (0–127), pitch list, note ms, post-note tail ms.
const BANKS: {
  dir: string;
  program: number;
  notes: number[];
  noteMs: number;
  tailMs: number;
}[] = [
  { dir: "marimba",       program: 12, notes: DIATONIC,       noteMs:  300, tailMs:  900 },
  { dir: "vibraphone",    program: 11, notes: DIATONIC,       noteMs:  600, tailMs: 1800 },
  { dir: "harp",          program: 46, notes: DIATONIC,       noteMs:  400, tailMs: 1400 },
  { dir: "tubular-bells", program: 14, notes: DIATONIC,       noteMs:  300, tailMs: 2400 },
  { dir: "bell",          program:  9, notes: DIATONIC,       noteMs:  200, tailMs: 1400 }, // Glockenspiel
  { dir: "synth",         program: 81, notes: DIATONIC,       noteMs:  400, tailMs:  600 }, // Lead 2 (saw)
  { dir: "starwars",      program: 61, notes: STARWARS_NOTES, noteMs:  650, tailMs:  900 }, // Brass Section
];

function vlq(v: number): number[] {
  const out: number[] = [];
  let buf = v & 0x7f;
  while ((v >>= 7) > 0) {
    buf = (buf << 8) | (0x80 | (v & 0x7f));
  }
  while (true) {
    out.push(buf & 0xff);
    if (buf & 0x80) buf >>= 8;
    else break;
  }
  return out;
}

function buildMidi(program: number, note: number, durationTicks: number): Buffer {
  // Format 0, 1 track, 480 ticks/quarter, default 120 BPM (500 000 µs/quarter).
  const events: number[] = [
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,   // tempo 500 000 µs/q
    0x00, 0xc0, program,                         // program change ch 0
    0x00, 0x90, note, 100,                       // note on, vel 100
    ...vlq(durationTicks), 0x80, note, 0,        // note off after duration
    0x00, 0xff, 0x2f, 0x00,                      // end of track
  ];
  const trackBytes = Buffer.from(events);
  const trackLen = Buffer.alloc(4);
  trackLen.writeUInt32BE(trackBytes.length, 0);
  return Buffer.concat([
    Buffer.from([0x4d, 0x54, 0x68, 0x64,
                 0x00, 0x00, 0x00, 0x06,
                 0x00, 0x00, 0x00, 0x01,
                 0x01, 0xe0]),
    Buffer.from([0x4d, 0x54, 0x72, 0x6b]),
    trackLen,
    trackBytes,
  ]);
}

function renderNote(program: number, note: number, noteMs: number, totalMs: number, outWav: string): void {
  const dir = mkdtempSync(join(tmpdir(), "fl-"));
  const midi = join(dir, "n.mid");
  // 480 ticks per quarter, 500ms per quarter → 0.96 ticks/ms. Round to int.
  const ticks = Math.round((noteMs / 500) * 480);
  writeFileSync(midi, buildMidi(program, note, ticks));

  // fluidsynth flags: -ni (no shell), -F out.wav, -r 48000, -T wav, --gain 0.6
  // --fast-render dumps to file as fast as possible.
  const r = spawnSync(
    "fluidsynth",
    [
      "-ni",
      "-F", outWav,
      "-r", String(RATE),
      "-T", "wav",
      "--gain", "0.7",
      "--fast-render", outWav,
      SF, midi,
    ],
    { encoding: "utf8" },
  );
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error(`fluidsynth failed: ${r.stderr || r.stdout}`);

  // Trim file to roughly totalMs by re-rendering — fluidsynth keeps going past note-off
  // until the soundfont says voices are done. We then post-process with ffmpeg to clip
  // and apply a short tail-fade to remove any tail click.
  const trimmed = outWav.replace(/\.wav$/, ".trim.wav");
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", outWav,
      "-t", String(totalMs / 1000),
      "-af", "afade=t=out:st=" + ((totalMs - 30) / 1000).toFixed(3) + ":d=0.030",
      "-acodec", "pcm_s16le", "-ar", String(RATE), "-ac", "2",
      trimmed,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
  // Replace.
  writeFileSync(outWav, readFileSync(trimmed));
  rmSync(trimmed);
}

for (const bank of BANKS) {
  const dir = `sounds/${bank.dir}`;
  mkdirSync(dir, { recursive: true });
  console.log(`[${bank.dir}] program=${bank.program}`);
  for (let i = 0; i < bank.notes.length; i++) {
    const note = bank.notes[i];
    const out = `${dir}/${i + 1}.wav`;
    const totalMs = bank.noteMs + bank.tailMs;
    renderNote(bank.program, note, bank.noteMs, totalMs, out);
    console.log(`  ${i + 1}.wav  midi=${note}  ${totalMs} ms`);
  }
}
