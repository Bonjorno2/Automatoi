import { World } from "../../src/sim/world";
import { BOT_CAPACITY } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

/**
 * The loop from milestone 1's balance test, as a player would actually write it.
 *
 * **The `break` is milestone 10's.** Until then a full `harvest` threw, so the
 * naive loop stopped itself and `await c.run(...)` resolved on the error. A full
 * harvest is now a refusal, so the naive loop never ends — and a test that polls
 * for the inventory instead measures how often the poller happened to look, not
 * what the sim cost. Measured: 154 ticks by polling against the sim's own 145.
 *
 * So the loop stops on the same condition `reference-scripts.test.ts` stops on,
 * which restores the exact comparison this file exists to make. The *naive*
 * version — the one that runs forever and gets nowhere — is what the test below
 * covers, and it asserts the stall rather than a tick count.
 */
const BEGINNER_LOOP = `
  let dir = "east";
  while (true) {
    bot.harvester.harvest();
    if ((bot.inventory().wheat ?? 0) >= ${BOT_CAPACITY}) break;
    if (bot.move(dir) === false) {
      bot.move("south");
      dir = dir === "east" ? "west" : "east";
    }
  }
`;

/** The same loop without the stop, which is what a beginner actually types first. */
const NAIVE_LOOP = `
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
  it("fills the inventory and stops where the script says to", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      const outcome = await c.run(1, BEGINNER_LOOP);
      expect(outcome.status).toBe("done");
      expect(c.world.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
    } finally {
      await c.stopAll();
    }
  }, 60_000);

  it("leaves the naive loop alive and getting nowhere, not dead", async () => {
    // Milestone 10's change, seen from the bridge. This loop used to settle with
    // "inventory full"; now it runs on, and the sim's own stall counter is what
    // says the bot has stopped achieving anything. It must also never read as
    // hung — the bot is making world calls, it is just wasting them.
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      let settled: { status: string } | undefined;
      void c.run(1, NAIVE_LOOP, { onSettle: (o) => { settled = o; } }).catch(() => {});
      for (let i = 0; i < 20_000 && c.world.getBot(1).stalled < 3; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(c.world.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
      expect(c.world.getBot(1).stalled).toBeGreaterThanOrEqual(3);
      expect(settled).toBeUndefined();
    } finally {
      await c.stopAll();
    }
  }, 60_000);

  it("costs the same simulated time as driving the sim directly", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      await c.run(1, BEGINNER_LOOP);
      // Milestone 1 measured seed 1 at 155 ticks driving World directly; that
      // became 150 in milestone 10, when the loop stopped running one further
      // harvest to find out it was full. `reference-scripts.test.ts` pins the
      // same number against `World` with no bridge in the way.
      expect(c.world.time).toBe(145);
    } finally {
      await c.stopAll();
    }
  }, 60_000);
});
