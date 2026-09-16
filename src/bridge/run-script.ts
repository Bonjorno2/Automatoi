import { makeApi } from "./api.ts";
import { blameLine, lineCount } from "./line-offset.ts";
import type { WorkerInit } from "./spawn.ts";

/**
 * The worker side of running a player script, shared by both entry points.
 *
 * This file is in the worker's import graph, so milestone 2's import rule
 * applies: explicit `.ts` extensions, and nothing from `src/sim/` at runtime.
 */
export function runScript(init: WorkerInit, post: (message: unknown) => void): void {
  const { bot, colony } = makeApi(init.sab, init.botId, post);
  const library = init.library ?? "";
  const libraryLines = lineCount(library);

  /**
   * The library and the script are one compilation, not two.
   *
   * Decision 2 of the milestone 9 plan: a prelude rather than `import`. Compiling
   * them together is what puts a library function in scope without a module
   * graph — and it is also why `blameLine` has to exist, because from here on a
   * stack line is a line in the *pair* and the player only ever wrote half of it.
   */
  const combined = library === "" ? init.source : `${library}\n${init.source}`;

  let fn: (b: unknown, c: unknown) => void;
  try {
    fn = new Function("bot", "colony", `"use strict";\n${combined}`) as typeof fn;
  } catch (err) {
    // A library that will not parse takes every script down with it, so it says
    // which of the two buffers to go and look at. Without this the message is a
    // syntax error at a line the player did not write and cannot find.
    const message = err instanceof Error ? err.message : String(err);
    post({
      kind: "error",
      message: libraryLines > 0 ? `library will not compile: ${message}` : message,
    });
    return;
  }

  try {
    fn(bot, colony);
    post({ kind: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blame = blameLine(err, libraryLines);
    post({
      kind: "error",
      // A library line is named in the message rather than reported as `line`:
      // `line` is what the editor highlights, and it is showing the player's
      // script. Highlighting line 2 of their bot because line 2 of the library
      // threw would point at innocent code.
      message: blame?.where === "library" ? `${message} (library line ${blame.line})` : message,
      line: blame?.where === "player" ? blame.line : undefined,
    });
  }
}
