/**
 * Every line a progress key can name by number instead of spelling out.
 *
 * A key does not contain the player's code. It contains **line numbers** — the
 * text lives here, in the game, and the key points at it. That is what turns a
 * 276-character chip into an 18-character reference, and it is why this file is
 * the most dangerous one in the project to edit carelessly.
 *
 * ## The promise, stated once and kept forever
 *
 * **This list is append-only. Nothing is ever removed, and nothing is ever
 * reordered.** A line whose chip was rewritten or deleted keeps its slot as a
 * tombstone, forever, doing nothing.
 *
 * Renumbering silently corrupts every key ever issued. A player pastes the key
 * they saved and is handed code they did not write — no error, valid checksum,
 * nothing on screen to say anything went wrong. It is the worst failure this
 * codebase can produce, because the player will assume they did something wrong
 * and will not report it.
 *
 * `tests/editor/line-dictionary.test.ts` holds a literal copy of this list, so
 * reordering it fails the build rather than the player.
 *
 * ## Why it is written out rather than derived from the chips
 *
 * The obvious implementation is `SNIPPETS.flatMap(s => s.code.split("\n"))`, and
 * it is a trap. Chip prose gets edited casually — milestone 10 rewrote a blurb
 * and a code line in passing, twice — and under a derived dictionary each of
 * those edits would have renumbered everything after it. Written out by hand,
 * the chips stay freely editable and only this file is frozen.
 *
 * A consequence to accept rather than fix: a chip can drift from the dictionary,
 * so an edited chip's lines become literals in a key instead of references. That
 * makes a key slightly longer. It never makes one wrong, which is the trade.
 *
 * ## Adding lines
 *
 * Append to the end, add the same lines to the test's literal copy, and never
 * touch what is above. `INDEX_BITS` is fixed at 10 — room for 1024 entries —
 * precisely so that growing this list does not change the width of a reference
 * and break every key in the world. Reaching 1024 needs a format version, not a
 * wider field.
 */

/**
 * Bits a reference costs. **Fixed, not derived from the list's length.**
 *
 * Deriving it was the first version and it is the same bug one level up: the
 * list growing from 40 entries to 65 would widen every reference from 6 bits to
 * 7, and every key issued before that would decode as noise.
 */
export const INDEX_BITS = 10;
export const MAX_LINES = 1 << INDEX_BITS;

/**
 * Slot 0 is the empty string, so a blank line in a player's script is a
 * reference like any other rather than a case in the encoder.
 */
export const LINES: readonly string[] = [
  "",
  "while (true) {",
  "bot.harvester.harvest();",
  'bot.move("east");',
  "}",
  "let goingEast = true;",
  'if (!bot.move(goingEast ? "east" : "west")) {',
  "goingEast = !goingEast;",
  "while ((bot.inventory().wheat ?? 0) < 10) {",
  'bot.move("south");',
  'bot.log("full — somewhere to put this would help");',
  "const here = bot.pos();",
  'bot.log("at " + here.x + "," + here.y);',
  'bot.log("carrying " + (bot.inventory().wheat ?? 0) + " wheat");',
  'bot.log("full at " + bot.pos().x + "," + bot.pos().y);',
  'colony.research.queue("planter");',
  'colony.research.queue("conveyor");',
  'while (!colony.research.status().unlocked.includes("conveyor")) {',
  "bot.wait(20);",
  'bot.log("belts unlocked");',
  "const carried = bot.inventory().wheat ?? 0;",
  "if (carried > 0) {",
  'bot.deposit("north", "wheat", carried);',
  "if (bot.harvester.harvest()) {",
  'bot.planter.plant("wheat");',
  "for (const tile of bot.scanner.scan(2)) {",
  "if (tile.crop) {",
  'bot.log("crop at " + tile.x + "," + tile.y);',
  "for (let i = 0; i < 5; i++) {",
  'bot.builder.place("conveyor", "north");',
  'bot.move("north");',
  "function stamp(layout) {",
  "for (const step of layout) {",
  "bot.builder.place(step.machine, step.dir, step.facing);",
  "bot.move(step.dir);",
  "// Then, from any bot:",
  "// stamp([",
  '//   { machine: "conveyor", dir: "east", facing: "east" },',
  "// ]);",
  'const order = bot.radio.receive("haul");',
  'bot.log("order from bot " + order.from);',
  // --- Lines beyond the book -------------------------------------------
  // The ones a player writes constantly and the chips happen not to contain.
  // Every one of these is a line that would otherwise be spelled out in full in
  // somebody's key, and they cost nothing to keep here.
  "{",
  "});",
  ");",
  "bot.move(\"west\");",
  "bot.wait(10);",
  "return;",
  "return true;",
  "return false;",
  "break;",
  "continue;",
  "} else {",
  "if (bot.move(\"east\")) {",
  "const pos = bot.pos();",
  "const inv = bot.inventory();",
  "let i = 0;",
  "i++;",
  // --- the shared library's opening comment ------------------------------
  // A buffer the player has not touched is left out of a key entirely, so these
  // are here for the player who edited the library and kept the explanation —
  // which, before this, cost them six hundred characters in every key.
  "// Everything here is in scope in every bot's script.",
  "//",
  "// This is where a function you want more than one bot to call lives — the",
  "// design calls it the shared library, and it is what `import` would have been.",
  "// function stamp(layout) {",
  "//   for (const step of layout) {",
  "//     bot.builder.place(step.machine, step.dir, step.facing);",
  "//     bot.move(step.dir);",
  "//   }",
  "// }",
  // --- the opening ladder ------------------------------------------------
  // Appended, never inserted. Every line above keeps the number it had.
  'while (bot.move("west")) {}',
  'bot.deposit("west", "wheat", 10);',
  "if ((bot.inventory().wheat ?? 0) >= 10) {",
  'if (!bot.move("east")) {',
  'while (bot.pos().y > 16) bot.move("north");',
  "while (bot.pos().y !== 17) bot.move(bot.pos().y > 17 ? \"north\" : \"south\");",
  "while (bot.pos().x !== 17) bot.move(bot.pos().x > 17 ? \"west\" : \"east\");",
];

/** Where each line sits, for the encoder. Built once; the list never changes. */
export const LINE_INDEX: ReadonlyMap<string, number> = new Map(
  LINES.map((line, i) => [line, i]),
);
