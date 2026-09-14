import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("script lifecycle", () => {
  it("stopping mid-command reports stopped and leaves the world usable", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const running = c.run(1, `for (let i = 0; i < 50000; i++) bot.wait(1);`);
      await new Promise((r) => setTimeout(r, 150));
      await c.stop(1);
      const outcome = await running;
      expect(outcome.status).toBe("stopped");
      const after = await c.run(1, `bot.move("east");`);
      expect(after.status).toBe("done");
      expect(c.world.getBot(1).pos).toEqual({ x: 18, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 30_000);

  it("a restarted script starts from a clean channel", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      await c.run(1, `bot.move("east");`);
      const second = await c.run(1, `bot.log("x=" + bot.pos().x); bot.move("east");`);
      expect(second.status).toBe("done");
      expect(second.logs).toEqual(["x=18"]);
      expect(c.world.getBot(1).pos).toEqual({ x: 19, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 30_000);

  it("reattaching the same bot reuses its channel", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      await c.run(1, `bot.wait(1);`);
      await c.run(1, `bot.wait(1);`);
      expect(c.world.time).toBe(2);
    } finally {
      await c.stopAll();
    }
  }, 30_000);
});
