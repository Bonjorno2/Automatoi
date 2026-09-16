import { LADDERS, SNIPPETS } from "../../src/editor/snippets.ts";
import { PRIMITIVE_LABEL } from "../../src/editor/source.ts";
import type { Primitive } from "../../src/editor/source.ts";
import { RESEARCH_COST } from "../../src/sim/config.ts";
import { ALPHABET, checksum } from "../../src/editor/bits.ts";
import {
  FACTS,
  decodeKey,
  encodeKey,
  factsFrom,
  keyCost,
  partition,
} from "../../src/editor/progress-key.ts";
import type { Fact, KeyContents } from "../../src/editor/progress-key.ts";

const key = (facts: Iterable<Fact> = [], buffers: KeyContents["buffers"] = []): KeyContents =>
  ({ facts: new Set(facts), buffers });

const plain = (k: string): string => k.replace(/-/g, "");

/**
 * The save, as a code you can paste into a text file.
 *
 * The first block is the important one and it is deliberately dumb: a literal
 * copy of the fact list. A compact key is a bitfield, so every bit's meaning is
 * its *position*, and inserting a fact in the middle silently re-points every
 * key ever issued at somebody else's progress. Nothing at runtime can detect
 * that. This test is the only thing standing between a player and it.
 */
describe("the fact list", () => {
  it("is exactly this, in exactly this order", () => {
    // Adding a fact? Append it to the END of this list and the end of FACTS.
    // Never insert, never reorder, never delete — a retired fact keeps its slot.
    expect([...FACTS]).toEqual([
      "p:while", "p:for", "p:if", "p:function", "p:move", "p:wait", "p:pos",
      "p:inventory", "p:log", "p:deposit", "p:withdraw", "p:harvest", "p:plant",
      "p:scan", "p:send", "p:receive", "p:place", "p:queue", "p:status", "p:spawn",
      "r:planter", "r:scanner", "r:crate", "r:mill", "r:oven", "r:conveyor",
      "r:chassis", "r:radio", "r:builder", "r:library", "r:fabricator",
      "c:field-loop/0", "c:field-loop/1", "c:field-loop/2",
      "c:knowing/0", "c:knowing/1",
      "c:research/0", "c:research/1",
      "c:hauling/0", "c:growing/0", "c:seeing/0",
      "c:building/0", "c:building/1", "c:talking/0",
      "c:getting-started/0", "c:getting-started/1", "c:getting-started/2",
      "c:getting-started/3", "c:getting-started/4", "c:getting-started/5",
      "c:getting-started/6", "c:getting-started/7",
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(FACTS).size).toBe(FACTS.length);
  });

  it("covers every primitive the book can name", () => {
    for (const p of Object.keys(PRIMITIVE_LABEL) as Primitive[]) expect(FACTS).toContain(`p:${p}`);
  });

  it("covers every research the sim prices", () => {
    for (const name of Object.keys(RESEARCH_COST)) expect(FACTS).toContain(`r:${name}`);
  });

  it("covers every rung of every ladder", () => {
    for (const ladder of LADDERS) {
      ladder.rungs.forEach((_, i) => expect(FACTS).toContain(`c:${ladder.id}/${i}`));
    }
  });
});

describe("a progress key", () => {
  const facts: Fact[] = ["p:while", "p:move", "r:scanner", "c:field-loop/0"];

  it("carries progress alone in a handful of characters", () => {
    expect(plain(encodeKey(key(facts))).length).toBeLessThanOrEqual(14);
  });

  it("round-trips", () => {
    const back = decodeKey(encodeKey(key(facts)));
    expect(back.error).toBeUndefined();
    expect([...back.facts].sort()).toEqual([...facts].sort());
  });

  it("round-trips a player who has learned nothing", () => {
    const back = decodeKey(encodeKey(key()));
    expect(back.error).toBeUndefined();
    expect(back.facts.size).toBe(0);
    expect(back.buffers).toEqual([]);
  });

  it("round-trips a player who has learned everything", () => {
    const back = decodeKey(encodeKey(key(FACTS)));
    expect(back.error).toBeUndefined();
    expect(back.facts.size).toBe(FACTS.length);
  });

  it("gives different progress a different key", () => {
    expect(encodeKey(key(["p:while"]))).not.toBe(encodeKey(key(["p:for"])));
  });

  it("does not care about case, spaces or the dashes it added", () => {
    const mangled = ` ${plain(encodeKey(key(facts))).toLowerCase()}  `;
    expect([...decodeKey(mangled).facts].sort()).toEqual([...facts].sort());
  });

  it("forgives the characters people misread", () => {
    // A key copied off a screenshot turns 1 into I and 0 into O.
    const muddled = plain(encodeKey(key(facts))).replace(/1/g, "I").replace(/0/g, "O");
    expect(decodeKey(muddled).error).toBeUndefined();
  });

  it("refuses a key with a typo rather than obeying it", () => {
    // The failure that matters. Without the checksum a mistyped character is a
    // valid key for somebody else's progress, and the player is silently handed
    // a different game.
    const chars = [...plain(encodeKey(key(facts, [{ botId: 1, source: "bot.move(\"east\");" }])))];
    let caught = 0;
    for (let i = 0; i < chars.length; i++) {
      const wrong = [...chars];
      wrong[i] = wrong[i] === "Z" ? "Y" : "Z";
      if (decodeKey(wrong.join("")).error !== undefined) caught++;
    }
    expect(caught).toBe(chars.length);
  });

  it("names the character it could not read", () => {
    expect(decodeKey("1ABC-DE!G").error).toContain("!");
  });

  it("says something useful about an empty key", () => {
    expect(decodeKey("   ").error).toBe("no key entered");
  });

  it("refuses a key from a newer build instead of misreading it", () => {
    // Version 31, checksummed properly — what a far-future key looks like today.
    const body = ALPHABET[31]! + "0".repeat(12);
    expect(decodeKey(body + checksum(body)).error).toContain("newer version");
  });

  it("still reads a version 1 key, which carried no scripts", () => {
    // Not a courtesy: this is the proof the version marker does its job. A v1
    // key is the same bit stream, stopping after the facts.
    let bits = ALPHABET.indexOf("1").toString(2).padStart(5, "0");
    for (const fact of FACTS) bits += facts.includes(fact) ? "1" : "0";
    while (bits.length % 5) bits += "0";
    let body = "";
    for (let i = 0; i < bits.length; i += 5) body += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];

    const back = decodeKey(body + checksum(body));
    expect(back.error).toBeUndefined();
    expect([...back.facts].sort()).toEqual([...facts].sort());
    expect(back.buffers).toEqual([]);
  });

  it("reports a truncated key rather than throwing", () => {
    const full = plain(encodeKey(key(facts, [{ botId: 1, source: SNIPPETS[2]!.code }])));
    // Lop the end off and re-checksum, so it is damage rather than a typo.
    const body = full.slice(0, 10);
    expect(decodeKey(body + checksum(body)).error).toContain("missing its end");
  });
});

describe("the scripts a key carries", () => {
  const chip = SNIPPETS[2]!.code;
  const planner = `function expand(n) {\n  for (let i = 0; i < n; i++) {\n    stamp(blueprint, spotFor(i));\n  }\n}`;

  it("round-trips a script made of the book", () => {
    const back = decodeKey(encodeKey(key([], [{ botId: 1, source: chip }])));
    expect(back.error).toBeUndefined();
    expect(back.buffers).toEqual([{ botId: 1, source: chip }]);
  });

  it("round-trips a script the player wrote themselves", () => {
    const back = decodeKey(encodeKey(key([], [{ botId: 3, source: planner }])));
    expect(back.buffers).toEqual([{ botId: 3, source: planner }]);
  });

  it("round-trips the shared library, which has no bot", () => {
    const back = decodeKey(encodeKey(key([], [{ botId: null, source: "function stamp(layout) {\n}" }])));
    expect(back.buffers[0]!.botId).toBeNull();
  });

  it("round-trips several buffers at once, keeping them apart", () => {
    const buffers = [
      { botId: 1, source: chip },
      { botId: 2, source: planner },
      { botId: null, source: "// shared" },
    ];
    expect(decodeKey(encodeKey(key([], buffers))).buffers).toEqual(buffers);
  });

  it("keeps blank lines and indentation", () => {
    const spaced = 'while (true) {\n\n  bot.move("east");\n\n}';
    expect(decodeKey(encodeKey(key([], [{ botId: 1, source: spaced }]))).buffers[0]!.source)
      .toBe(spaced);
  });

  it("round-trips text that is not ASCII", () => {
    // The chip that logs an em dash proved this was worth a test.
    const unicode = 'bot.log("full — nowhere to put it 🌾");';
    expect(decodeKey(encodeKey(key([], [{ botId: 1, source: unicode }]))).buffers[0]!.source)
      .toBe(unicode);
  });

  it("round-trips an empty buffer", () => {
    expect(decodeKey(encodeKey(key([], [{ botId: 1, source: "" }]))).buffers)
      .toEqual([{ botId: 1, source: "" }]);
  });

  it("costs far less for code the game already knows", () => {
    // The whole reason the line dictionary exists, asserted as a ratio rather
    // than as a number so that growing the dictionary does not fail this.
    const fromBook = plain(encodeKey(key([], [{ botId: 1, source: chip }]))).length;
    const ownWork = plain(encodeKey(key([], [{ botId: 1, source: planner }]))).length;
    expect(fromBook).toBeLessThan(ownWork / 3);
  });

  it("says how it spent its characters", () => {
    const cost = keyCost(key([], [{ botId: 1, source: chip }]));
    expect(cost.ownLines).toBe(0);
    expect(cost.fromBook).toBe(chip.split("\n").length);
    expect(cost.characters).toBeGreaterThan(0);

    const mixed = keyCost(key([], [{ botId: 1, source: `${chip}\nconst mine = 1;` }]));
    expect(mixed.ownLines).toBe(1);
  });
});

describe("what a key is made of", () => {
  it("gathers the three things the game knows", () => {
    const facts = factsFrom({
      vocabulary: ["while", "move"],
      research: ["scanner"],
      offered: ["Harvest in a loop"],
    });
    expect([...facts].sort()).toEqual(["c:field-loop/0", "p:move", "p:while", "r:scanner"]);
  });

  it("ignores anything it has no slot for", () => {
    // A chip retitled, a research added to the sim and not yet to FACTS. Neither
    // is worth throwing over: the key carries what it can name.
    const facts = factsFrom({
      vocabulary: ["telekinesis"],
      research: ["jetpack"],
      offered: ["A chip that does not exist"],
    });
    expect([...facts]).toEqual([]);
  });

  it("splits back into the three things that consume them", () => {
    const { vocabulary, research, offered } = partition(
      new Set<Fact>(["p:while", "r:scanner", "c:field-loop/0"]),
    );
    expect(vocabulary).toEqual(["while"]);
    expect(research).toEqual(["scanner"]);
    expect(offered).toEqual(["Harvest in a loop"]);
  });

  it("survives a whole trip through the encoding", () => {
    const before = {
      vocabulary: ["while", "if", "harvest", "move", "inventory"],
      research: ["scanner", "crate", "builder"],
      offered: ["Harvest in a loop", "Stay on the field"],
    };
    const after = partition(decodeKey(encodeKey(key(factsFrom(before)))).facts);
    expect(after.vocabulary.sort()).toEqual([...before.vocabulary].sort());
    expect(after.research.sort()).toEqual([...before.research].sort());
    expect(after.offered.sort()).toEqual([...before.offered].sort());
  });
});
