import { World } from "../../src/sim/world";
import { BOT_CAPACITY, TICK_COST, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import { run } from "./helpers";

function worldWithWheatUnderBot(): World {
  const w = new World({ seed: 1 });
  const tile = w.tileAt(w.getBot(1).pos)!;
  tile.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
  return w;
}

describe("harvest", () => {
  it("collects mature wheat, clears the tile, costs TICK_COST.harvest", () => {
    const w = worldWithWheatUnderBot();
    const r = run(w, 1, { kind: "harvest" });
    expect(r).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
    expect(w.tileAt(w.getBot(1).pos)!.crop).toBeNull();
    expect(w.time).toBe(TICK_COST.harvest);
  });

  it("returns false on an empty tile", () => {
    const w = new World({ seed: 1 });
    w.tileAt(w.getBot(1).pos)!.crop = null;
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });
    expect(w.getBot(1).inventory).toEqual({});
  });

  it("returns false on an immature crop", () => {
    const w = new World({ seed: 1 });
    w.tileAt(w.getBot(1).pos)!.crop = { item: "wheat", growth: 3 };
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });
  });

  it("refuses when the inventory is full, and leaves the crop standing", () => {
    // Milestone 10's playtest: a refusal rather than an error, which is the same
    // answer this command already gave for bare soil. The crop surviving is the
    // half that must not change — a refused harvest must never eat the wheat.
    const w = worldWithWheatUnderBot();
    w.getBot(1).inventory = { wheat: BOT_CAPACITY };
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });
    expect(w.tileAt(w.getBot(1).pos)!.crop).not.toBeNull();
  });

  it("counts a full harvest as getting nowhere, so the panel can say stuck", () => {
    // The replacement signal for the error this used to throw. Without this the
    // change would have removed a signal instead of moving it.
    const w = worldWithWheatUnderBot();
    w.getBot(1).inventory = { wheat: BOT_CAPACITY };
    run(w, 1, { kind: "harvest" });
    run(w, 1, { kind: "harvest" });
    expect(w.getBot(1).stalled).toBe(2);
  });

  it("errors when the bot has no harvester", () => {
    const w = worldWithWheatUnderBot();
    w.getBot(1).modules.delete("harvester");
    expect(run(w, 1, { kind: "harvest" })).toEqual({
      ok: false,
      error: "Bot 1 has no Harvester module",
    });
  });
});
