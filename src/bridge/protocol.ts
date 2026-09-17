/**
 * One SharedArrayBuffer per bot. Byte layout:
 *
 *   [0, 32)         control slots, the Int32Array a worker parks on
 *   [32, 4128)      request frame  (worker -> host)
 *   [4128, 20512)   result frame   (host -> worker)
 *   [20512, 24608)  mirror frame   (host -> worker, read lock-free)
 *
 * Every region is a multiple of 4 bytes so the Int32Array view stays aligned.
 */

import type { Command, ResearchName } from "../sim/types";

export const CTRL_SLOTS = 8;
export const CTRL_BYTES = CTRL_SLOTS * 4;
export const REQ_BYTES = 4096;
/** A scan of radius 5 is 121 tiles of JSON; this leaves room to spare. */
export const RES_BYTES = 16384;
export const MIRROR_BYTES = 4096;

export const REQ_OFFSET = CTRL_BYTES;
export const RES_OFFSET = REQ_OFFSET + REQ_BYTES;
export const MIRROR_OFFSET = RES_OFFSET + RES_BYTES;
export const CHANNEL_BYTES = MIRROR_OFFSET + MIRROR_BYTES;

/** Control slot indices. */
export const STATE = 0;
export const REQ_LEN = 1;
export const RES_LEN = 2;
export const RES_OK = 3;
export const MIRROR_SEQ = 4;
export const MIRROR_LEN = 5;

/** Values the STATE slot takes. */
export const IDLE = 0;
export const REQUEST = 1;
export const RESULT = 2;

/** What a worker can ask the host for. */
export type HostRequest =
  | { kind: "command"; command: Command }
  | { kind: "colony"; call: "bots" | "time" }
  | { kind: "research"; name: ResearchName }
  /**
   * Its own member rather than a shape change to `research` above, which would
   * have rippled through every bridge test for no gain. Reading research is a
   * free read like `colony.time()`: it answers at once and costs no ticks.
   */
  | { kind: "research-status" }
  /**
   * Start another bot at a fabricator.
   *
   * The source travels as text because a function cannot cross a worker
   * boundary — see `ColonyApi.fabricator.spawn`, where the consequence for the
   * player is spelled out.
   */
  | { kind: "spawn"; source: string };

/** What `colony.research.status()` answers with. */
export interface ResearchStatus {
  unlocked: ResearchName[];
  queue: ResearchName[];
  /** Items consumed toward the head of the queue. */
  progress: number;
  /** What the head of the queue costs, so a fraction needs no config import. */
  cost: number;
}

/** What the host publishes for a bot to read without asking. */
export interface MirrorState {
  time: number;
  pos: { x: number; y: number };
  inventory: Record<string, number | undefined>;
  modules: string[];
  busy: boolean;
}

export function createChannel(): SharedArrayBuffer {
  return new SharedArrayBuffer(CHANNEL_BYTES);
}

export function ctrlOf(sab: SharedArrayBuffer): Int32Array {
  return new Int32Array(sab, 0, CTRL_SLOTS);
}
export function reqOf(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, REQ_OFFSET, REQ_BYTES);
}
export function resOf(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, RES_OFFSET, RES_BYTES);
}
export function mirrorOf(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, MIRROR_OFFSET, MIRROR_BYTES);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serialise into a frame region. Returns the byte length written. */
export function writeFrame(bytes: Uint8Array, value: unknown): number {
  const encoded = encodeFrame(value, bytes.length);
  bytes.set(encoded);
  return encoded.length;
}

/**
 * The half of `writeFrame` that does not touch shared memory.
 *
 * Split out so a writer holding a lock can do the slow, throwing part — the
 * stringify, the encode, the size check — *before* it takes the lock, and hold
 * it only for the copy. `publishMirror` is the caller that needs this; see the
 * comment there for what it costs when the work is done the other way round.
 */
export function encodeFrame(value: unknown, room: number): Uint8Array {
  const encoded = encoder.encode(JSON.stringify(value ?? null));
  if (encoded.length > room) {
    throw new Error(`frame too large: ${encoded.length} > ${room} bytes`);
  }
  return encoded;
}

/**
 * Read a frame back. The bytes are copied out of shared memory before being
 * decoded: Node tolerates decoding a shared view, but browsers have not always,
 * and milestones 3 and 4 run this code in one.
 */
export function readFrame(bytes: Uint8Array, len: number): unknown {
  return JSON.parse(decoder.decode(new Uint8Array(bytes.subarray(0, len))));
}
