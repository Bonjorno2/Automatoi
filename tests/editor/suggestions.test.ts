import { SNIPPETS } from "../../src/editor/snippets.ts";
import { OPENING_SCRIPT } from "../../src/editor/opening-script.ts";
import { SUGGESTED_CHIPS, createSuggester } from "../../src/editor/suggestions.ts";
import type { WorldEvent } from "../../src/sim/events.ts";
import type { WorldSnapshot } from "../../src/sim/types.ts";

const LOOP = 'while (true) {\n  bot.harvester.harvest();\n  bot.move("east");\n}\n';

const bump = (botId: number): WorldEvent =>
  ({ kind: "bump", botId, pos: { x: 0, y: 0 }, dir: "east" });
const full = (botId: number): WorldEvent =>
  ({ kind: "full", botId, pos: { x: 0, y: 0 } });
const researched = (name: WorldSnapshot["research"]["unlocked"][number]): WorldEvent =>
  ({ kind: "research", name, pos: { x: 0, y: 0 } });

/** Only the parts of a snapshot the rules read. */
const worldWith = (crate: boolean): WorldSnapshot =>
  ({ machines: crate ? [{ kind: "crate" }] : [] } as unknown as WorldSnapshot);

const times = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

/**
 * When the game speaks, and when it keeps quiet.
 *
 * The second half matters more than the first. A suggestion that fires too
 * eagerly is the tutorial popup the design rules out, wearing a different hat.
 */
describe("suggestions", () => {
  it("points every rule at a chip the book actually has", () => {
    const titles = SNIPPETS.map((s) => s.title);
    for (const chip of SUGGESTED_CHIPS) expect(titles).toContain(chip);
  });

  describe("wrap it in a loop", () => {
    it("says nothing before a single run", () => {
      expect(createSuggester().suggest(1)).toBeNull();
    });

    it("says nothing after one run that ended", () => {
      // The design *wants* the first script to run out. That is the moment the
      // player is meant to feel, and talking over it is the whole failure mode.
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("offers the loop after the second", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      const suggestion = s.suggest(1);
      expect(suggestion?.id).toBe("wrap-it-in-a-loop");
      expect(suggestion?.chip).toBe("Harvest in a loop");
      expect(suggestion?.code).toContain("while (true)");
    });

    it("says nothing to a script that already loops", () => {
      const s = createSuggester();
      const looping = "while (true) { bot.harvester.harvest(); }";
      s.ran(1, looping, "done");
      s.ran(1, looping, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("says nothing about a run that errored or was stopped", () => {
      // An error has the editor's own line marker and the console panel. A stop
      // is the player deciding, and the game answering a decision with advice
      // is the thing that makes a hint system feel like nagging.
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "error");
      s.ran(1, OPENING_SCRIPT, "error");
      expect(s.suggest(1)).toBeNull();

      const t = createSuggester();
      t.ran(1, OPENING_SCRIPT, "stopped");
      t.ran(1, OPENING_SCRIPT, "stopped");
      expect(t.suggest(1)).toBeNull();
    });

    it("needs the two runs to be consecutive", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, "while (true) { bot.move('east'); }", "stopped");
      expect(s.suggest(1)).toBeNull();
    });

    it("counts each bot separately", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(2, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
      expect(s.suggest(2)).toBeNull();
    });

    it("stays retired once refused", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).not.toBeNull();

      s.retire("wrap-it-in-a-loop");
      expect(s.suggest(1)).toBeNull();
      // And it does not come back on the next run that would have raised it.
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("retires for every bot, not just the one that refused it", () => {
      // "No thanks" is a statement about the advice, not about bot 1.
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      s.retire("wrap-it-in-a-loop");
      s.ran(2, OPENING_SCRIPT, "done");
      s.ran(2, OPENING_SCRIPT, "done");
      expect(s.suggest(2)).toBeNull();
    });
  });

  describe("stay on the field", () => {
    /**
     * A looping script bumping the same wall, still running — which is the only
     * state this rule ever sees in the real game and the one it originally could
     * not read. `while (true)` never settles, so there is no *finished* run to
     * ask about, and the first version of this rule asked about finished runs
     * and therefore never fired once. Found by driving the page.
     */
    const wallBanger = (bumps: number) => {
      const s = createSuggester();
      s.world(worldWith(false));
      s.started(1, LOOP);
      s.saw(times(bumps, () => bump(1)));
      return s;
    };

    it("says nothing about a bump or two", () => {
      // One bump is a bot turning around, which is a script working.
      expect(wallBanger(2).suggest(1)).toBeNull();
    });

    it("offers the turnaround once the bot is stuck on a wall", () => {
      expect(wallBanger(8).suggest(1)?.id).toBe("stay-on-the-field");
    });

    it("reads the script that is running, not only the ones that finished", () => {
      // The regression. Both halves: running, and finished-then-stopped.
      expect(wallBanger(8).suggest(1)?.id).toBe("stay-on-the-field");

      const stopped = createSuggester();
      stopped.world(worldWith(false));
      stopped.started(1, LOOP);
      stopped.saw(times(8, () => bump(1)));
      stopped.ran(1, LOOP, "stopped");
      expect(stopped.suggest(1)?.id).toBe("stay-on-the-field");
    });

    it("says nothing to a script with no loop in it", () => {
      // A two-command script cannot bump eight times, and if the counters ever
      // say it did, "your script ended" is the better answer than "turn around".
      const s = createSuggester();
      s.world(worldWith(false));
      s.started(1, OPENING_SCRIPT);
      s.ran(1, OPENING_SCRIPT, "done");
      s.saw(times(8, () => bump(1)));
      expect(s.suggest(1)?.id).not.toBe("stay-on-the-field");
    });

    it("forgets the bumps when a new run starts", () => {
      // The question is whether *this* script is getting nowhere. A total
      // carried across a rewrite answers a different question with the number.
      const s = wallBanger(8);
      s.started(1, LOOP);
      expect(s.suggest(1)).toBeNull();
    });

    it("counts each bot's own wall", () => {
      const s = createSuggester();
      s.world(worldWith(false));
      s.started(1, LOOP);
      s.started(2, LOOP);
      s.saw(times(8, () => bump(2)));
      expect(s.suggest(1)).toBeNull();
      expect(s.suggest(2)?.id).toBe("stay-on-the-field");
    });
  });

  describe("a full bot", () => {
    const stuffed = (crate: boolean) => {
      const s = createSuggester();
      s.world(worldWith(crate));
      s.started(1, LOOP);
      s.saw(times(3, () => full(1)));
      return s;
    };

    it("says nothing about filling up once", () => {
      const s = createSuggester();
      s.world(worldWith(false));
      s.started(1, LOOP);
      s.saw([full(1)]);
      expect(s.suggest(1)).toBeNull();
    });

    it("says stop, when there is nowhere to put it", () => {
      expect(stuffed(false).suggest(1)?.id).toBe("dont-overfill");
    });

    it("says deposit, once a crate exists", () => {
      // Cycle two's answer beats cycle one's the moment the player has bought it.
      const suggestion = stuffed(true).suggest(1);
      expect(suggestion?.id).toBe("somewhere-to-put-it");
      expect(suggestion?.chip).toBe("Empty into a crate");
    });
  });

  describe("new hardware", () => {
    const landed = (name: Parameters<typeof researched>[0]) => {
      const s = createSuggester();
      s.world(worldWith(false));
      s.saw([researched(name)]);
      return s;
    };

    it("shows what the scanner does when the scanner arrives", () => {
      const suggestion = landed("scanner").suggest(1);
      expect(suggestion?.id).toBe("new-hardware:scanner");
      expect(suggestion?.chip).toBe("Look before you move");
    });

    it("stops once the player writes it themselves", () => {
      // The self-retiring shape the loop rule has. A suggestion that has to be
      // dismissed by hand outstays its welcome by however long it is ignored.
      const s = landed("scanner");
      s.ran(1, "for (const t of bot.scanner.scan(2)) { bot.log(t.x); }", "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("is not fooled by the hardware's name in a comment", () => {
      const s = landed("scanner");
      s.ran(1, LOOP.replace("{", "{ // TODO: use bot.scanner here"), "stopped");
      expect(s.suggest(1)?.id).toBe("new-hardware:scanner");
    });

    it("keeps each piece of hardware its own dismissal", () => {
      // One rule whose id varied with what fired it would mean "no thanks" to
      // the scanner silently refused the planter too.
      const s = createSuggester();
      s.world(worldWith(false));
      s.saw([researched("scanner"), researched("planter")]);
      s.retire("new-hardware:scanner");
      expect(s.suggest(1)?.id).toBe("new-hardware:planter");
    });

    it("says nothing about research the book has no chip for", () => {
      // The mill, the oven, the chassis, the library, the fabricator. Adding a
      // chip is what adds the suggestion; the honest answer until then is none.
      for (const name of ["mill", "oven", "chassis", "library", "fabricator"] as const) {
        expect(landed(name).suggest(1)).toBeNull();
      }
    });
  });

  describe("priority", () => {
    it("answers the script that ended before the hardware that arrived", () => {
      // What is happening to you beats what just became available.
      const s = createSuggester();
      s.world(worldWith(false));
      s.saw([researched("scanner")]);
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)?.id).toBe("wrap-it-in-a-loop");
    });

    it("moves on to the next rule once the first is refused", () => {
      const s = createSuggester();
      s.world(worldWith(false));
      s.saw([researched("scanner")]);
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      s.retire("wrap-it-in-a-loop");
      expect(s.suggest(1)?.id).toBe("new-hardware:scanner");
    });
  });

  describe("the book remembers", () => {
    it("keeps every chip it has raised, taken or not", () => {
      // The whole reason the suggestion and the book are one surface: a chip the
      // game taught you has to still be somewhere when you come back for it.
      const s = createSuggester();
      s.world(worldWith(false));
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      s.suggest(1);
      expect([...s.offered()]).toEqual(["Harvest in a loop"]);

      s.retire("wrap-it-in-a-loop");
      s.saw([researched("scanner")]);
      s.suggest(1);
      expect([...s.offered()].sort()).toEqual(["Harvest in a loop", "Look before you move"]);
    });

    it("stays empty while nothing has been raised", () => {
      const s = createSuggester();
      s.world(worldWith(false));
      s.ran(1, OPENING_SCRIPT, "done");
      s.suggest(1);
      expect([...s.offered()]).toEqual([]);
    });
  });


});
