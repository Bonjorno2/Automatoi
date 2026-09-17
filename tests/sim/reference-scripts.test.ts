import { World } from "../../src/sim/world";
import { BOT_CAPACITY } from "../../src/sim/config";
import type { Direction } from "../../src/sim/types";
import { run } from "./helpers";

/**
 * The loop a beginner writes after their first two insights:
 * harvest, step, and turn around at the edge.
 *
 * **Until milestone 10 this loop stopped itself.** `harvest` threw "inventory
 * full", the script died, and that stop was the cycle 1 → cycle 2 pain the
 * design wanted a player to feel on their way to crates. A full harvest is now a
 * refusal, so the loop runs forever and the *world* reports the bot as stuck
 * instead — see `harvest.test.ts` for the stall that replaced the error.
 *
 * What this file measures is unchanged: how long ten wheat takes. Only the stop
 * condition moved, from the error to the inventory it was reporting on.
 */
function beginnerHarvestLoop(w: World, botId: number): string {
  let dir: Direction = "east";
  for (let guard = 0; guard < 10_000; guard++) {
    const h = run(w, botId, { kind: "harvest" });
    if (!h.ok) return h.error;
    if ((w.getBot(botId).inventory.wheat ?? 0) >= BOT_CAPACITY) return "inventory full";
    const m = run(w, botId, { kind: "move", dir });
    if (!m.ok) return m.error;
    if (m.value === false) {
      run(w, botId, { kind: "move", dir: "south" });
      dir = dir === "east" ? "west" : "east";
    }
  }
  return "guard exhausted";
}

describe("reference scripts", () => {
  it("beginner harvest loop fills the inventory within 200 ticks", () => {
    const w = new World({ seed: 1 });
    const stopReason = beginnerHarvestLoop(w, 1);
    expect(stopReason).toBe("inventory full");
    expect(w.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
    expect(w.time).toBeLessThan(200);
    // Pinned exactly, because `reference-script.test.ts` claims the bridge costs
    // the same simulated time and that claim is only checkable against a number.
    // It was 155 until milestone 10: the loop used to run one further harvest,
    // the one that threw, and that attempt cost a tick of its own.
    expect(w.time).toBe(145);
  });

  it("is stable across a handful of seeds", () => {
    for (const seed of [2, 3, 4, 5, 6]) {
      const w = new World({ seed });
      expect(beginnerHarvestLoop(w, 1)).toBe("inventory full");
      expect(w.time).toBeLessThan(250);
    }
  });
});
