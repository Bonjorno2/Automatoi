import { Worker } from "node:worker_threads";
import type { SpawnWorker } from "./spawn.ts";

/**
 * Node implementation of the worker seam, used by every test in the suite.
 * Keep this out of the browser's import graph — see `host.ts`.
 */
export const spawnNode: SpawnWorker = (init) => {
  const worker = new Worker(new URL("./worker-entry.ts", import.meta.url), {
    workerData: init,
  });
  return {
    onMessage: (fn) => void worker.on("message", fn),
    onError: (fn) => void worker.on("error", (err: Error) => fn(err.message)),
    terminate: async () => void (await worker.terminate()),
  };
};
