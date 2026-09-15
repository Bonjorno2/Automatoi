import type { SpawnWorker } from "./spawn.ts";

/**
 * Browser implementation of the worker seam.
 *
 * The init payload goes over `postMessage` rather than a constructor option.
 * A `SharedArrayBuffer` survives structured cloning by reference — that is the
 * whole point of it — so both sides end up addressing the same memory.
 */
export const spawnWeb: SpawnWorker = (init) => {
  const worker = new Worker(new URL("./worker-entry.web.ts", import.meta.url), {
    type: "module",
  });
  worker.postMessage(init);
  return {
    onMessage: (fn) => worker.addEventListener("message", (e) => fn(e.data)),
    onError: (fn) => worker.addEventListener("error", (e) => fn(e.message)),
    terminate: async () => worker.terminate(),
  };
};
