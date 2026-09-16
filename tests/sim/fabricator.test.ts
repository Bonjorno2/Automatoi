import { World } from "../../src/sim/world";

/**
 * The sim half of the Fabricator: where a new bot may appear, and why not.
 *
 * `canSpawn` is the same shape as `canPlace` and `canRemove` and exists for the
 * same reason — the bridge asks it, the sim answers, and there is no second copy
 * of the rule anywhere.
 */
function ready(): World {
  const w = new World({ seed: 1 });
  w.research.unlocked.add("fabricator");
  w.research.spareChassis = 1;
  w.placeMachine("fabricator", { x: 20, y: 20 });
  return w;
}

describe("canSpawn", () => {
  it("refuses in a fixed order of specificity", () => {
    const w = new World({ seed: 1 });
    expect(w.canSpawn()).toBe("fabricator not researched");
    w.research.unlocked.add("fabricator");
    expect(w.canSpawn()).toBe("no fabricator built");
    w.placeMachine("fabricator", { x: 20, y: 20 });
    expect(w.canSpawn()).toBe("no spare chassis");
    w.research.spareChassis = 1;
    expect(w.canSpawn()).toBeNull();
  });

  it("gives the same reason spawnBot throws", () => {
    const w = new World({ seed: 1 });
    expect(() => w.spawnBot()).toThrow("fabricator not researched");
  });

  it("refuses when every tile beside the machine is taken", () => {
    const w = ready();
    w.research.unlocked.add("crate");
    for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
      w.placeMachine("crate", { x: 20 + d.x, y: 20 + d.y });
    }
    expect(w.canSpawn()).toBe("no room beside the fabricator");
  });
});

describe("spawnBot", () => {
  it("puts a harvester beside the fabricator and spends a chassis", () => {
    const w = ready();
    const bot = w.spawnBot();
    expect([...bot.modules]).toEqual(["harvester"]);
    expect(w.research.spareChassis).toBe(0);
    const dx = Math.abs(bot.pos.x - 20);
    const dy = Math.abs(bot.pos.y - 20);
    expect(dx + dy).toBe(1);
  });

  it("puts it on the same tile in two identical worlds", () => {
    // Determinism is what the whole test suite rests on, and "somewhere free
    // beside the machine" is exactly the kind of choice that quietly is not.
    expect(ready().spawnBot().pos).toEqual(ready().spawnBot().pos);
  });

  it("steps around a tile that is taken", () => {
    const w = ready();
    const first = w.spawnBot();
    w.research.spareChassis = 1;
    const second = w.spawnBot();
    expect(second.pos).not.toEqual(first.pos);
  });

  it("does not place a bot on the fabricator itself", () => {
    const w = ready();
    expect(w.spawnBot().pos).not.toEqual({ x: 20, y: 20 });
  });
});
