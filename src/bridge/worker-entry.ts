import { parentPort, workerData } from "node:worker_threads";
import { runScript } from "./run-script.ts";
import type { WorkerInit } from "./spawn.ts";

/** Node entry point. The browser's twin is `worker-entry.web.ts`. */
const port = parentPort!;
runScript(workerData as WorkerInit, (m) => port.postMessage(m));
