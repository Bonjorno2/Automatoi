import { parentPort, workerData } from "node:worker_threads";
import { ctrlOf, mirrorOf } from "../../src/bridge/protocol.ts";
import { readMirror } from "../../src/bridge/mirror.ts";

/**
 * A stand-in for a bot script reading `bot.pos()`.
 *
 * It has to be a worker. The fix under test is that a reader *parks* on a write
 * in flight, and only a worker is allowed to park — the main thread throws if it
 * tries to block, so a reader on the main thread could only ever spin and this
 * test would be measuring the wrong thing.
 */
const { sab } = workerData as { sab: SharedArrayBuffer };

parentPort!.postMessage({ kind: "ready" });

try {
  parentPort!.postMessage({ kind: "read", value: readMirror(ctrlOf(sab), mirrorOf(sab)) });
} catch (e) {
  parentPort!.postMessage({ kind: "threw", message: (e as Error).message });
}
