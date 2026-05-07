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

// Track consecutive bad checks per sink so a single transient blip doesn't
// trigger an unnecessary recovery cycle.
const consecutiveBad = new Map<string, number>();
const BAD_STREAK_THRESHOLD = 2;

type PwNode = { info?: { state?: string; props?: Record<string, string> } };

async function findSilentBtSink(): Promise<Suspect | null> {
  const { code, stdout } = await run("pw-dump", []);
  if (code !== 0) return null;
  let dump: PwNode[];
  try { dump = JSON.parse(stdout); } catch { return null; }
  if (!Array.isArray(dump)) return null;

  // Is our pw-cat stream healthy? If the stream is "running", audio is flowing
  // regardless of what api.bluez5.transport says (that property is unreliable).
  const ourStream = dump.find((n) =>
    n?.info?.props?.["media.class"] === "Stream/Output/Audio" &&
    n?.info?.props?.["application.name"] === "pw-cat",
  );
  const streamState = ourStream?.info?.state ?? "missing";
  const streamBad = streamState !== "running";

  for (const node of dump) {
    const props = node?.info?.props;
    if (!props) continue;
    if (props["media.class"] !== "Audio/Sink") continue;
    if (props["device.api"] !== "bluez5") continue;

    const sinkState = node.info?.state ?? "missing";
    const address = props["api.bluez5.address"];
    const sinkName = props["node.name"] ?? "";
    if (!address) continue;

    // Healthy when sink is running or idle (idle just means no audio right
    // now; the moment data arrives it will go to running). Only suspended
    // or error are pathological while we expect to be feeding it.
    const sinkBad = sinkState === "suspended" || sinkState === "error";
    if (!sinkBad || !streamBad) {
      consecutiveBad.delete(address);
      continue;
    }

    // BlueZ has to still consider the device connected, otherwise the user
    // just turned the headset off and we should leave it alone.
    const info = await run("bluetoothctl", ["info", address]);
    if (info.code !== 0) continue;
    if (!/Connected:\s+yes/i.test(info.stdout)) {
      consecutiveBad.delete(address);
      continue;
    }

    const streak = (consecutiveBad.get(address) ?? 0) + 1;
    consecutiveBad.set(address, streak);
    if (streak < BAD_STREAK_THRESHOLD) continue;

    consecutiveBad.delete(address);
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
