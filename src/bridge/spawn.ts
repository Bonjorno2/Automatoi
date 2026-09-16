/**
 * The worker seam.
 *
 * Node and the browser disagree about workers in three ways, all of which have
 * to be hidden from the host: construction (`workerData` vs an init
 * `postMessage`), subscription (`.on("message")` vs `addEventListener`), and
 * termination (returns a promise vs returns void).
 *
 * This file is types only, so it is safe to import from anywhere — including
 * files inside the worker's own import graph.
 */

/** Everything a freshly spawned worker needs to start running a script. */
export interface WorkerInit {
  sab: SharedArrayBuffer;
  botId: number;
  source: string;
  /**
   * The colony's shared library, compiled into scope ahead of `source`.
   *
   * Empty until the player researches it, which is what keeps a beginner's
   * error lines untouched by a feature they have not bought.
   */
  library: string;
}

export interface WorkerHandle {
  onMessage(fn: (message: unknown) => void): void;
  onError(fn: (message: string) => void): void;
  terminate(): Promise<void>;
}

export type SpawnWorker = (init: WorkerInit) => WorkerHandle;
