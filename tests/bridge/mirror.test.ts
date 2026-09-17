import { Worker } from "node:worker_threads";
import {
  createChannel,
  ctrlOf,
  mirrorOf,
  MIRROR_BYTES,
  MIRROR_SEQ,
  MIRROR_LEN,
} from "../../src/bridge/protocol.ts";
import { publishMirror, readMirror } from "../../src/bridge/mirror.ts";

const state = { time: 4, pos: { x: 17, y: 16 }, inventory: { wheat: 2 }, modules: ["harvester"], busy: false };

describe("mirror", () => {
  it("round-trips published state", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual(state);
  });

  it("leaves the sequence even after a completed write", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    expect(Atomics.load(ctrlOf(sab), MIRROR_SEQ) % 2).toBe(0);
  });

  it("gives up rather than returning a frame written mid-flight", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    // An odd sequence is what a writer leaves behind while it is still writing.
    Atomics.store(ctrlOf(sab), MIRROR_SEQ, 1);
    expect(() => readMirror(ctrlOf(sab), mirrorOf(sab))).toThrow("mirror never settled");
  });

  it("recovers once the writer finishes", () => {
    const sab = createChannel();
    Atomics.store(ctrlOf(sab), MIRROR_SEQ, 1);
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual(state);
  });

  it("does not crash on a torn frame, it retries", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    // Truncating the length mid-JSON is what a half-written frame looks like.
    Atomics.store(ctrlOf(sab), MIRROR_LEN, 5);
    expect(() => readMirror(ctrlOf(sab), mirrorOf(sab))).toThrow("mirror never settled");
  });

  it("reads the newest state after repeated publishes", () => {
    const sab = createChannel();
    for (let t = 0; t < 5; t++) publishMirror(ctrlOf(sab), mirrorOf(sab), { ...state, time: t });
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual({ ...state, time: 4 });
  });

  /**
   * The two ways a reader used to be told a writer was wedged when it was not.
   *
   * Both were found by playing the game rather than by reading this file: the
   * shipped "A field that lasts" chip died with "mirror never settled" on its
   * `bot.pos()` walk, reproducibly, on the same line.
   */
  it("is patient for a length of time, not for a number of tries", () => {
    // A thousand spins of the old loop took microseconds, so a writer that had
    // merely been descheduled — which lasts milliseconds — read as wedged.
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    Atomics.store(ctrlOf(sab), MIRROR_SEQ, 1);

    const started = Date.now();
    expect(() => readMirror(ctrlOf(sab), mirrorOf(sab))).toThrow("mirror never settled");
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
  });

  it("waits out a writer that was descheduled mid-frame", async () => {
    // The bug, reproduced: a reader in a worker, a writer that goes away for
    // 100ms in the middle of publishing. That is an ordinary pause for a main
    // thread — a garbage collection, a long frame, a busy tab — and the old
    // reader spent its whole budget of a thousand tries inside it, in
    // microseconds, and reported the writer wedged. The player saw their script
    // die on a `bot.pos()`.
    const sab = createChannel();
    const ctrl = ctrlOf(sab);
    const mirror = mirrorOf(sab);
    publishMirror(ctrl, mirror, state);

    // A write in flight, left that way: odd sequence, nobody finishing it yet.
    Atomics.store(ctrl, MIRROR_SEQ, Atomics.load(ctrl, MIRROR_SEQ) + 1);

    const worker = new Worker(new URL("./mirror-reader-worker.ts", import.meta.url), {
      workerData: { sab },
    });
    await new Promise<void>((resolve, reject) => {
      worker.once("message", () => resolve());
      worker.once("error", reject);
    });

    // Busy rather than awaited, because a main thread that is merely slow is
    // not yielding either. This is the writer being away from its desk.
    const until = Date.now() + 100;
    while (Date.now() < until) { /* held up */ }

    const next = { ...state, time: 99 };
    publishMirror(ctrl, mirror, next);

    const got = await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    await worker.terminate();

    expect(got).toEqual({ kind: "read", value: next });
  });

  it("does not wedge the mirror when a frame will not fit", () => {
    // The wedge milestone 10 fixed on the result frame, still live on this one.
    // `encodeFrame` throws on an oversized value; thrown between the two
    // sequence stores it left the mirror odd, and *every* read after it failed
    // for the rest of the session — a bot whose pos() never worked again.
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);

    const huge = { junk: "x".repeat(MIRROR_BYTES) };
    expect(() => publishMirror(ctrlOf(sab), mirrorOf(sab), huge)).toThrow("frame too large");

    expect(Atomics.load(ctrlOf(sab), MIRROR_SEQ) % 2).toBe(0);
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual(state);
  });
});
