import { parentPort, workerData } from "node:worker_threads";
import { makeApi } from "./api.ts";

const { sab, botId, source } = workerData as {
  sab: SharedArrayBuffer;
  botId: number;
  source: string;
};

const port = parentPort!;
const { bot, colony } = makeApi(sab, botId, (m) => port.postMessage(m));

try {
  // Player scripts are ordinary JavaScript with two globals in scope.
  const fn = new Function("bot", "colony", `"use strict";\n${source}`);
  fn(bot, colony);
  port.postMessage({ kind: "done" });
} catch (err) {
  port.postMessage({ kind: "error", message: err instanceof Error ? err.message : String(err) });
}
