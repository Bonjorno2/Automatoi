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

/** Lines a source occupies when it is joined by a newline ahead of another. */
export function lineCount(source: string): number {
  return source === "" ? 0 : source.split(/\r?\n/).length;
}

/**
 * Where a thrown error came from, in the player's own numbering.
 *
 * Milestone 9 put a shared library ahead of every script, which moves the
 * player's lines down by the library's length. Fact 2 of that plan: an error
 * that points at the wrong line is worse than no line number, because the
 * player trusts it.
 *
 * So the offset is subtracted in two stages. What is left after the engine's own
 * header is a line in the library and the source joined together; anything at or
 * below the library's length came from the library, and everything else is the
 * player's, renumbered from 1.
 *
 * Errors the sim raises map too. `api.ts` rethrows them inside the worker at
 * the player's own call site, and its own frames carry module URLs rather than
 * `<anonymous>`, so the first anonymous frame is the right one either way.
 */
export function blameLine(
  err: unknown,
  libraryLines = 0,
): { where: "player" | "library"; line: number } | undefined {
  const reported = reportedLineOf(err instanceof Error ? err.stack : undefined);
  if (reported === undefined) return undefined;
  const combined = reported - SOURCE_LINE_OFFSET;
  if (combined <= 0) return undefined;
  if (combined <= libraryLines) return { where: "library", line: combined };
  // No extra term for the newline that joins them: a library of L lines occupies
  // lines 1..L of the pair and the player's first line is L+1, so the shift is
  // exactly L. The first version subtracted one more and reported every error a
  // line early, which the "same line whatever length" test caught.
  return { where: "player", line: combined - libraryLines };
}

/**
 * The 1-based line of the player's own source that threw, or undefined.
 *
 * Kept as the no-library case of `blameLine`, which is what every caller before
 * milestone 9 meant.
 */
export function playerLine(err: unknown): number | undefined {
  const blame = blameLine(err);
  return blame?.where === "player" ? blame.line : undefined;
}
