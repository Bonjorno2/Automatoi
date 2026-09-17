import { World } from "../../src/sim/world";
import { run } from "../sim/helpers";
import { createSuggester } from "../../src/editor/suggestions.ts";
import { LADDERS } from "../../src/editor/snippets.ts";
import { RESEARCH_COST } from "../../src/sim/config.ts";
import type { Command, ResearchName } from "../../src/sim/types.ts";

/**
 * The thinning-field rule, played rather than posed.
 *
 * The rest of this rule is tested against a hand-built snapshot, which is fast
 * and proves the logic and cannot prove the thing that actually went wrong. The
 * first version of the rule passed nine unit tests and never fired in a real
 * game: it waited for the field to hold less than one delivery, and a real field
 * never gets there. Only five researches are priced in wheat — planter, scanner,
 * crate, mill, oven, eighty between them — and everything after costs bread. So
 * a player who only harvests and delivers fills the console for good and the
 * field stops draining with about a fifth of it standing.
 *
 * That is not a fact any stub was ever going to volunteer. This test farms a
 * real world with a real script until the rule speaks, and fails if it does not.
 */

const INTRO = LADDERS.find((l) => l.id === "getting-started")!.rungs;

/** A suggester belonging to a player who has finished the opening. */
function taught(): ReturnType<typeof createSuggester> {
  const s = createSuggester();
  for (const step of INTRO) {
    s.suggest(1);
    s.started(1, step.code);
  }
  return s;
}

describe("a field the sim itself has thinned", () => {
  it("says what the rule listens for", () => {
    // Three assumptions about somebody else's shapes, all load-bearing: that an
    // empty harvest emits `refused` carrying the command name, that a fitted
    // planter appears in `modules`, and that terrain and crops are on the tiles.
    const w = new World({ seed: 1 });
    w.unlockResearch("planter");
    w.installModule(1, "planter");

    for (let i = 0; i < 12; i++) run(w, 1, { kind: "move", dir: "north" });
    w.drainEvents();

    const outcome = run(w, 1, { kind: "harvest" });
    expect(outcome.ok && outcome.value).toBe(false);
    expect(w.drainEvents()).toContainEqual(
      expect.objectContaining({ kind: "refused", botId: 1, command: "harvest" }),
    );

    const snap = w.snapshot();
    expect(snap.bots[0]!.modules).toContain("planter");
    expect(snap.tiles.filter((t) => t.crop).length).toBeGreaterThan(0);
    expect(snap.tiles.filter((t) => t.terrain === "soil").length).toBe(169);
  });

  it("speaks to a player who farms a real field down", () => {
    const w = new World({ seed: 1 });
    w.unlockResearch("planter");
    w.installModule(1, "planter");
    // Everything queued, so the console eats for as long as it can and the
    // field thins by delivery rather than by the bot running out of pockets.
    for (const r of Object.keys(RESEARCH_COST) as ResearchName[]) {
      if (r !== "planter") w.queueResearch(r);
    }

    const s = taught();
    const script = 'while (true) { bot.harvester.harvest(); bot.move("east"); }';
    s.started(1, script);

    const bot = () => w.getBot(1);
    const act = (cmd: Command): unknown => {
      const r = run(w, 1, cmd);
      s.saw(w.drainEvents());
      return r.ok ? r.value : undefined;
    };
    const crops = (): number => w.snapshot().tiles.filter((t) => t.crop).length;

    const startCrops = crops();
    let spoke: { crops: number; tick: number; chip: string } | null = null;
    let east = true;

    for (let step = 0; step < 3000 && !spoke; step++) {
      act({ kind: "harvest" });
      if (!act({ kind: "move", dir: east ? "east" : "west" })) {
        // The sweep wraps rather than pacing the bottom row forever.
        if (!act({ kind: "move", dir: "south" })) {
          for (let i = 0; i < 40; i++) act({ kind: "move", dir: "north" });
        }
        east = !east;
      }
      if ((bot().inventory.wheat ?? 0) >= 10) {
        // Home the long way round: north and west to the corner, then down and
        // across to the console, which needs no `pos()` and cannot get lost.
        for (let i = 0; i < 40; i++) act({ kind: "move", dir: "north" });
        for (let i = 0; i < 40; i++) act({ kind: "move", dir: "west" });
        for (let i = 0; i < 40; i++) act({ kind: "move", dir: "north" });
        for (let i = 0; i < 16; i++) act({ kind: "move", dir: "south" });
        for (let i = 0; i < 15; i++) act({ kind: "move", dir: "east" });
        act({ kind: "deposit", dir: "east", item: "wheat", count: 10 });
      }

      s.world(w.snapshot());
      const at = s.suggest(1);
      if (at?.id === "the-field-is-spent") {
        spoke = { crops: crops(), tick: w.time, chip: at.chip };
      } else if (at) {
        // The player waves away whatever else the book has to say. Those rules
        // are earlier and louder, and none of them is about the field.
        s.retire(at.id);
      }
    }

    // Measured at the time of writing: 52 crops of 120, tick 6497.
    expect(spoke).not.toBeNull();
    expect(spoke!.chip).toBe("A field that lasts");
    // Early enough to be worth saying: the field still has crops standing, so
    // the player has wheat to plant and somewhere to put it.
    expect(spoke!.crops).toBeGreaterThan(10);
    expect(spoke!.crops).toBeLessThan(startCrops / 2);
  });
});
