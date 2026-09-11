import { World } from "../../src/sim/world";
import { RESEARCH_COST } from "../../src/sim/config";
import { run, ticks } from "./helpers";

/**
 * Console funding is deliberately below RESEARCH_COST.planter. Together with the
 * 5-wheat deposit below, the console can never see more than 9 wheat, so the
 * planter research is still queued when drive() returns, whatever the seed.
 */
const CONSOLE_WHEAT = 4;

function drive(w: World): void {
  w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: CONSOLE_WHEAT };
  w.queueResearch("planter");
  run(w, 1, { kind: "harvest" });
  run(w, 1, { kind: "move", dir: "east" });
  run(w, 1, { kind: "harvest" });
  run(w, 1, { kind: "move", dir: "west" });
  run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 5 });
  ticks(w, 20);
}

describe("snapshot", () => {
  it("is JSON round-trippable", () => {
    const w = new World({ seed: 5 });
    drive(w);
    const snap = w.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("reflects world state", () => {
    const w = new World({ seed: 5 });
    drive(w);
    const snap = w.snapshot();
    expect(snap.time).toBe(w.time);
    expect(snap.bots).toHaveLength(1);
    expect(snap.bots[0]!.modules).toEqual(["harvester"]);
    expect(snap.bots[0]!.busy).toBe(false);
    expect(snap.machines[0]!.kind).toBe("console");
    expect(snap.research.queue).toEqual(["planter"]);
    expect(snap.research.unlocked).toEqual([]);
    expect(CONSOLE_WHEAT + 5).toBeLessThan(RESEARCH_COST.planter);
  });

  it("does not share references with the live world", () => {
    const w = new World({ seed: 5 });
    const snap = w.snapshot();
    snap.tiles[0]!.terrain = "soil";
    snap.bots[0]!.pos.x = 999;
    expect(w.tiles[0]!.terrain).toBe("grass");
    expect(w.getBot(1).pos.x).toBe(17);
  });
});

describe("determinism", () => {
  it("same seed and commands give identical snapshots", () => {
    const a = new World({ seed: 123 });
    const b = new World({ seed: 123 });
    drive(a);
    drive(b);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
