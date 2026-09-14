import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("watchdog", () => {
  it("terminates a script that never calls into the world", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 100 });
    try {
      const outcome = await c.run(1, `while (true) {}`);
      expect(outcome.status).toBe("hung");
      expect(outcome.message).toContain("no world call");
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("leaves a bot legitimately parked on receive alone", async () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const other = w.deployBot({ x: 17, y: 18 });
    w.getBot(1).modules.add("radio");
    w.getBot(other.id).modules.add("radio");
    const c = new ScriptColony({ world: w, hungMs: 2000 });
    try {
      const listener = c.run(other.id, `bot.radio.receive(); bot.log("woke");`);
      const sender = c.run(1, `
        for (let i = 0; i < 40; i++) bot.wait(1);
        bot.radio.send("go", null);
      `);
      const [a] = await Promise.all([listener, sender]);
      expect(a.status).toBe("done");
      expect(a.logs).toEqual(["woke"]);
    } finally {
      await c.stopAll();
    }
  }, 30_000);

  it("does not fire on a script making steady progress", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 2000 });
    try {
      const outcome = await c.run(1, `for (let i = 0; i < 30; i++) bot.wait(1);`);
      expect(outcome.status).toBe("done");
    } finally {
      await c.stopAll();
    }
  }, 20_000);
});
