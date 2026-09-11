import { parentPort, workerData } from "node:worker_threads";
import {
  REQUEST, RESULT, RES_LEN, RES_OK, STATE,
  ctrlOf, resOf, writeFrame,
} from "../../src/bridge/protocol.ts";

/**
 * A stand-in host for testing `makeApi` without a World.
 *
 * It has to be a worker. `makeApi`'s calls park the calling thread on
 * `Atomics.wait`, so an answer posted from a timer on that same thread could
 * never run — this thread is free to poll while the caller is parked.
 *
 * Answers the next `replies` requests with one canned result.
 */
const { sab, ok, value, replies } = workerData as {
  sab: SharedArrayBuffer;
  ok: boolean;
  value: unknown;
  replies: number;
};

const ctrl = ctrlOf(sab);
const res = resOf(sab);

parentPort!.postMessage({ kind: "ready" });

for (let i = 0; i < replies; i++) {
  let state = Atomics.load(ctrl, STATE);
  // A timeout keeps a missed notify from wedging the test suite.
  while (state !== REQUEST) {
    Atomics.wait(ctrl, STATE, state, 50);
    state = Atomics.load(ctrl, STATE);
  }
  Atomics.store(ctrl, RES_LEN, writeFrame(res, value));
  Atomics.store(ctrl, RES_OK, ok ? 1 : 0);
  Atomics.store(ctrl, STATE, RESULT);
  Atomics.notify(ctrl, STATE);
}
