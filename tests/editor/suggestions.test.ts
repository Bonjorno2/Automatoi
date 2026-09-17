import { SNIPPETS } from "../../src/editor/snippets.ts";
import { OPENING_SCRIPT } from "../../src/editor/opening-script.ts";
import { SUGGESTED_CHIPS, createSuggester } from "../../src/editor/suggestions.ts";
import { LADDERS } from "../../src/editor/snippets.ts";
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

const INTRO = LADDERS.find((l) => l.id === "getting-started")!.rungs;

/**
 * A suggester belonging to a player who has finished the opening.
 *
 * The opening owns the floor until it is done — every other rule is a reaction
 * to something going wrong, and a beginner being walked through their first
 * script does not need to be told their script ended. So every test below that
 * is about the reactive rules has to get past it, and does so the way a player
 * does: take each step, run it.
 */
function taught(): ReturnType<typeof createSuggester> {
  const s = createSuggester();
  for (const step of INTRO) {
    s.suggest(1);            // the game offers it
    s.started(1, step.code); // the player runs it
  }
  return s;
}

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
      expect(taught().suggest(1)).toBeNull();
    });

    it("says nothing after one run that ended", () => {
      // The design *wants* the first script to run out. That is the moment the
      // player is meant to feel, and talking over it is the whole failure mode.
      const s = taught();
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("offers the loop after the second", () => {
      const s = taught();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      const suggestion = s.suggest(1);
      expect(suggestion?.id).toBe("wrap-it-in-a-loop");
      expect(suggestion?.chip).toBe("Harvest in a loop");
      expect(suggestion?.code).toContain("while (true)");
    });

    it("says nothing to a script that already loops", () => {
      const s = taught();
      const looping = "while (true) { bot.harvester.harvest(); }";
      s.ran(1, looping, "done");
      s.ran(1, looping, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("says nothing about a run that errored or was stopped", () => {
      // An error has the editor's own line marker and the console panel. A stop
      // is the player deciding, and the game answering a decision with advice
      // is the thing that makes a hint system feel like nagging.
      const s = taught();
      s.ran(1, OPENING_SCRIPT, "error");
      s.ran(1, OPENING_SCRIPT, "error");
      expect(s.suggest(1)).toBeNull();

      const t = taught();
      t.ran(1, OPENING_SCRIPT, "stopped");
      t.ran(1, OPENING_SCRIPT, "stopped");
      expect(t.suggest(1)).toBeNull();
    });

    it("needs the two runs to be consecutive", () => {
      const s = taught();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, "while (true) { bot.move('east'); }", "stopped");
      expect(s.suggest(1)).toBeNull();
    });

    it("counts each bot separately", () => {
      const s = taught();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(2, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
      expect(s.suggest(2)).toBeNull();
    });

    it("stays retired once refused", () => {
      const s = taught();
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
      const s = taught();
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
      const s = taught();
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

      const stopped = taught();
      stopped.world(worldWith(false));
      stopped.started(1, LOOP);
      stopped.saw(times(8, () => bump(1)));
      stopped.ran(1, LOOP, "stopped");
      expect(stopped.suggest(1)?.id).toBe("stay-on-the-field");
    });

    it("says nothing to a script with no loop in it", () => {
      // A two-command script cannot bump eight times, and if the counters ever
      // say it did, "your script ended" is the better answer than "turn around".
      const s = taught();
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
      const s = taught();
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
      const s = taught();
      s.world(worldWith(crate));
      s.started(1, LOOP);
      s.saw(times(3, () => full(1)));
      return s;
    };

    it("says nothing about filling up once", () => {
      const s = taught();
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
      const s = taught();
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
      const s = taught();
      s.world(worldWith(false));
      s.saw([researched("scanner"), researched("planter")]);
      s.retire("new-hardware:scanner");
      expect(s.suggest(1)?.id).toBe("new-hardware:planter");
    });

    /**
     * The planter is the one research that lands on top of a working farm.
     *
     * It arrives while the opening's finale is still running, and the beginner's
     * chip is a whole program that replaces the buffer. Taking it cost a player
     * who had just been walked through turning, depositing and queueing all
     * three — for a loop that spends a wheat on every wheat it takes and so
     * delivers nothing to the console, ever. The game's own advice, followed the
     * moment it was given, undid the introduction that had just finished.
     */
    describe("the planter, on top of a farm that already works", () => {
      it("says put some back, to a player who has been depositing", () => {
        const suggestion = landed("planter").suggest(1);
        expect(suggestion?.chip).toBe("A field that lasts");
      });

      it("still teaches plant to somebody who never learned to deposit", () => {
        // A player who refused the opening outright. The zero-sum loop is the
        // right thing to say to them: they are being shown what plant does.
        const s = createSuggester();
        s.retire("intro:0");
        s.world(worldWith(false));
        s.saw([researched("planter")]);
        expect(s.suggest(1)?.chip).toBe("Harvest, then replant");
      });

      it("is one refusal, whichever rung it raised", () => {
        // Two ids for one moment would mean a player who said "no thanks" to the
        // planter being asked about the planter again in the same breath.
        const s = landed("planter");
        expect(s.suggest(1)?.id).toBe("new-hardware:planter");
        s.retire("new-hardware:planter");
        expect(s.suggest(1)).toBeNull();
      });
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
      const s = taught();
      s.world(worldWith(false));
      s.saw([researched("scanner")]);
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)?.id).toBe("wrap-it-in-a-loop");
    });

    it("moves on to the next rule once the first is refused", () => {
      const s = taught();
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
      const s = taught();
      s.world(worldWith(false));
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      s.suggest(1);
      // Plus the eight the opening already handed over, which is the point.
      expect([...s.offered()]).toContain("Harvest in a loop");
      for (const step of INTRO) expect([...s.offered()]).toContain(step.title);

      s.retire("wrap-it-in-a-loop");
      s.saw([researched("scanner")]);
      s.suggest(1);
      expect([...s.offered()]).toContain("Look before you move");
    });

    it("holds the opening and nothing more, until something is raised", () => {
      const s = taught();
      s.world(worldWith(false));
      s.ran(1, OPENING_SCRIPT, "done");
      s.suggest(1);
      expect([...s.offered()].sort()).toEqual(INTRO.map((r) => r.title).sort());
    });

    it("is empty for a player who refused the opening", () => {
      // Saying "no thanks" to step one ends the whole introduction; somebody who
      // does not want to be taught should not be asked eight times.
      const s = createSuggester();
      expect(s.suggest(1)?.id).toBe("intro:0");
      s.retire("intro:0");
      expect(s.suggest(1)).toBeNull();
    });
  });


});

/**
 * The opening, which is a sequence rather than a reaction.
 *
 * Milestone 10's first playtest found the loop arriving on the second Run,
 * which skipped the hands phase entirely — and the design's abstraction rhythm
 * says the mind phase automates the tedium of the hands phase. A loop handed
 * over before there is any tedium is a trick, not a relief.
 */
describe("the opening", () => {
  it("offers the first step to a player who has done nothing at all", () => {
    const s = createSuggester();
    const first = s.suggest(1);
    expect(first?.id).toBe("intro:0");
    expect(first?.chip).toBe("Move");
    expect(first?.code).toBe('bot.move("east");');
  });

  it("does not advance just because it was shown", () => {
    // `suggest` runs every frame. Advancing on the offer would blow through all
    // eight rungs in eight frames.
    const s = createSuggester();
    for (let i = 0; i < 20; i++) expect(s.suggest(1)?.id).toBe("intro:0");
  });

  it("advances when the step is run", () => {
    const s = createSuggester();
    s.suggest(1);
    s.started(1, 'bot.move("east");');
    expect(s.suggest(1)?.chip).toBe("Collect");
  });

  it("advances for a player who wrote it themselves instead of taking the chip", () => {
    // It watches the primitives, not the clicks.
    const s = createSuggester();
    s.suggest(1);
    s.started(1, 'bot.move("south");  // my own, thanks');
    expect(s.suggest(1)?.chip).toBe("Collect");
  });

  it("does not advance on a run that ignored the step", () => {
    const s = createSuggester();
    s.suggest(1);
    s.started(1, "bot.log(\"hello\");");
    expect(s.suggest(1)?.chip).toBe("Move");
  });

  it("advances a practice step on any run at all", () => {
    // A practice rung introduces nothing, so the only thing it asks is that you
    // feel the tedium of doing it.
    const s = createSuggester();
    for (const step of INTRO.slice(0, 2)) { s.suggest(1); s.started(1, step.code); }
    expect(s.suggest(1)?.chip).toBe("Again, and again");
    s.started(1, "// anything");
    expect(s.suggest(1)?.chip).toBe("Turn at the end of a row");
  });

  it("walks the whole way and then gets out of the way", () => {
    const s = taught();
    expect(s.suggest(1)).toBeNull();
  });

  it("teaches deposit and research before it finishes", () => {
    // The playtest's sharpest finding: a beginner had no path from "my loop
    // works" to "something got researched". The opening now contains it.
    const s = taught();
    expect(s.vocabulary().has("deposit")).toBe(true);
    expect(s.vocabulary().has("queue")).toBe(true);
    expect(s.vocabulary().has("while")).toBe(true);
    expect(s.vocabulary().has("if")).toBe(true);
  });

  it("keeps the loop for last", () => {
    // The finale, and the reason every step before it is longhand.
    expect(INTRO[INTRO.length - 1]!.code).toContain("while (true)");
    for (const step of INTRO.slice(0, -1)) expect(step.code).not.toContain("while (true)");
  });
});
