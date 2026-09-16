import { World } from "../../src/sim/world";
import { RESEARCH_COST, TICK_COST } from "../../src/sim/config";
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

  it("reading research costs no ticks, and reports what is queued", async () => {
    // Milestone 3's finding 4: queueing was write-only, so the reference script
    // waited on a number worked out on paper. This is the read that replaces it.
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    c.world.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 4 };
    try {
      const outcome = await c.run(1, `
        colony.research.queue("planter");
        const before = colony.research.status();
        bot.log(JSON.stringify({ q: before.queue, cost: before.cost, done: before.unlocked }));
        for (let i = 0; i < 50; i++) colony.research.status();
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual([
        JSON.stringify({ q: ["planter"], cost: RESEARCH_COST.planter, done: [] }),
      ]);
      expect(c.world.time).toBe(0);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("reports progress against the head of the queue as it advances", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    c.world.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 20 };
    try {
      const outcome = await c.run(1, `
        colony.research.queue("planter");
        bot.wait(5);
        const r = colony.research.status();
        bot.log(r.progress + "/" + r.cost);
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual([`5/${RESEARCH_COST.planter}`]);
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
