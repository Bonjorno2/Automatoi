import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("running a player script", () => {
  it("moves a bot east twice", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `bot.move("east"); bot.move("east");`);
      expect(outcome.status).toBe("done");
      expect(c.world.getBot(1).pos).toEqual({ x: 19, y: 16 });
      expect(c.world.time).toBe(TICK_COST.move * 2);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("reads its own position back after moving", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        bot.move("east");
        bot.log("at " + bot.pos().x);
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual(["at 18"]);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("reports a script that throws, and leaves the world intact", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `bot.move("east"); throw new Error("boom");`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("boom");
      expect(c.world.getBot(1).pos).toEqual({ x: 18, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("surfaces a missing module as the sim's own message", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `bot.scanner.scan(1);`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("Bot 1 has no Scanner module");
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("runs a loop with a real condition", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        while (bot.pos().x < 22) bot.move("east");
      `);
      expect(outcome.status).toBe("done");
      expect(c.world.getBot(1).pos).toEqual({ x: 22, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 20_000);
});
