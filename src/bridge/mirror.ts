import { MIRROR_LEN, MIRROR_SEQ, readFrame, writeFrame } from "./protocol.ts";

/** How many times a reader retries before deciding the writer is wedged. */
const MAX_ATTEMPTS = 1000;

/**
 * Publish readable bot state. The sequence number is odd for the duration of
 * the write, so a reader can tell it saw a half-written frame and try again.
 */
export function publishMirror(ctrl: Int32Array, bytes: Uint8Array, value: unknown): void {
  // Step to the next odd value rather than incrementing blindly: a write that
  // died midway leaves the sequence odd, and the next one must still end even.
  // The counter only ever moves forward, so a reader still sees it change.
  const seq = Atomics.load(ctrl, MIRROR_SEQ);
  const writing = seq % 2 === 0 ? seq + 1 : seq + 2;
  Atomics.store(ctrl, MIRROR_SEQ, writing);
  const len = writeFrame(bytes, value);
  Atomics.store(ctrl, MIRROR_LEN, len);
  Atomics.store(ctrl, MIRROR_SEQ, writing + 1); // -> even, settled
}

/**
 * Read published state without taking a lock. Retries while a write is in
 * flight; a torn frame fails to parse, which is just another reason to retry.
 */
export function readMirror(ctrl: Int32Array, bytes: Uint8Array): unknown {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = Atomics.load(ctrl, MIRROR_SEQ);
    if (before % 2 !== 0) continue;
    let value: unknown;
    try {
      value = readFrame(bytes, Atomics.load(ctrl, MIRROR_LEN));
    } catch {
      continue;
    }
    if (Atomics.load(ctrl, MIRROR_SEQ) === before) return value;
  }
  throw new Error("mirror never settled");
}
