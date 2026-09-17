import { LADDERS, SNIPPETS, needsFor } from "../../src/editor/snippets.ts";
import { OPENING_SCRIPT } from "../../src/editor/opening-script.ts";
import { PRIMITIVE_LABEL, primitivesIn } from "../../src/editor/source.ts";
import type { Primitive } from "../../src/editor/source.ts";

/**
 * How a rung is earned.
 *
 * The rule the codebook applies, tested apart from the DOM that draws it: a rung
 * is unlocked by having used everything it and every rung beneath it introduces,
 * **or** by the game having offered that chip.
 */
const unlocked = (
  ladder: (typeof LADDERS)[number],
  i: number,
  vocabulary: Set<Primitive>,
  offered: Set<string> = new Set(),
): boolean =>
  offered.has(ladder.rungs[i]!.title) || needsFor(ladder, i).every((p) => vocabulary.has(p));

const fieldLoop = LADDERS.find((l) => l.id === "field-loop")!;

describe("the ladders", () => {
  it("opens with the ladder that teaches the opening", () => {
    // Order matters here and nowhere else: this is the one the codebook shows
    // first, and it is the one a player who has done nothing needs.
    expect(LADDERS[0]!.id).toBe("getting-started");
  });

  it("covers every chip exactly once", () => {
    const titles = LADDERS.flatMap((l) => l.rungs.map((r) => r.title));
    expect(new Set(titles).size).toBe(titles.length);
    expect(titles.length).toBe(SNIPPETS.length);
  });

  it("gives every rung something it introduces, unless it is practice", () => {
    // A rung that introduces nothing is a rung that unlocks with the one below
    // it, which means it is not a rung — it is a second copy of the same idea.
    // The exception is deliberate and marked: the opening's "now do that three
    // more times" teaches no primitive, it teaches tedium, which is the whole
    // reason the loop afterwards feels like a relief.
    for (const ladder of LADDERS) {
      for (const rung of ladder.rungs) {
        if (rung.practice) {
          expect(rung.introduces, `${ladder.id} / ${rung.title}`).toEqual([]);
          continue;
        }
        expect(rung.introduces.length, `${ladder.id} / ${rung.title}`).toBeGreaterThan(0);
      }
    }
  });

  it("only marks practice rungs in the opening", () => {
    // Everywhere else a rung that adds nothing is a mistake, not a lesson.
    for (const ladder of LADDERS) {
      if (ladder.id === "getting-started") continue;
      for (const rung of ladder.rungs) expect(rung.practice).toBeUndefined();
    }
  });

  it("only introduces primitives its own code actually uses", () => {
    // The promise a locked rung makes: "use while in a script of your own" has
    // to be a thing this rung then demonstrates.
    for (const ladder of LADDERS) {
      ladder.rungs.forEach((rung, i) => {
        const inCode = primitivesIn(rung.code);
        for (const p of rung.introduces) {
          expect(inCode.has(p), `${ladder.id} rung ${i + 1} claims ${PRIMITIVE_LABEL[p]}`).toBe(true);
        }
      });
    }
  });

  it("names what it needs in words the player can act on", () => {
    for (const ladder of LADDERS) {
      ladder.rungs.forEach((_, i) => {
        for (const p of needsFor(ladder, i)) expect(PRIMITIVE_LABEL[p]).toBeTruthy();
      });
    }
  });

  describe("climbing", () => {
    it("asks a rung for everything beneath it, not only its own step", () => {
      // "The chip builds on itself": rung three is rungs one and two plus a
      // condition, so somebody who used inventory() and never wrote a loop has
      // not earned it.
      expect(needsFor(fieldLoop, 2).sort()).toEqual(["harvest", "if", "inventory", "move", "while"]);
    });

    it("locks the first rung for a player who has run nothing", () => {
      // The opening buffer is a comment now, so a player who has pressed Run
      // once and nothing else has demonstrated nothing.
      const vocabulary = primitivesIn(OPENING_SCRIPT);
      expect([...vocabulary]).toEqual([]);
      expect(unlocked(fieldLoop, 0, vocabulary)).toBe(false);
    });

    it("names exactly `while` to somebody who has moved and harvested", () => {
      // Which is where the opening ladder's first two steps leave them, and it
      // is the whole lesson of the design's first ten minutes, printed for free.
      const vocabulary = primitivesIn('bot.harvester.harvest();\nbot.move("east");');
      expect(needsFor(fieldLoop, 0).filter((p) => !vocabulary.has(p))).toEqual(["while"]);
    });

    it("unlocks the first rung once a loop has been run", () => {
      const vocabulary = primitivesIn('while (true) { bot.harvester.harvest(); bot.move("east"); }');
      expect(unlocked(fieldLoop, 0, vocabulary)).toBe(true);
      // And not the next one, which wants `if`.
      expect(unlocked(fieldLoop, 1, vocabulary)).toBe(false);
    });

    it("unlocks a rung the game offered, whatever the player has written", () => {
      // The contradiction this resolves: gating the loop chip on having used a
      // loop makes it unreachable for the only player who needs it. Being shown
      // something counts as learning it.
      const nothing = new Set<Primitive>();
      expect(unlocked(fieldLoop, 0, nothing)).toBe(false);
      expect(unlocked(fieldLoop, 0, nothing, new Set(["Harvest in a loop"]))).toBe(true);
    });

    it("does not let an offered rung unlock the ones above it", () => {
      // Being handed rung one is not being handed the ladder.
      const offered = new Set(["Harvest in a loop"]);
      expect(unlocked(fieldLoop, 1, new Set(), offered)).toBe(false);
    });

    it("opens every rung to a player who has written all of it", () => {
      const vocabulary = new Set<Primitive>(
        LADDERS.flatMap((l) => l.rungs.flatMap((r) => r.introduces)),
      );
      for (const ladder of LADDERS) {
        ladder.rungs.forEach((_, i) => {
          expect(unlocked(ladder, i, vocabulary), `${ladder.id} rung ${i + 1}`).toBe(true);
        });
      }
    });
  });

  describe("hardware", () => {
    it("puts every gated chip on a gated ladder", () => {
      // The gate is the ladder's, not the rung's: there is no rung of the
      // scanner ladder worth reading without a scanner.
      for (const ladder of LADDERS) {
        if (!ladder.requires && !ladder.needsMachine) continue;
        for (const rung of ladder.rungs) {
          const uses = primitivesIn(rung.code);
          const gatedVerbs: Primitive[] = ["plant", "scan", "send", "receive", "place", "deposit"];
          expect(gatedVerbs.some((v) => uses.has(v)), `${ladder.id} / ${rung.title}`).toBe(true);
        }
      }
    });

    it("leaves the ladders a starting chassis can climb ungated", () => {
      const free = LADDERS.filter((l) => !l.requires && !l.needsMachine).map((l) => l.id);
      expect(free).toEqual(["getting-started", "field-loop", "knowing", "research"]);
    });
  });
});
