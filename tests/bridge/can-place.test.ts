import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import type { Direction, MachineKind, ResearchName, Vec } from "../../src/sim/types";

/**
 * `colony.canPlace`: the read cycle five's finding 2 asked for.
 *
 * A planner picked the centroid of the field, the centroid held the Research
 * Console, and it refused the same build 128 times in 6000 ticks — because
 * attempting was the only way a script could ask. The sim has had the predicate
 * since milestone 6; it had three callers and none of them was a script.
 */

const DIR_VEC: Record<Direction, Vec> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

function colonyFor(world: World): ScriptColony {
  return new ScriptColony({ world, hungMs: 60_000 });
}

/** A world where bot 1 stands at `at`, carrying an arm, with `owns` researched. */
function standing(at: Vec, owns: ResearchName[] = ["crate"]): World {
  const world = new World({ seed: 1 });
  const bot = world.getBot(1);
  bot.pos = { ...at };
  bot.modules.add("builder");
  for (const name of owns) world.research.unlocked.add(name);
  return world;
}

/**
 * Fact 1 of the milestone 11 plan, driven rather than argued.
 *
 * `world.canPlace` exists so the red ghost and the refusing click are one rule
 * rather than two copies of it. This milestone adds a third caller with a
 * different shape — absolute position, boolean answer, no adjacency — and a
 * planner that will walk somewhere on its strength. If the two can ever
 * disagree, the read is a second copy of the rule and has become the exact drift
 * the predicate was written to prevent.
 */
describe("the script's answer and the arm's answer are the same answer", () => {
  interface Row {
    what: string;
    /** Where the bot stands, and which way the target lies from it. */
    from: Vec;
    dir: Direction;
    kind: MachineKind;
    owns?: ResearchName[];
    /** Deployed before the run, to stand on the target. */
    squatter?: Vec;
    expected: boolean;
  }

  const rows: Row[] = [
    { what: "free soil", from: { x: 20, y: 20 }, dir: "east", kind: "crate", expected: true },
    {
      what: "the console's tile",
      from: { x: 17, y: 16 }, dir: "west", kind: "crate",
      expected: false,
    },
    {
      what: "a tile under another bot",
      from: { x: 18, y: 16 }, dir: "west", kind: "crate", squatter: { x: 17, y: 16 },
      expected: false,
    },
    { what: "out of bounds", from: { x: 0, y: 16 }, dir: "west", kind: "crate", expected: false },
    {
      what: "a kind nobody researched",
      from: { x: 20, y: 20 }, dir: "east", kind: "mill", owns: ["crate"],
      expected: false,
    },
    {
      what: "a second console",
      from: { x: 20, y: 20 }, dir: "east", kind: "console", owns: ["crate"],
      expected: false,
    },
  ];

  for (const row of rows) {
    it(`agrees about ${row.what}`, async () => {
      const world = standing(row.from, row.owns);
      if (row.squatter) {
        world.research.spareChassis = 1;
        world.deployBot(row.squatter);
      }
      const colony = colonyFor(world);
      try {
        const outcome = await colony.run(1, `
          const here = bot.pos();
          const step = ${JSON.stringify(DIR_VEC[row.dir])};
          bot.log("read " + colony.canPlace({ x: here.x + step.x, y: here.y + step.y }, ${JSON.stringify(row.kind)}));
          try {
            bot.builder.place(${JSON.stringify(row.kind)}, ${JSON.stringify(row.dir)});
            bot.log("arm true");
          } catch (err) {
            bot.log("arm false");
          }
        `);
        expect(outcome.status).toBe("done");
        expect(outcome.logs).toEqual([`read ${row.expected}`, `arm ${row.expected}`]);
      } finally {
        await colony.stopAll();
      }
    }, 20_000);
  }
});

describe("colony.canPlace", () => {
  it("turns true for a kind the moment it is researched", async () => {
    const world = new World({ seed: 1 });
    const colony = colonyFor(world);
    try {
      const before = await colony.run(1, `bot.log(String(colony.canPlace({ x: 20, y: 20 }, "mill")));`);
      expect(before.logs).toEqual(["false"]);
      world.research.unlocked.add("mill");
      const after = await colony.run(1, `bot.log(String(colony.canPlace({ x: 20, y: 20 }, "mill")));`);
      expect(after.logs).toEqual(["true"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("costs no ticks, however many times it is asked", async () => {
    const world = new World({ seed: 1 });
    world.research.unlocked.add("crate");
    const colony = colonyFor(world);
    try {
      const outcome = await colony.run(1, `
        let fits = 0;
        for (let y = 10; y < 22; y++) {
          for (let x = 10; x < 22; x++) if (colony.canPlace({ x, y }, "crate")) fits++;
        }
        bot.log(String(fits));
      `);
      expect(outcome.status).toBe("done");
      // 144 tiles, less the console's and the bot's own.
      expect(outcome.logs).toEqual(["142"]);
      expect(colony.world.time).toBe(0);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("is a snapshot, and does not promise the tile will still be free", async () => {
    // Said out loud in the hover text, and asserted here so it stays true: the
    // answer is about now, and a planner that walks somewhere on it can arrive
    // to find a bot standing there.
    const world = new World({ seed: 1 });
    world.research.unlocked.add("crate");
    const colony = colonyFor(world);
    try {
      const before = await colony.run(1, `bot.log(String(colony.canPlace({ x: 20, y: 20 }, "crate")));`);
      expect(before.logs).toEqual(["true"]);
      world.research.spareChassis = 1;
      world.deployBot({ x: 20, y: 20 });
      const after = await colony.run(1, `bot.log(String(colony.canPlace({ x: 20, y: 20 }, "crate")));`);
      expect(after.logs).toEqual(["false"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("refuses an unknown kind with an error the script can catch", async () => {
    // The same judgement `queueResearch` makes about an unknown research name: a
    // name nobody has is a typo, and answering `false` to a typo is how a planner
    // ends up in the 128-refusals loop this whole read exists to prevent.
    const colony = colonyFor(new World({ seed: 1 }));
    try {
      const outcome = await colony.run(1, `
        try {
          colony.canPlace({ x: 20, y: 20 }, "sawmill");
          bot.log("no error");
        } catch (err) {
          bot.log("caught: " + err.message);
        }
        bot.log("still alive");
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs[0]).toContain("sawmill");
      expect(outcome.logs[1]).toBe("still alive");
    } finally {
      await colony.stopAll();
    }
  }, 20_000);
});
