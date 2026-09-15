import { makeApi } from "./api.ts";
import type { WorkerInit } from "./spawn.ts";

/**
 * The worker side of running a player script, shared by both entry points.
 *
 * This file is in the worker's import graph, so milestone 2's import rule
 * applies: explicit `.ts` extensions, and nothing from `src/sim/` at runtime.
 */
export function runScript(init: WorkerInit, post: (message: unknown) => void): void {
  const { bot, colony } = makeApi(init.sab, init.botId, post);
  try {
    // Player scripts are ordinary JavaScript with two globals in scope.
    const fn = new Function("bot", "colony", `"use strict";\n${init.source}`);
    fn(bot, colony);
    post({ kind: "done" });
  } catch (err) {
    post({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
