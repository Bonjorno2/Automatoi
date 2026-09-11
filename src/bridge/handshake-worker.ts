import { parentPort, workerData } from "node:worker_threads";

const { sab } = workerData as { sab: SharedArrayBuffer };
const ctrl = new Int32Array(sab);

Atomics.store(ctrl, 1, 42);
Atomics.store(ctrl, 0, 1);
Atomics.notify(ctrl, 0);
while (Atomics.load(ctrl, 0) !== 2) Atomics.wait(ctrl, 0, 1);
parentPort!.postMessage({ got: Atomics.load(ctrl, 1) });
