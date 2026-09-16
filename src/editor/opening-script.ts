/**
 * What a new player sees.
 *
 * It used to be the design doc's two lines — `harvest(); move("east");` — and
 * milestone 10's first playtest is why it is not any more. Those two lines
 * *are* the first two steps of the opening, so shipping them pre-written meant
 * the game had already done the only two things it was about to teach, and the
 * codebook's opening ladder had nothing left to hand over.
 *
 * An empty buffer with one line of orientation instead. The codebook offers
 * "Move" from the first frame, so the player's first act is to take a line and
 * press Run rather than to read someone else's program.
 *
 * Its own module, with no imports at all, for the same reason milestone 2's
 * worker files have an import rule: `editor.ts` pulls in Monaco, and anything
 * that reaches Monaco cannot be loaded under Vitest. A one-line constant should
 * not require a bundler to read.
 */
export const OPENING_SCRIPT = `// Nothing here yet. The codebook, bottom right, has your first line.
`;
