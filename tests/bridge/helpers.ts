import {
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  ctrlOf, reqOf, resOf, readFrame, writeFrame,
} from "../../src/bridge/protocol.ts";
import type { HostRequest } from "../../src/bridge/protocol.ts";

/** Stands in for a worker: posts a request into a channel, without blocking. */
export function postRequest(sab: SharedArrayBuffer, request: HostRequest): void {
  const ctrl = ctrlOf(sab);
  Atomics.store(ctrl, REQ_LEN, writeFrame(reqOf(sab), request));
  Atomics.store(ctrl, STATE, REQUEST);
}

/** Reads a resolved result and returns the channel to idle, as a worker would. */
export function takeReply(sab: SharedArrayBuffer): { ok: boolean; value: unknown } | null {
  const ctrl = ctrlOf(sab);
  if (Atomics.load(ctrl, STATE) !== RESULT) return null;
  const ok = Atomics.load(ctrl, RES_OK) === 1;
  const value = readFrame(resOf(sab), Atomics.load(ctrl, RES_LEN));
  Atomics.store(ctrl, STATE, IDLE);
  return { ok, value };
}
