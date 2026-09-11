import { World } from "../../src/sim/world";
import { BOT_CAPACITY } from "../../src/sim/config";
import type { Direction } from "../../src/sim/types";
import { run } from "./helpers";

/**
 * The loop a beginner writes after their first two insights:
 * harvest, step, and turn around at the edge. Stops on the first error,
 * which will be "inventory full".
 */
function beginnerHarvestLoop(w: World, botId: number): string {
  let dir: Direction = "east";
  for (let guard = 0; guard < 10_000; guard++) {
    const h = run(w, botId, { kind: "harvest" });
    if (!h.ok) return h.error;
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
  });

  it("is stable across a handful of seeds", () => {
    for (const seed of [2, 3, 4, 5, 6]) {
      const w = new World({ seed });
      expect(beginnerHarvestLoop(w, 1)).toBe("inventory full");
      expect(w.time).toBeLessThan(250);
    }
  });
});
