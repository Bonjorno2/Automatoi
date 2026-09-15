import { runScript } from "./run-script.ts";
import type { WorkerInit } from "./spawn.ts";

/**
 * Browser entry point. A web worker has no `workerData`, so its init arrives as
 * the first message. Messages posted before this listener attaches are queued
 * by the platform, so there is no race with the host's `postMessage`.
 *
 * `self` is typed as a Window because tsconfig loads the DOM lib; the WebWorker
 * lib that would type it correctly conflicts with DOM and cannot be loaded
 * alongside it. The cast is the narrowest honest workaround.
 */
const ctx = self as unknown as {
  addEventListener(type: "message", fn: (e: { data: unknown }) => void, opts?: { once: boolean }): void;
  postMessage(message: unknown): void;
};

ctx.addEventListener("message", (e) => {
  runScript(e.data as WorkerInit, (m) => ctx.postMessage(m));
}, { once: true });
