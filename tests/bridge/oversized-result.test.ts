import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { RES_BYTES } from "../../src/bridge/protocol.ts";

/**
 * Milestone 10's cycle-5 playtest, finding 1.
 *
 * A result too big for the response frame used to throw out of `Colony.reply`,
 * which left the channel parked on its request forever: the worker stayed
 * blocked on `Atomics.wait`, the watchdog by design never fires for a channel
 * sitting on a REQUEST, and every surface in the game said the bot was idle and
 * fine. `bot.scanner.scan(7)` is a documented call that does this.
 *
 * The rule these pin: **an answer that does not fit is still an answer.**
 */
function scanner(): World {
  const world = new World({ seed: 1 });
  world.research.unlocked.add("scanner");
  world.getBot(1).modules.add("scanner");
  return world;
}

describe("a result too large for the channel", () => {
  it("fails the call instead of parking the bot forever", async () => {
    const world = scanner();
    const colony = new ScriptColony({ world, hungMs: 10_000 });
    try {
      // The script settles at all, which is the whole point — before the fix
      // this promise never resolved.
      const outcome = await colony.run(1, `bot.scanner.scan(7); bot.log("unreachable");`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toMatch(/too large/i);
      expect(outcome.logs).not.toContain("unreachable");
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("blames the player's own line, like any other refusal", async () => {
    const world = scanner();
    const colony = new ScriptColony({ world, hungMs: 10_000 });
    try {
      const outcome = await colony.run(1, `bot.log("one");\nbot.log("two");\nbot.scanner.scan(7);`);
      expect(outcome.status).toBe("error");
      expect(outcome.line).toBe(3);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("is catchable, so a script can back off and ask for less", async () => {
    const world = scanner();
    const colony = new ScriptColony({ world, hungMs: 10_000 });
    try {
      // What a planner should be able to write: try wide, fall back to narrow.
      const outcome = await colony.run(1, `
let tiles = null;
for (const r of [7, 6]) {
  try { tiles = bot.scanner.scan(r); bot.log("scanned at " + r); break; }
  catch (e) { bot.log("refused at " + r); }
}
bot.log("tiles " + tiles.length);
`);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toContain("refused at 7");
      expect(outcome.logs).toContain("scanned at 6");
      expect(outcome.logs).toContain("tiles 169");
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("leaves the channel usable, so the next command still works", async () => {
    const world = scanner();
    const colony = new ScriptColony({ world, hungMs: 10_000 });
    try {
      const outcome = await colony.run(1, `
try { bot.scanner.scan(7); } catch (e) {}
bot.log("still here at " + bot.pos().x + "," + bot.pos().y);
bot.move("east");
bot.log("moved to " + bot.pos().x);
`);
      expect(outcome.status).toBe("done");
      expect(outcome.logs.some((l) => l.startsWith("moved to"))).toBe(true);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("still returns the largest scan that does fit", async () => {
    // The boundary, measured rather than assumed: 169 tiles of scan JSON is
    // under RES_BYTES and 225 is over. If the frame ever grows, this is the test
    // that says the boundary moved.
    const world = scanner();
    const colony = new ScriptColony({ world, hungMs: 10_000 });
    try {
      const outcome = await colony.run(1, `bot.log("n=" + bot.scanner.scan(6).length);`);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toContain("n=169");
      expect(RES_BYTES).toBe(16384);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);
});
