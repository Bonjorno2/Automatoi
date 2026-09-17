import { World } from "../../src/sim/world";
import { run } from "../sim/helpers";
import { createSuggester } from "../../src/editor/suggestions.ts";
import { LADDERS } from "../../src/editor/snippets.ts";

/**
 * The spent-field rule, against the sim instead of against a stub.
 *
 * Everything else about this rule is tested with a hand-built snapshot, which
 * is fast and proves the logic and cannot prove the one thing most likely to be
 * wrong: that the sim really says what the rule listens for. Three assumptions
 * are load-bearing and all three are about somebody else's shapes — that a
 * harvest with nothing under it emits `refused` carrying the command name, that
 * a fitted planter shows up in `modules`, and that `tiles[].crop` is how crops
 * are counted. A stub agrees with whatever it was written to agree with.
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

describe("a field the sim itself has emptied", () => {
  it("says what the rule listens for", () => {
    const w = new World({ seed: 1 });
    w.unlockResearch("planter");
    w.installModule(1, "planter");

    // Somewhere with no crop on it. The bot starts on the field, so this walks
    // off it rather than clearing a tile, which would be the same either way.
    for (let i = 0; i < 12; i++) run(w, 1, { kind: "move", dir: "north" });
    w.drainEvents();

    const outcome = run(w, 1, { kind: "harvest" });
    expect(outcome.ok && outcome.value).toBe(false);

    const events = w.drainEvents();
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "refused", botId: 1, command: "harvest" }),
    );

    const snap = w.snapshot();
    expect(snap.bots[0]!.modules).toContain("planter");
    expect(snap.tiles.filter((t) => t.crop).length).toBeGreaterThan(0);
  });

  it("speaks for a real world whose field has gone", () => {
    const w = new World({ seed: 1 });
    w.unlockResearch("planter");
    w.installModule(1, "planter");

    const suggester = taught();
    suggester.started(1, "while (true) { bot.harvester.harvest(); }");

    // A field harvested flat, taken as a starting condition rather than played
    // out: walking a bot to all 169 tiles is thousands of ticks and proves
    // nothing this does not. Four crops are left standing, which is the state
    // the rule is about — and the state in which the player still has seed.
    let kept = 0;
    for (const tile of w.tiles) {
      if (!tile.crop) continue;
      if (kept < 4) kept++;
      else tile.crop = null;
    }
    expect(w.snapshot().tiles.filter((t) => t.crop).length).toBe(4);

    suggester.world(w.snapshot());
    expect(suggester.suggest(1)).toBeNull(); // nobody has tried to harvest yet

    run(w, 1, { kind: "harvest" });
    suggester.saw(w.drainEvents());
    suggester.world(w.snapshot());

    const suggestion = suggester.suggest(1);
    expect(suggestion?.id).toBe("the-field-is-spent");
    expect(suggestion?.chip).toBe("A field that lasts");
  });
});
