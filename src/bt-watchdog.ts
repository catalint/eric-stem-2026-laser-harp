import { spawn } from "node:child_process";
import { restartMixer } from "./mixer";

// Detects the "Bluetooth transport silently dropped" symptom: PipeWire's
// bluez_output sink reports an empty `api.bluez5.transport` while BlueZ
// itself still says the device is connected. When seen, recycle the BT
// connection and force pw-cat to relink to the freshly-rebuilt sink.

const CHECK_INTERVAL_MS = 30_000;
const COOLDOWN_MS = 25_000;
const RECONNECT_PAUSE_MS = 3_000;
const POST_CONNECT_PAUSE_MS = 2_500;
const PROC_TIMEOUT_MS = 6_000;

let cooldownUntil = 0;

function run(cmd: string, args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    p.stdout.on("data", (d) => { stdout += d.toString(); });
    p.on("close", (code) => resolve({ code: code ?? 1, stdout }));
    p.on("error", () => resolve({ code: 1, stdout }));
    setTimeout(() => p.kill("SIGTERM"), PROC_TIMEOUT_MS);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Suspect = { address: string; sinkName: string };

async function findSilentBtSink(): Promise<Suspect | null> {
  const { code, stdout } = await run("pw-dump", []);
  if (code !== 0) return null;
  let dump: unknown;
  try { dump = JSON.parse(stdout); } catch { return null; }
  if (!Array.isArray(dump)) return null;

  for (const node of dump) {
    const props = (node as { info?: { props?: Record<string, string> } })?.info?.props;
    if (!props) continue;
    if (props["media.class"] !== "Audio/Sink") continue;
    if (props["device.api"] !== "bluez5") continue;

    const transport = props["api.bluez5.transport"];
    const address = props["api.bluez5.address"];
    const sinkName = props["node.name"] ?? "";
    if (!address) continue;

    if (transport && transport !== "") continue; // healthy

    // BlueZ has to still consider the device connected, otherwise the
    // user just turned the headset off and we should leave it alone.
    const info = await run("bluetoothctl", ["info", address]);
    if (info.code !== 0) continue;
    if (!/Connected:\s+yes/i.test(info.stdout)) continue;

    return { address, sinkName };
  }
  return null;
}

async function recover(suspect: Suspect): Promise<void> {
  console.log(`[bt-watchdog] dead transport on ${suspect.address} (${suspect.sinkName}) — recovering`);
  await run("bluetoothctl", ["disconnect", suspect.address]);
  await sleep(RECONNECT_PAUSE_MS);
  await run("bluetoothctl", ["connect", suspect.address]);
  await sleep(POST_CONNECT_PAUSE_MS);
  // Force pw-cat to exit so the mixer's auto-respawn binds to the new sink.
  restartMixer();
  console.log("[bt-watchdog] recovery cycle complete");
}

async function tick(): Promise<void> {
  if (Date.now() < cooldownUntil) return;
  const suspect = await findSilentBtSink();
  if (!suspect) return;
  cooldownUntil = Date.now() + COOLDOWN_MS;
  try {
    await recover(suspect);
  } catch (e) {
    console.error(`[bt-watchdog] recovery error: ${(e as Error).message}`);
  }
}

export function startBtWatchdog(): void {
  if (process.platform !== "linux") return;
  setInterval(() => { void tick(); }, CHECK_INTERVAL_MS);
}
