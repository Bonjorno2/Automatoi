import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("reads cost no ticks", () => {
  it("a thousand pos() reads advance the clock by zero", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += bot.pos().x;
        bot.log(String(sum));
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual([String(17 * 1000)]);
      expect(c.world.time).toBe(0);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("a move loop costs exactly its moves and nothing more", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      await c.run(1, `
        while (bot.pos().x < 22) { bot.inventory(); bot.move("east"); }
      `);
      expect(c.world.getBot(1).pos.x).toBe(22);
      expect(c.world.time).toBe(5 * TICK_COST.move);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("colony reads cost no ticks either", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        for (let i = 0; i < 20; i++) colony.bots();
        bot.log(String(colony.time()));
      `);
      expect(outcome.logs).toEqual(["0"]);
      expect(c.world.time).toBe(0);
    } finally {
      await c.stopAll();
    }
  }, 20_000);
});
