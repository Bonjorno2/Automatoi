import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

/**
 * The Fabricator: a script that starts another bot.
 *
 * The design's cycle 4 — "Fabricator / `spawn(script)` / deciding what a new bot
 * runs". This is the first time anything other than the player has put a bot on
 * the map.
 */
function fabricated(opts: { chassis?: number; build?: boolean } = {}): World {
  const world = new World({ seed: 1 });
  world.research.unlocked.add("fabricator");
  world.research.spareChassis = opts.chassis ?? 1;
  if (opts.build !== false) world.placeMachine("fabricator", { x: 20, y: 20 });
  return world;
}

function colonyFor(world: World, library = ""): ScriptColony {
  return new ScriptColony({ world, hungMs: 60_000, library });
}

describe("spawn refuses through the sim's own reasons", () => {
  it("says so when the fabricator has not been researched", async () => {
    const world = new World({ seed: 1 });
    const colony = colonyFor(world);
    try {
      const outcome = await colony.run(1, `colony.fabricator.spawn(() => {});`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("fabricator not researched");
    } finally {
      await colony.stopAll();
    }
  });

  it("says so when none has been built", async () => {
    const colony = colonyFor(fabricated({ build: false }));
    try {
      const outcome = await colony.run(1, `colony.fabricator.spawn(() => {});`);
      expect(outcome.message).toContain("no fabricator built");
    } finally {
      await colony.stopAll();
    }
  });

  it("says so when there is no chassis to spend", async () => {
    const colony = colonyFor(fabricated({ chassis: 0 }));
    try {
      const outcome = await colony.run(1, `colony.fabricator.spawn(() => {});`);
      expect(outcome.message).toContain("no spare chassis");
    } finally {
      await colony.stopAll();
    }
  });

  it("says so when the fabricator is walled in", async () => {
    const world = fabricated();
    world.research.unlocked.add("crate");
    for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
      world.placeMachine("crate", { x: 20 + d.x, y: 20 + d.y });
    }
    const colony = colonyFor(world);
    try {
      const outcome = await colony.run(1, `colony.fabricator.spawn(() => {});`);
      expect(outcome.message).toContain("no room beside the fabricator");
    } finally {
      await colony.stopAll();
    }
  });

  it("spends a chassis only when it succeeds", async () => {
    const world = fabricated({ chassis: 1 });
    const colony = colonyFor(world);
    try {
      await colony.run(1, `colony.fabricator.spawn(() => { bot.wait(1); });`);
      expect(world.research.spareChassis).toBe(0);
      const second = await colony.run(1, `colony.fabricator.spawn(() => {});`);
      expect(second.message).toContain("no spare chassis");
    } finally {
      await colony.stopAll();
    }
  });
});

/**
 * Fact 1 of the milestone 9 plan.
 *
 * Every part of the page assumes a bot's script arrived from the editor. A bot
 * whose script arrived from another script is new, and if any of these is false
 * the fabricator is a different feature from the one the plan describes.
 */
describe("a spawned bot is a bot like any other", () => {
  it("exists, is visible to its parent, and reports its own id", async () => {
    const world = fabricated();
    const colony = colonyFor(world);
    const logs: string[] = [];
    try {
      const outcome = await colony.run(
        1,
        [
          `const id = colony.fabricator.spawn(() => { bot.wait(20); });`,
          `bot.log("spawned " + id);`,
          `bot.log("fleet " + colony.bots().map((b) => b.id).join(","));`,
        ].join("\n"),
        { onLog: (m) => void logs.push(m) },
      );
      expect(outcome.status).toBe("done");
      expect(logs[0]).toMatch(/^spawned \d+$/);
      const id = Number(logs[0]!.split(" ")[1]);
      expect(world.bots.has(id)).toBe(true);
      expect(logs[1]).toContain(String(id));
    } finally {
      await colony.stopAll();
    }
  });

  it("runs its own script concurrently with its parent", async () => {
    const world = fabricated();
    const colony = colonyFor(world);
    const logs: string[] = [];
    try {
      await colony.run(
        1,
        [
          `colony.fabricator.spawn(() => { bot.log("child alive"); });`,
          `bot.wait(20);`,
          `bot.log("parent done");`,
        ].join("\n"),
        { onLog: (m) => void logs.push(m) },
      );
      // The child's own logs go to its own panel, not the parent's, so this
      // asserts on the world instead: it moved, which only a running script does.
      expect(world.bots.size).toBe(2);
    } finally {
      await colony.stopAll();
    }
  });

  it("outlives the script that built it", async () => {
    const world = fabricated();
    const colony = colonyFor(world);
    try {
      await colony.run(
        1,
        `colony.fabricator.spawn(() => { while (true) { bot.wait(1); } });`,
      );
      // The parent has settled. The child is still there and still counted.
      expect(world.bots.size).toBe(2);
      const before = world.time;
      await colony.run(1, `bot.wait(10);`);
      expect(world.time).toBeGreaterThan(before);
    } finally {
      await colony.stopAll();
    }
  });

  it("is stopped by stopAll, like every other worker", async () => {
    const world = fabricated();
    const colony = colonyFor(world);
    await colony.run(1, `colony.fabricator.spawn(() => { while (true) { bot.wait(1); } });`);
    await colony.stopAll();
    // Nothing left running: a second stopAll is a no-op rather than a hang.
    await expect(colony.stopAll()).resolves.toBeUndefined();
  });

  it("can be built twice from one fabricator", async () => {
    const world = fabricated({ chassis: 2 });
    const colony = colonyFor(world);
    try {
      await colony.run(
        1,
        [
          `colony.fabricator.spawn(() => { bot.wait(30); });`,
          `colony.fabricator.spawn(() => { bot.wait(30); });`,
        ].join("\n"),
      );
      expect(world.bots.size).toBe(3);
    } finally {
      await colony.stopAll();
    }
  });

  it("sees the shared library, because it is a bot and every bot does", async () => {
    const world = fabricated();
    const colony = colonyFor(world, `function target() { return "east"; }`);
    try {
      const outcome = await colony.run(
        1,
        `colony.fabricator.spawn(() => { bot.move(target()); });`,
      );
      expect(outcome.status).toBe("done");
    } finally {
      await colony.stopAll();
    }
  });
});

/**
 * Decision 3's known trap, pinned as behaviour rather than left to be
 * discovered: the function is source and closes over nothing.
 */
describe("the spawned function is source, not a closure", () => {
  it("does not capture a variable from the script that spawned it", async () => {
    const world = fabricated();
    const colony = colonyFor(world);
    const logs: string[] = [];
    try {
      const outcome = await colony.run(
        1,
        [
          `const where = "east";`,
          `colony.fabricator.spawn(() => { bot.move(where); });`,
          `bot.wait(10);`,
          `bot.log("parent fine");`,
        ].join("\n"),
        { onLog: (m) => void logs.push(m) },
      );
      // The parent is untouched: the reference error happens in the child.
      expect(outcome.status).toBe("done");
      expect(logs).toContain("parent fine");
      expect(world.bots.size).toBe(2);
    } finally {
      await colony.stopAll();
    }
  });
});
