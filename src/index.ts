import { findArduinos, connect } from "./serial";
import { log } from "./logger";
import { cycleMode, initSoundChannels, listModes, playSound } from "./sound";

const TOTAL_SENSORS = 10;
const DEFAULT_MODE = "pian";

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
          break;
        case "restored":
          log(`[${ts}] [${label}] Sensor ${event.sensor} restored (value: ${event.value})`);
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
  });
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

  const portPaths = await findArduinos();
  console.log(`Found ${portPaths.length} Arduino(s): ${portPaths.join(", ")}`);

  for (const p of portPaths) {
    attachBoard(p);
  }

  attachKeyboard();
}

main().catch(console.error);
