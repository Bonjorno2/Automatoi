import { describeTile } from "../../src/render/inspector";
import { World } from "../../src/sim/world";
import { MACHINE_CAPACITY, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import { ticks } from "../sim/helpers";

/** A tile of plain grass, well outside the field. */
const GRASS = { x: 2, y: 2 };

describe("describeTile", () => {
  it("says nothing about a tile outside the world", () => {
    const w = new World({ seed: 1 });
    for (const t of [
      { x: -1, y: 5 },
      { x: 5, y: -1 },
      { x: 32, y: 5 },
      { x: 5, y: 32 },
    ]) {
      expect(describeTile(w.snapshot(), t), JSON.stringify(t)).toEqual([]);
    }
  });

  it("describes bare grass in one line", () => {
    const w = new World({ seed: 1 });
    expect(describeTile(w.snapshot(), GRASS)).toEqual(["grass"]);
  });

  it("describes a crop by how far along it is", () => {
    const w = new World({ seed: 1 });
    const t = { x: 12, y: 12 };
    w.tileAt(t)!.crop = { item: "wheat", growth: 0 };
    expect(describeTile(w.snapshot(), t)[0]).toBe("wheat — 0% grown");

    w.tileAt(t)!.crop = { item: "wheat", growth: Math.round(WHEAT_GROWTH_TICKS / 2) };
    expect(describeTile(w.snapshot(), t)[0]).toMatch(/wheat — 5[03]% grown/);
  });

  it("says ready rather than a percentage at maturity, and never exceeds 100", () => {
    const w = new World({ seed: 1 });
    const t = { x: 12, y: 12 };
    w.tileAt(t)!.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
    expect(describeTile(w.snapshot(), t)[0]).toBe("wheat — ready");

    w.tileAt(t)!.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS * 3 };
    expect(describeTile(w.snapshot(), t)[0]).toBe("wheat — ready");
  });

  it("describes a bot, what it carries, and what it is doing", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    bot.inventory = { wheat: 4 };
    const lines = describeTile(w.snapshot(), bot.pos);
    expect(lines[0]).toBe("Bot 1 — harvester");
    expect(lines[1]).toBe("  carrying 4 wheat");
    expect(lines[2]).toBe("  idle");
  });

  it("says a bot is carrying nothing rather than an empty list", () => {
    const w = new World({ seed: 1 });
    expect(describeTile(w.snapshot(), w.getBot(1).pos)[1]).toBe("  carrying nothing");
  });

  it("reports the action in progress with its remaining cost", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "move", dir: "east" });
    const lines = describeTile(w.snapshot(), w.getBot(1).pos);
    expect(lines[2]).toBe("  move east — 2 of 2 ticks left");
  });

  it("reports blocked states in preference to the action", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).modules.add("radio");
    w.issue(1, { kind: "receive" });
    ticks(w, 3);
    expect(describeTile(w.snapshot(), w.getBot(1).pos)[2]).toBe("  waiting for a message");
  });

  it("describes the console, its contents, and whether it is starved", () => {
    const w = new World({ seed: 1 });
    const at = { x: 16, y: 16 };
    expect(describeTile(w.snapshot(), at)).toEqual([
      "Research Console",
      "  holding nothing",
      "soil",
    ]);

    w.queueResearch("planter");
    ticks(w, 3);
    expect(describeTile(w.snapshot(), at)).toContain("  starved — nothing to consume");
  });

  it("lists a bot and the crop underneath it, bot first", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    w.tileAt(bot.pos)!.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
    const lines = describeTile(w.snapshot(), bot.pos);
    expect(lines[0]).toMatch(/^Bot 1/);
    expect(lines).toContain("wheat — ready");
    expect(lines.at(-1)).toBe("soil");
  });

  it("lists every installed module", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    bot.modules.add("planter");
    bot.modules.add("scanner");
    expect(describeTile(w.snapshot(), bot.pos)[0]).toBe("Bot 1 — harvester, planter, scanner");
  });
});

describe("describeTile on the new machines", () => {
  function milled(): World {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("mill");
    w.placeMachine("mill", { x: 18, y: 16 });
    return w;
  }

  it("calls a mill a Mill", () => {
    // The ternary this replaced called everything that was not a console a
    // Storage Crate, which would have labelled the mill and the oven wrongly
    // without failing anything.
    expect(describeTile(milled().snapshot(), { x: 18, y: 16 })[0]).toBe("Mill");
  });

  it("reports how far through a conversion it is", () => {
    const w = milled();
    w.machineAt({ x: 18, y: 16 })!.inventory = { wheat: 3 };
    ticks(w, 11);
    const lines = describeTile(w.snapshot(), { x: 18, y: 16 });
    expect(lines.some((l) => /working — \d+%/.test(l))).toBe(true);
  });

  it("says jammed rather than starved when it is both", () => {
    const w = milled();
    w.machineAt({ x: 18, y: 16 })!.inventory = { wheat: 3, flour: MACHINE_CAPACITY };
    ticks(w, 3);
    const lines = describeTile(w.snapshot(), { x: 18, y: 16 });
    expect(lines).toContain("  jammed — no room for the output");
    expect(lines).not.toContain("  starved — nothing to consume");
  });
});
