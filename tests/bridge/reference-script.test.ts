import { World } from "../../src/sim/world";
import { BOT_CAPACITY } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

/** The loop from milestone 1's balance test, as a player would actually write it. */
const BEGINNER_LOOP = `
  let dir = "east";
  while (true) {
    bot.harvester.harvest();
    if (bot.move(dir) === false) {
      bot.move("south");
      dir = dir === "east" ? "west" : "east";
    }
  }
`;

describe("reference script through the bridge", () => {
  it("fills the inventory and stops on the sim's own error", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      const outcome = await c.run(1, BEGINNER_LOOP);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("inventory full");
      expect(c.world.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
    } finally {
      await c.stopAll();
    }
  }, 60_000);

  it("costs the same simulated time as driving the sim directly", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      await c.run(1, BEGINNER_LOOP);
      // Milestone 1 measured seed 1 at 155 ticks driving World directly.
      expect(c.world.time).toBe(155);
    } finally {
      await c.stopAll();
    }
  }, 60_000);
});
