import { listArduinoPorts, connect } from "./serial";
import { log } from "./logger";
import { cycleMode, initSoundChannels, listModes, playSound } from "./sound";
import { startBtWatchdog } from "./bt-watchdog";
import { markShuttingDown } from "./mixer";

for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(sig, () => {
    console.log(`[main] caught ${sig}, shutting down cleanly`);
    markShuttingDown();
    process.exit(0);
  });
}
process.on("exit", () => markShuttingDown());

const TOTAL_SENSORS = 10;
const DEFAULT_MODE = "pian";
const SCAN_INTERVAL_MS = 2000;
// Holding sensors 1 and 10 together cycles to the next mode — a way to
// switch sounds without a keyboard. Latches until one beam is restored.
const CHORD_CYCLE_SENSORS: [number, number] = [1, TOTAL_SENSORS];

const connected = new Set<string>();
const heldSensors = new Set<number>();
let chordTriggered = false;

function attachBoard(portPath: string) {
  console.log(`Connecting to Arduino on ${portPath}...`);
  const { port, parser } = connect(portPath);
  let label = portPath;

  port.on("open", () => {
    console.log(`[${portPath}] open, waiting for hello...`);
  });

  parser.on("data", (line: string) => {
    try {
      const event = JSON.parse(line.trim());
      const ts = new Date().toISOString();

      switch (event.event) {
        case "hello": {
          const [from, to] = event.range as [number, number];
          label = `${portPath} (sensors ${from}-${to})`;
          console.log(`[${label}] identified`);
          break;
        }
        case "boot":
          log(`[${ts}] [${label}] Sensor ${event.sensor} booted (value: ${event.value})`);
          break;
        case "interrupted":
          log(`[${ts}] [${label}] SENSOR ${event.sensor} INTERRUPTED (value: ${event.value})`);
          playSound(event.sensor);
          heldSensors.add(event.sensor);
          if (
            !chordTriggered &&
            heldSensors.has(CHORD_CYCLE_SENSORS[0]) &&
            heldSensors.has(CHORD_CYCLE_SENSORS[1])
          ) {
            chordTriggered = true;
            const next = cycleMode();
            console.log(`[chord 1+10] mode -> ${next ?? "(none)"}`);
          }
          break;
        case "restored":
          log(`[${ts}] [${label}] Sensor ${event.sensor} restored (value: ${event.value})`);
          heldSensors.delete(event.sensor);
          if (
            chordTriggered &&
            (!heldSensors.has(CHORD_CYCLE_SENSORS[0]) ||
              !heldSensors.has(CHORD_CYCLE_SENSORS[1]))
          ) {
            chordTriggered = false;
          }
          break;
        case "debug":
          log(`[${ts}] [${label}] sensors: ${event.values.join(" | ")}`, false);
          break;
        default:
          log(`[${ts}] [${label}] ${event.event}: ${JSON.stringify(event)}`);
      }
    } catch {
      console.log(`[${label}] Raw:`, line.trim());
    }
  });

  port.on("error", (err) => {
    console.error(`[${label}] Serial error:`, err.message);
  });

  port.on("close", () => {
    console.log(`[${label}] Serial port closed.`);
    connected.delete(portPath);
  });
}

async function scanForBoards() {
  let found: string[];
  try {
    found = await listArduinoPorts();
  } catch (err) {
    console.error("Port scan failed:", (err as Error).message);
    return;
  }
  for (const p of found) {
    if (connected.has(p)) continue;
    connected.add(p);
    attachBoard(p);
  }
}

function attachKeyboard() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (buf) => {
    const code = buf[0];
    if (code === 0x6d) {
      cycleMode();
    } else if (code === 0x03 || code === 0x71) {
      process.exit(0);
    }
  });
  console.log(`Modes: ${listModes().join(", ")}. Press 'm' to cycle, 'q' to quit.`);
}

async function main() {
  initSoundChannels(TOTAL_SENSORS, DEFAULT_MODE);
  attachKeyboard();

  console.log(`Watching for Arduinos every ${SCAN_INTERVAL_MS}ms.`);
  await scanForBoards();
  setInterval(scanForBoards, SCAN_INTERVAL_MS);
  startBtWatchdog();
}

main().catch(console.error);
