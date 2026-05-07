# Laser harp

Lasers + photo-receivers form 10 strings. Beam interrupted → host plays a sample for that string. Arduinos read the sensors and emit JSON over serial; a Node.js process on the host plays the audio.

## Architecture

```
Arduino #1 (sensors 1-5)  ─┐
                           ├─ USB serial (115200) → Node.js host → audio out
Arduino #2 (sensors 6-10) ─┘
```

- `arduino/laser_sensor/laser_sensor.ino` — flashed to both boards. The split is done at compile time with `-DSENSOR_OFFSET=0` and `-DSENSOR_OFFSET=5`. Pins A1..A5.
- `src/serial.ts` — auto-discovers Arduino-vendor USB serial ports.
- `src/index.ts` — connects to every board found, dispatches `interrupted` events to `playSound(sensor)`.
- `src/sound.ts` — one persistent audio "channel" per sensor so simultaneous strings don't queue. Modes are subfolders of `sounds/` containing files named `1..10.{wav,m4a,mp3,...}`. Non-WAV is transcoded once to `sounds/.converted/<mode>/<n>.wav` via `ffmpeg-static`. Press `m` in the terminal to cycle modes.

## Non-obvious things

- **Beam polarity**: receiver outputs `HIGH` when the beam is *interrupted* (blocked), `LOW` when seen. Don't invert this without re-checking the modules.
- **`hello` event** sets the per-board `[from,to]` range so log lines say which board reported. The board doesn't know its own offset at runtime — only the compiled-in `SENSOR_OFFSET`.
- **Sound paths differ by platform.** Windows: `scripts/sound-daemon.ps1` (one PowerShell `System.Media.SoundPlayer` per sensor, fed `play` / `load <path>` over stdin). Linux: `src/mixer.ts` runs a single long-lived `pw-cat --playback --raw` process; samples are loaded into memory and mixed in JS each 10 ms tick with per-voice fade-in/out so retriggers and end-of-sample don't click. `src/sound.ts` branches on `process.platform`. Linux audio follows the default PipeWire sink (e.g. Bluetooth headphones) without needing `ALSA_CARD`.
- **Audio warmup** in the daemon plays 50ms of silence on startup so the first real `play` isn't laggy from cold-init of the Windows audio stack.

## Run

```bash
npm install
npm start          # tsx src/index.ts
npm run dev        # watch mode
```

Flash an Arduino:
```bash
arduino-cli compile --fqbn arduino:avr:uno arduino/laser_sensor \
  --build-property "compiler.cpp.extra_flags=-DSENSOR_OFFSET=5"
arduino-cli upload  --fqbn arduino:avr:uno -p COM<N> arduino/laser_sensor
```

Generate the synth tone bank: `npx tsx scripts/generate-tones.ts` → writes `sounds/synth/1..10.wav` (C3..E4 do-re-mi).

## Hosts

- **Windows dev box** (current): runs `npm start`, talks to Arduinos over USB COM ports.
- **Raspberry Pi 5 `walle-laser`** (new, intended production host): `192.168.1.222`, ssh `cata@walle-laser.local`. The Pi will host the Arduinos and audio output; once the Linux sound channel is implemented, this becomes the deploy target. Repo remote: `github:catalint/eric-stem-2026-laser-harp`.
