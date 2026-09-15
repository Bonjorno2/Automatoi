import { World } from "../../src/sim/world";
import { CROP_GROWTH, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import { run, ticks } from "./helpers";

function planterWorld(): World {
  const w = new World({ seed: 1 });
  const bot = w.getBot(1);
  bot.modules.add("planter");
  w.tileAt(bot.pos)!.crop = null;
  return w;
}

describe("the crop table", () => {
  it("still says what WHEAT_GROWTH_TICKS always said", () => {
    // Four suites from milestones 1-4 import WHEAT_GROWTH_TICKS directly. If
    // these two ever disagree, those suites are silently asserting a different
    // number from the one the sim uses.
    expect(CROP_GROWTH.wheat).toBe(WHEAT_GROWTH_TICKS);
  });

  it("lists only the items that can actually be planted", () => {
    expect(Object.keys(CROP_GROWTH)).toEqual(["wheat"]);
  });
});

describe("planting an item that is not a seed", () => {
  it("is refused, and costs the bot nothing", () => {
    const w = planterWorld();
    const bot = w.getBot(1);
    bot.inventory = { flour: 3 };

    expect(run(w, 1, { kind: "plant", item: "flour" })).toEqual({ ok: true, value: false });
    expect(bot.inventory).toEqual({ flour: 3 });
    expect(w.tileAt(bot.pos)!.crop).toBeNull();
  });

  it("emits the same refused event as any other refusal", () => {
    const w = planterWorld();
    w.getBot(1).inventory = { bread: 1 };
    w.drainEvents();
    run(w, 1, { kind: "plant", item: "bread" });
    const events = w.drainEvents().filter((e) => e.kind === "refused");
    expect(events).toHaveLength(1);
  });

  it("is refused even on perfectly good empty soil", () => {
    // The refusal is about the item, not the tile, and this is the case that
    // would pass by accident if the check were in the wrong place.
    const w = planterWorld();
    const bot = w.getBot(1);
    bot.inventory = { flour: 5 };
    expect(w.tileAt(bot.pos)!.terrain).toBe("soil");
    expect(run(w, 1, { kind: "plant", item: "flour" })).toEqual({ ok: true, value: false });
  });
});

describe("planting wheat", () => {
  it("is unchanged", () => {
    const w = planterWorld();
    w.getBot(1).inventory = { wheat: 2, flour: 9 };
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1, flour: 9 });
    expect(w.tileAt(w.getBot(1).pos)!.crop).toEqual({ item: "wheat", growth: 0 });
  });

  it("still grows to maturity and harvests back to wheat", () => {
    const w = planterWorld();
    w.getBot(1).inventory = { wheat: 1 };
    run(w, 1, { kind: "plant", item: "wheat" });
    ticks(w, WHEAT_GROWTH_TICKS);
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
  });
});

describe("carrying items that are not wheat", () => {
  it("counts every item against the same capacity", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    bot.inventory = { wheat: 4, flour: 3, bread: 3 };
    w.tileAt(bot.pos)!.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
    w.drainEvents();
    // Ten items already: a bot full of bread is as full as a bot full of wheat.
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: false, error: "inventory full" });
  });

  it("deposits and withdraws like any other item", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    bot.pos = { x: 17, y: 16 };
    bot.inventory = { bread: 3 };

    expect(run(w, 1, { kind: "deposit", dir: "west", item: "bread", count: 2 })).toEqual({
      ok: true,
      value: 2,
    });
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({ bread: 2 });
    expect(run(w, 1, { kind: "withdraw", dir: "west", item: "bread", count: 1 })).toEqual({
      ok: true,
      value: 1,
    });
    expect(bot.inventory).toEqual({ bread: 2 });
  });
});
