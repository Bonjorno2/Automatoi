/**
 * What a new player sees, exactly as the design doc's "first ten minutes"
 * promises.
 *
 * Its own module, with no imports at all, for the same reason milestone 2's
 * worker files have an import rule: `editor.ts` pulls in Monaco, and anything
 * that reaches Monaco cannot be loaded under Vitest. A one-line constant should
 * not require a bundler to read.
 */
export const OPENING_SCRIPT = `bot.harvester.harvest();
bot.move("east");
`;
