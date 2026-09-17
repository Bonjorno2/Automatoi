import { MIRROR_LEN, MIRROR_SEQ, encodeFrame, readFrame } from "./protocol.ts";

/**
 * How long a reader will wait for a writer before calling it wedged.
 *
 * **A duration, because the count this used to be was not one.** A thousand
 * spins of this loop take microseconds; a main thread descheduled part-way
 * through publishing is away for milliseconds. So a reader burned its whole
 * budget inside a single ordinary pause and threw "mirror never settled" at a
 * writer that was about to finish — which a player saw as their script dying on
 * a `bot.pos()`, with a message meaning nothing to them. Found by playing the
 * shipped "A field that lasts" chip, twice, on the same line.
 *
 * The host publishes once a frame, so a reader that has waited this long has
 * waited about fifteen of them and is looking at a host that is not publishing
 * at all. That is worth an error. A slow one is not.
 */
const PATIENCE_MS = 250;

/**
 * Whether this agent is allowed to block, learned the only way there is.
 *
 * Workers may park on `Atomics.wait`; the main thread may not, and throws if it
 * tries. Both call this module — the worker to read the mirror, the host's own
 * tests to check it — so the answer is discovered once and remembered.
 */
let canBlock = true;

function parkUntilSequenceMoves(ctrl: Int32Array, was: number, ms: number): void {
  if (!canBlock) return;
  try {
    Atomics.wait(ctrl, MIRROR_SEQ, was, ms);
  } catch {
    canBlock = false;
  }
}

/**
 * Publish readable bot state. The sequence number is odd for the duration of
 * the write, so a reader can tell it saw a half-written frame and try again.
 *
 * **Nothing between the two sequence stores is allowed to throw or to dawdle.**
 * The frame is encoded first, outside the window, for both reasons. A throw in
 * there — and `encodeFrame` throws, on a frame too large — would leave the
 * sequence odd with nobody to even it again, and every read for the rest of the
 * session would fail. That is the same wedge milestone 10 found on the result
 * frame, where an oversized `scan` killed a bot for good; it was still here, on
 * this path, waiting for a mirror big enough. Doing the stringify and the encode
 * outside also cuts the window to a copy and two stores, which is the part a
 * reader can be caught inside.
 */
export function publishMirror(ctrl: Int32Array, bytes: Uint8Array, value: unknown): void {
  const frame = encodeFrame(value, bytes.length);

  // Step to the next odd value rather than incrementing blindly: a write that
  // died midway leaves the sequence odd, and the next one must still end even.
  // The counter only ever moves forward, so a reader still sees it change.
  const seq = Atomics.load(ctrl, MIRROR_SEQ);
  const writing = seq % 2 === 0 ? seq + 1 : seq + 2;
  Atomics.store(ctrl, MIRROR_SEQ, writing);
  bytes.set(frame);
  Atomics.store(ctrl, MIRROR_LEN, frame.length);
  Atomics.store(ctrl, MIRROR_SEQ, writing + 1); // -> even, settled
  // Wake whatever parked on the write that just finished. Free when nobody did.
  Atomics.notify(ctrl, MIRROR_SEQ);
}

/**
 * Read published state without taking a lock. Retries while a write is in
 * flight; a torn frame fails to parse, which is just another reason to retry.
 *
 * A write in flight is waited on rather than spun on. The writer is a different
 * thread and the only thing worth doing until it finishes is nothing.
 */
export function readMirror(ctrl: Int32Array, bytes: Uint8Array): unknown {
  const deadline = Date.now() + PATIENCE_MS;
  for (;;) {
    const before = Atomics.load(ctrl, MIRROR_SEQ);
    if (before % 2 === 0) {
      let value: unknown;
      let whole = false;
      try {
        value = readFrame(bytes, Atomics.load(ctrl, MIRROR_LEN));
        whole = true;
      } catch {
        // A half-written frame does not parse. Fall through and come round.
      }
      if (whole && Atomics.load(ctrl, MIRROR_SEQ) === before) return value;
    } else {
      const left = deadline - Date.now();
      if (left > 0) parkUntilSequenceMoves(ctrl, before, left);
    }
    if (Date.now() >= deadline) throw new Error("mirror never settled");
  }
}
