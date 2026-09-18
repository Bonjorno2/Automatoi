import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

/**
 * Whether another bot is working, stuck or dead: cycle five's finding 5.
 *
 * `colony.bots()` answered with `busy`, which means "has a command in flight"
 * and is true of a bot working and equally true of a bot deadlocked against
 * another — the playtest sampled exactly that pair and could not tell them
 * apart. `stalled` had existed on the sim's own `Bot` since milestone 9 and was
 * simply not carried through the mirror, and whether a *script* was still
 * running existed nowhere a script could reach.
 *
 * This is milestone 9's finding 3 from the other end: the colony was observable
 * to the renderer and not to a script.
 */

/** A world with a second bot standing well clear of the first. */
function twoBots(): World {
  const world = new World({ seed: 1 });
  world.research.spareChassis = 1;
  world.deployBot({ x: 20, y: 20 });
  return world;
}

/** The id `deployBot` hands out here: 1 is the bot, 2 the console. */
const OTHER = 3;

const READ = `
  const them = colony.bots().find((b) => b.id === ${OTHER});
  bot.log(them.script + " stalled:" + them.stalled);
`;

describe("a script can see what another bot's script is doing", () => {
  it("says idle for a bot that has never been given one", async () => {
    const colony = new ScriptColony({ world: twoBots(), hungMs: 60_000 });
    try {
      const outcome = await colony.run(1, READ);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual(["idle stalled:0"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("says running while the other script is alive", async () => {
    const colony = new ScriptColony({ world: twoBots(), hungMs: 60_000 });
    try {
      void colony.run(OTHER, `while (true) bot.wait(5);`);
      const outcome = await colony.run(1, READ);
      expect(outcome.logs).toEqual(["running stalled:0"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("says error for a bot whose script threw, which busy could never say", async () => {
    const colony = new ScriptColony({ world: twoBots(), hungMs: 60_000 });
    try {
      const died = await colony.run(OTHER, `throw new Error("no");`);
      expect(died.status).toBe("error");
      const outcome = await colony.run(1, READ);
      expect(outcome.logs).toEqual(["error stalled:0"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("says done for a bot whose script simply ended", async () => {
    const colony = new ScriptColony({ world: twoBots(), hungMs: 60_000 });
    try {
      await colony.run(OTHER, `bot.wait(1);`);
      const outcome = await colony.run(1, READ);
      expect(outcome.logs).toEqual(["done stalled:0"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("says stopped for a bot that was stopped, and running again after a reload", async () => {
    const colony = new ScriptColony({ world: twoBots(), hungMs: 60_000 });
    try {
      void colony.run(OTHER, `while (true) bot.wait(5);`);
      await colony.stop(OTHER);
      const stopped = await colony.run(1, READ);
      expect(stopped.logs).toEqual(["stopped stalled:0"]);

      // A hot reload is the same bot with a new script, and the old verdict must
      // not outlive it.
      void colony.run(OTHER, `while (true) bot.wait(5);`);
      const restarted = await colony.run(1, READ);
      expect(restarted.logs).toEqual(["running stalled:0"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("carries how long another bot has been getting nowhere", async () => {
    // The counter milestone 8 built so a bot going nowhere could say so. The sim
    // has tested the counting since milestone 9; what is new is that a *script*
    // can read it, which is the judgement `expand` has to make.
    const world = twoBots();
    const colony = new ScriptColony({ world, hungMs: 60_000 });
    try {
      world.getBot(OTHER).stalled = 4;
      const outcome = await colony.run(1, READ);
      expect(outcome.logs).toEqual(["idle stalled:4"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("is still a free read", async () => {
    const colony = new ScriptColony({ world: twoBots(), hungMs: 60_000 });
    try {
      await colony.run(1, `for (let i = 0; i < 200; i++) colony.bots();`);
      expect(colony.world.time).toBe(0);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);
});
