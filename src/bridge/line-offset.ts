/**
 * Mapping a thrown error back to the line the player is looking at.
 *
 * Player scripts are compiled with `new Function("bot", "colony", '"use
 * strict";\n' + source)`. The engine synthesises a header around that body —
 * `function anonymous(bot,colony` and `) {` — and the `"use strict"` prologue
 * adds one more. So a stack trace's line number is not the player's, and the
 * difference is engine-defined rather than specified.
 *
 * V8 reports source line 1 as line 4, an offset of 3, in both Node and Chrome.
 * Rather than trust that everywhere, the offset is measured once at load by
 * throwing from a known line and reading the result back.
 */

const FRAME = /<anonymous>:(\d+):\d+/;

/** V8's answer, used when a stack cannot be parsed at all. */
const FALLBACK_OFFSET = 3;

function reportedLineOf(stack: string | undefined): number | undefined {
  const line = stack ? FRAME.exec(stack)?.[1] : undefined;
  return line === undefined ? undefined : Number(line);
}

function measureOffset(): number {
  const probe = new Function(`"use strict";\nthrow new Error("probe");`);
  try {
    probe();
  } catch (err) {
    // The throw is on source line 1, so whatever line is reported *is* the offset + 1.
    const reported = reportedLineOf((err as Error).stack);
    if (reported !== undefined && reported > 0) return reported - 1;
  }
  return FALLBACK_OFFSET;
}

export const SOURCE_LINE_OFFSET = measureOffset();

/**
 * The 1-based line of the player's own source that threw, or undefined when the
 * error carries no usable frame.
 *
 * Errors the sim raises map too. `api.ts` rethrows them inside the worker at
 * the player's own call site, and its own frames carry module URLs rather than
 * `<anonymous>`, so the first anonymous frame is the player's line either way.
 */
export function playerLine(err: unknown): number | undefined {
  const reported = reportedLineOf(err instanceof Error ? err.stack : undefined);
  if (reported === undefined) return undefined;
  const line = reported - SOURCE_LINE_OFFSET;
  return line > 0 ? line : undefined;
}
