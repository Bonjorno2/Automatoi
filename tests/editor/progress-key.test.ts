import { LADDERS } from "../../src/editor/snippets.ts";
import { PRIMITIVE_LABEL } from "../../src/editor/source.ts";
import type { Primitive } from "../../src/editor/source.ts";
import { RESEARCH_COST } from "../../src/sim/config.ts";
import {
  FACTS,
  decodeKey,
  encodeKey,
  factsFrom,
  partition,
} from "../../src/editor/progress-key.ts";
import type { Fact } from "../../src/editor/progress-key.ts";

/**
 * The save, as a code you can read out loud.
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
    ]);
  });

  it("has no duplicates", () => {
    expect(new Set(FACTS).size).toBe(FACTS.length);
  });

  it("covers every primitive the book can name", () => {
    const every = Object.keys(PRIMITIVE_LABEL) as Primitive[];
    for (const p of every) expect(FACTS).toContain(`p:${p}`);
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
  const someFacts = new Set<Fact>(["p:while", "p:move", "r:scanner", "c:field-loop/0"]);

  it("is short enough to write on paper", () => {
    // The whole reason this is a key and not a save file.
    expect(encodeKey(someFacts).replace(/-/g, "").length).toBeLessThanOrEqual(12);
  });

  it("round-trips", () => {
    const back = decodeKey(encodeKey(someFacts));
    expect(back.error).toBeUndefined();
    expect([...back.facts].sort()).toEqual([...someFacts].sort());
  });

  it("round-trips a player who has learned nothing", () => {
    const back = decodeKey(encodeKey(new Set()));
    expect(back.error).toBeUndefined();
    expect(back.facts.size).toBe(0);
  });

  it("round-trips a player who has learned everything", () => {
    const all = new Set<Fact>(FACTS);
    const back = decodeKey(encodeKey(all));
    expect(back.error).toBeUndefined();
    expect(back.facts.size).toBe(FACTS.length);
  });

  it("gives different progress a different key", () => {
    expect(encodeKey(new Set<Fact>(["p:while"]))).not.toBe(encodeKey(new Set<Fact>(["p:for"])));
  });

  it("does not care about case, spaces or the dashes it added", () => {
    const key = encodeKey(someFacts);
    const mangled = ` ${key.replace(/-/g, "").toLowerCase()}  `;
    expect([...decodeKey(mangled).facts].sort()).toEqual([...someFacts].sort());
  });

  it("forgives the characters people misread", () => {
    // Crockford's point: a key read down a phone or off a screenshot turns 1
    // into I and 0 into O, and the reader should simply cope.
    const key = encodeKey(someFacts).replace(/1/g, "I").replace(/0/g, "O");
    expect(decodeKey(key).error).toBeUndefined();
  });

  it("refuses a key with a typo rather than obeying it", () => {
    // The failure that matters. Without the checksum a mistyped character is a
    // valid key for somebody else's progress, and the player is silently handed
    // a different game.
    const key = encodeKey(someFacts);
    const chars = [...key.replace(/-/g, "")];
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

  it("refuses a key from another version instead of misreading it", () => {
    // Built by hand at version 2, checksum and all, which is what a key issued
    // by a future build would look like to today's reader.
    const body = "2" + "0".repeat(9);
    let sum = 0;
    for (const c of body) sum = (sum * 31 + "0123456789ABCDEFGHJKMNPQRSTVWXYZ".indexOf(c)) % 32;
    const future = body + "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[sum];
    expect(decodeKey(future).error).toContain("newer version");
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
    const after = partition(decodeKey(encodeKey(factsFrom(before))).facts);
    expect(after.vocabulary.sort()).toEqual([...before.vocabulary].sort());
    expect(after.research.sort()).toEqual([...before.research].sort());
    expect(after.offered.sort()).toEqual([...before.offered].sort());
  });
});
