import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const BAUD_RATE = 115200;

export async function listArduinoPorts(): Promise<string[]> {
  const ports = await SerialPort.list();
  return ports
    .filter(
      (p) =>
        p.manufacturer?.toLowerCase().includes("arduino") ||
        p.vendorId === "2341",
    )
    .map((p) => p.path);
}

export function connect(portPath: string) {
  const port = new SerialPort({ path: portPath, baudRate: BAUD_RATE });
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  return { port, parser };
}
