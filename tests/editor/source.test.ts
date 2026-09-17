import { OPENING_SCRIPT } from "../../src/editor/opening-script.ts";
import { PRIMITIVE_LABEL, hasLoop, mentions, primitivesIn } from "../../src/editor/source.ts";
import type { Primitive } from "../../src/editor/source.ts";

/**
 * Reading a player's script for what it says.
 *
 * Every test about prose is here for one reason: the failure mode of getting
 * this wrong is silence. A rung that never unlocks and a suggestion that never
 * appears both look exactly like a feature nobody built.
 */
describe("hasLoop", () => {
  it("sees the loops a player writes", () => {
    expect(hasLoop("while (true) {}")).toBe(true);
    expect(hasLoop("for (let i = 0; i < 5; i++) {}")).toBe(true);
    expect(hasLoop("for (const t of bot.scanner.scan(2)) {}")).toBe(true);
    expect(hasLoop("do { bot.move('east'); } while (true);")).toBe(true);
  });

  it("is not fooled by prose", () => {
    expect(hasLoop("bot.move('east'); // go east for one tile")).toBe(false);
    expect(hasLoop("/* harvest while there is wheat */\nbot.harvester.harvest();")).toBe(false);
    expect(hasLoop('bot.log("waiting for the mill");')).toBe(false);
    expect(hasLoop("bot.log('do not overfill');")).toBe(false);
  });

  it("is not fooled by a comment marker inside a string, or the reverse", () => {
    expect(hasLoop('bot.log("// for");')).toBe(false);
    expect(hasLoop("// a quote ' and then\nwhile (true) {}")).toBe(true);
  });

  it("does not mistake a longer word for a loop", () => {
    expect(hasLoop("const format = 1; const doing = 2; const forward = 3;")).toBe(false);
  });

  it("says the opening script does not loop", () => {
    // The fact the loop rule rests on.
    expect(hasLoop(OPENING_SCRIPT)).toBe(false);
  });
});

describe("mentions", () => {
  it("sees a real call and not a comment", () => {
    expect(mentions("bot.scanner.scan(2);", "bot.scanner")).toBe(true);
    expect(mentions("// one day, bot.scanner", "bot.scanner")).toBe(false);
    expect(mentions('bot.log("bot.scanner");', "bot.scanner")).toBe(false);
  });
});

describe("primitivesIn", () => {
  it("reads the opening buffer as nothing at all", () => {
    // Since the opening ladder took over, the buffer opens empty but for a line
    // of orientation. Shipping `harvest(); move();` meant the game had already
    // done the only two things its first two steps were about to teach.
    expect([...primitivesIn(OPENING_SCRIPT)]).toEqual([]);
  });

  it("reads the loop the game suggests", () => {
    const loop = 'while (true) {\n  bot.harvester.harvest();\n  bot.move("east");\n}';
    expect([...primitivesIn(loop)].sort()).toEqual(["harvest", "move", "while"]);
  });

  it("counts the optional call the .d.ts asks for", () => {
    // `bot.scanner?.scan(2)` is the honest call the shipped types want, and a
    // player who writes it has plainly used the scanner.
    expect(primitivesIn("bot.scanner?.scan(2);").has("scan")).toBe(true);
    expect(primitivesIn("bot.scanner.scan(2);").has("scan")).toBe(true);
  });

  it("counts an arrow as a function", () => {
    expect(primitivesIn("colony.fabricator.spawn(() => {});").has("function")).toBe(true);
    expect(primitivesIn("function stamp(l) {}").has("function")).toBe(true);
  });

  it("finds nothing in a file of comments", () => {
    const prose = `// while you are here, use bot.scanner and bot.deposit
/* and for good measure, colony.research.queue */`;
    expect([...primitivesIn(prose)]).toEqual([]);
  });

  it("tells the two radio verbs apart", () => {
    expect([...primitivesIn('bot.radio.send("haul", 1);')]).toEqual(["send"]);
    expect([...primitivesIn('bot.radio.receive("haul");')]).toEqual(["receive"]);
  });

  it("has a label for every primitive, because the book prints them", () => {
    const every = Object.keys(PRIMITIVE_LABEL) as Primitive[];
    for (const p of every) expect(PRIMITIVE_LABEL[p]).toBeTruthy();
    // And the set the book can name is the set the reader can find.
    const found = primitivesIn(
      `while for if function
       bot.move() bot.wait() bot.pos() bot.inventory() bot.log()
       bot.deposit() bot.withdraw() bot.harvester.harvest() bot.planter.plant()
       bot.scanner.scan() bot.radio.send() bot.radio.receive() bot.builder.place()
       colony.research.queue() colony.research.status() colony.fabricator.spawn()`,
    );
    expect([...found].sort()).toEqual(every.sort());
  });
});
