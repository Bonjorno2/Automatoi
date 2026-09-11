import { World } from "../../src/sim/world";
import { TICK_COST, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import { run, ticks } from "./helpers";

function planterWorld(): World {
  const w = new World({ seed: 1 });
  const bot = w.getBot(1);
  bot.modules.add("planter");
  bot.inventory = { wheat: 2 };
  w.tileAt(bot.pos)!.crop = null;
  return w;
}

describe("plant", () => {
  it("plants a seed on empty soil and consumes one wheat", () => {
    const w = planterWorld();
    const r = run(w, 1, { kind: "plant", item: "wheat" });
    expect(r).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
    expect(w.tileAt(w.getBot(1).pos)!.crop).toEqual({ item: "wheat", growth: 0 });
    expect(w.time).toBe(TICK_COST.plant);
  });

  it("returns false on grass", () => {
    const w = planterWorld();
    w.tileAt(w.getBot(1).pos)!.terrain = "grass";
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: false });
    expect(w.getBot(1).inventory).toEqual({ wheat: 2 });
  });

  it("returns false when the tile already has a crop", () => {
    const w = planterWorld();
    w.tileAt(w.getBot(1).pos)!.crop = { item: "wheat", growth: 5 };
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: false });
  });

  it("returns false with no seed in inventory", () => {
    const w = planterWorld();
    w.getBot(1).inventory = {};
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: false });
  });

  it("errors without a planter module", () => {
    const w = planterWorld();
    w.getBot(1).modules.delete("planter");
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({
      ok: false,
      error: "Bot 1 has no Planter module",
    });
  });
});

describe("crop growth", () => {
  it("grows one per tick and stops at maturity", () => {
    const w = planterWorld();
    run(w, 1, { kind: "plant", item: "wheat" });
    const tile = w.tileAt(w.getBot(1).pos)!;
    ticks(w, 10);
    expect(tile.crop?.growth).toBe(10);
    ticks(w, WHEAT_GROWTH_TICKS);
    expect(tile.crop?.growth).toBe(WHEAT_GROWTH_TICKS);
  });

  it("a planted crop becomes harvestable", () => {
    const w = planterWorld();
    run(w, 1, { kind: "plant", item: "wheat" });
    ticks(w, WHEAT_GROWTH_TICKS);
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 2 });
  });
});
