import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

/**
 * The design's "first ten minutes", run as a script.
 *
 * This is the balance test the testing strategy asks for — "reference harvest
 * loop fills the crate in under 400 ticks" — applied to the beat that actually
 * matters: how long a competent beginner takes to reach their first research.
 * It doubles as an API regression test, since it exercises harvest, bounded
 * movement, deposit and research together.
 */
const FIRST_RESEARCH = `
colony.research.queue("planter");
let goingEast = true;
let delivered = 0;
while (delivered < 10) {
  while ((bot.inventory().wheat ?? 0) < 10) {
    bot.harvester.harvest();
    if (!bot.move(goingEast ? "east" : "west")) {
      if (!bot.move("south")) break;
      goingEast = !goingEast;
    }
  }
  // Line up on the row below the console first. Walking home along y=16 runs
  // straight into the console itself, which is a machine and blocks movement —
  // the obvious "move east until x is 17" spins there forever.
  while (bot.pos().y < 17) bot.move("south");
  while (bot.pos().x > 17) bot.move("west");
  while (bot.pos().x < 17) bot.move("east");
  while (bot.pos().y > 16) bot.move("north");
  delivered += bot.deposit("west", "wheat", 10);
  bot.log("delivered " + delivered + " at tick " + colony.time());
}
// The console eats one wheat per tick, and a script has no way to ask whether
// research has finished — so the only option is to wait a guessed number of
// ticks. Recorded as a finding rather than worked around in the sim.
bot.wait(15);
bot.log("waited out the research at tick " + colony.time());
`;

describe("the first ten minutes", () => {
  it("a competent beginner reaches the planter research", async () => {
    const world = new World({ seed: 1 });
    const colony = new ScriptColony({ world, hungMs: 60_000 });
    const logs: string[] = [];
    try {
      const outcome = await colony.run(1, FIRST_RESEARCH, { onLog: (m) => void logs.push(m) });
      expect(outcome.status).toBe("done");

      const research = world.snapshot().research;
      expect(research.unlocked).toContain("planter");

      // Measured at 172 ticks on seed 1 — roughly 9 seconds at 20Hz. Held to
      // the same 400-tick bar the design's testing strategy uses, so the point
      // is to notice when balance moves, not to pin it exactly.
      expect(world.time).toBeLessThan(400);
      expect(logs.length).toBeGreaterThan(0);
    } finally {
      await colony.stopAll();
    }
  }, 60_000);
});
