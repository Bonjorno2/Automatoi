import { Worker } from "node:worker_threads";

describe("worker toolchain", () => {
  it("spawns a .ts worker that blocks on Atomics.wait", async () => {
    const sab = new SharedArrayBuffer(8);
    const ctrl = new Int32Array(sab);
    const url = new URL("../../src/bridge/handshake-worker.ts", import.meta.url);
    const worker = new Worker(url, { workerData: { sab } });
    try {
      const got = await new Promise<number>((resolve, reject) => {
        worker.on("message", (m) => resolve(m.got));
        worker.on("error", reject);
        const timer = setInterval(() => {
          if (Atomics.load(ctrl, 0) === 1) {
            Atomics.store(ctrl, 1, Atomics.load(ctrl, 1) * 2);
            Atomics.store(ctrl, 0, 2);
            Atomics.notify(ctrl, 0);
            clearInterval(timer);
          }
        }, 1);
      });
      expect(got).toBe(84);
    } finally {
      await worker.terminate();
    }
  }, 15_000);
});
