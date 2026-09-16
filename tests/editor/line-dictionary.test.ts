import { INDEX_BITS, LINES, LINE_INDEX, MAX_LINES } from "../../src/editor/line-dictionary.ts";
import { SNIPPETS } from "../../src/editor/snippets.ts";

/**
 * The most dangerous file in the project to edit carelessly.
 *
 * A key stores line *numbers*. Renumbering this list silently corrupts every key
 * ever issued — valid checksum, no error, the player handed code they did not
 * write. Nothing at runtime can catch it, so it is caught here, by the dumbest
 * test imaginable: a literal copy of the list.
 */
describe("the line dictionary", () => {
  it("is exactly this, in exactly this order", () => {
    // Adding lines? APPEND to the end of LINES and to the end of this list.
    // Never insert, never reorder, never delete — a dead line keeps its slot.
    expect([...LINES]).toEqual([
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
      "{",
      "});",
      ");",
      'bot.move("west");',
      "bot.wait(10);",
      "return;",
      "return true;",
      "return false;",
      "break;",
      "continue;",
      "} else {",
      'if (bot.move("east")) {',
      "const pos = bot.pos();",
      "const inv = bot.inventory();",
      "let i = 0;",
      "i++;",
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
      'while (bot.move("west")) {}',
      'bot.deposit("west", "wheat", 10);',
      "if ((bot.inventory().wheat ?? 0) >= 10) {",
      'if (!bot.move("east")) {',
      'while (bot.pos().y > 16) bot.move("north");',
      "while (bot.pos().y !== 17) bot.move(bot.pos().y > 17 ? \"north\" : \"south\");",
      "while (bot.pos().x !== 17) bot.move(bot.pos().x > 17 ? \"west\" : \"east\");",
    ]);
  });

  it("starts with the empty line, so a blank line is a reference like any other", () => {
    expect(LINES[0]).toBe("");
  });

  it("has no duplicates", () => {
    // A duplicate is two slots meaning one line: harmless, but it means the
    // encoder's choice between them is arbitrary and keys stop being stable.
    expect(new Set(LINES).size).toBe(LINES.length);
  });

  it("holds no line with its own indentation", () => {
    // Depth travels beside the reference, not inside it, so that the same
    // statement at two nesting levels is one entry and re-indenting a script
    // does not turn every line into a literal.
    for (const line of LINES) expect(line).toBe(line.trim());
  });

  it("fits the field width it is read with", () => {
    // The check that matters if this list ever grows a lot: INDEX_BITS is fixed
    // forever, so outgrowing it needs a format version rather than a wider field.
    expect(LINES.length).toBeLessThanOrEqual(MAX_LINES);
    expect(INDEX_BITS).toBe(10);
  });

  it("indexes every line it holds", () => {
    LINES.forEach((line, i) => expect(LINE_INDEX.get(line)).toBe(i));
  });

  it("covers the chips the book currently ships", () => {
    // Not a promise — a chip may drift from the dictionary and that only makes a
    // key longer, never wrong. It is asserted because drift should be a decision
    // somebody made, announced by this failing, rather than a slow leak.
    const missing = new Set<string>();
    for (const chip of SNIPPETS) {
      for (const raw of chip.code.split("\n")) {
        const line = raw.trim();
        if (line && !LINE_INDEX.has(line)) missing.add(line);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
