import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const BAUD_RATE = 115200;

export async function findArduinos(): Promise<string[]> {
  const ports = await SerialPort.list();
  const arduinos = ports.filter(
    (p) =>
      p.manufacturer?.toLowerCase().includes("arduino") ||
      p.vendorId === "2341",
  );
  if (arduinos.length === 0) {
    console.log("Available ports:", ports);
    throw new Error("No Arduino found. Check USB connection.");
  }
  return arduinos.map((p) => p.path);
}

export function connect(portPath: string) {
  const port = new SerialPort({ path: portPath, baudRate: BAUD_RATE });
  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
  return { port, parser };
}
