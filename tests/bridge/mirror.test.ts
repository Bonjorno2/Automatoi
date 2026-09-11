import { createChannel, ctrlOf, mirrorOf, MIRROR_SEQ, MIRROR_LEN } from "../../src/bridge/protocol.ts";
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
});
