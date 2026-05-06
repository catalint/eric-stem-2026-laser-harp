import { writeFileSync } from "fs";

const SAMPLE_RATE = 44100;
const DURATION = 1.0;
const CHANNELS = 2;

// C3 to D4 — Do Re Mi Fa Sol La Si Do Re Mi (low octave up)
const NOTES: [string, number][] = [
  ["Do (C3)", 130.81],
  ["Re (D3)", 146.83],
  ["Mi (E3)", 164.81],
  ["Fa (F3)", 174.61],
  ["Sol (G3)", 196.00],
  ["La (A3)", 220.00],
  ["Si (B3)", 246.94],
  ["Do (C4)", 261.63],
  ["Re (D4)", 293.66],
  ["Mi (E4)", 329.63],
];

function generateWav(frequency: number): Buffer {
  const numSamples = Math.floor(SAMPLE_RATE * DURATION);
  const dataSize = numSamples * CHANNELS * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28);
  buffer.writeUInt16LE(CHANNELS * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t * 4);
    const sample = Math.floor(
      (Math.sin(2 * Math.PI * frequency * t) * 0.5 +
        Math.sin(2 * Math.PI * frequency * 2 * t) * 0.25 +
        Math.sin(2 * Math.PI * frequency * 3 * t) * 0.125 +
        Math.sin(2 * Math.PI * frequency * 4 * t) * 0.0625) *
        32767 *
        envelope
    );
    buffer.writeInt16LE(sample, 44 + i * 4);
    buffer.writeInt16LE(sample, 44 + i * 4 + 2);
  }

  return buffer;
}

for (let i = 0; i < NOTES.length; i++) {
  const [name, freq] = NOTES[i];
  const wav = generateWav(freq);
  writeFileSync(`sounds/synth/${i + 1}.wav`, wav);
  console.log(`${i + 1}.wav — ${name} (${freq} Hz)`);
}
