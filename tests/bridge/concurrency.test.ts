import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

function twoBotWorld(): World {
  const w = new World({ seed: 1 });
  w.research.spareChassis = 1;
  const other = w.deployBot({ x: 17, y: 18 });
  w.getBot(1).modules.add("radio");
  w.getBot(other.id).modules.add("radio");
  return w;
}

describe("independent blocking", () => {
  it("a bot parked on receive does not stall the other", async () => {
    const c = new ScriptColony({ world: twoBotWorld() });
    try {
      const listener = c.run(3, `
        const msg = bot.radio.receive();
        bot.log("got " + msg.channel);
      `);
      const sender = c.run(1, `
        bot.move("east");
        bot.move("east");
        bot.radio.send("go", null);
      `);
      const [a, b] = await Promise.all([listener, sender]);
      expect(b.status).toBe("done");
      expect(a.status).toBe("done");
      expect(a.logs).toEqual(["got go"]);
      expect(c.world.getBot(1).pos.x).toBe(19);
    } finally {
      await c.stopAll();
    }
  }, 30_000);
});
