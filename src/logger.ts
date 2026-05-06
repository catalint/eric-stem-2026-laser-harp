import { createWriteStream } from "fs";

const LOG_FILE = "laser.log";
const logStream = createWriteStream(LOG_FILE, { flags: "a" });

export function log(msg: string, toFile = true) {
  console.log(msg);
  if (toFile) logStream.write(msg + "\n");
}
