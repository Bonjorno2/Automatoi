import { armedMessage, describePlacement, describeTile } from "../../src/render/inspector";
import { World } from "../../src/sim/world";
import { MACHINE_CAPACITY, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import type { Direction } from "../../src/sim/types";
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

  it("names which way a belt faces", () => {
    // The only thing a player can get wrong about a belt, and the arrow on a
    // twenty-pixel tile is small. A belt pointed into a mill instead of away
    // from it looks identical to one that works.
    const w = new World({ seed: 1 });
    w.research.unlocked.add("conveyor");
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "south");
    belt.inventory = { wheat: 2 };
    expect(describeTile(w.snapshot(), { x: 18, y: 18 })).toEqual([
      "Conveyor",
      "  facing south",
      "  holding 2 wheat",
      "soil",
    ]);
  });

  it("says nothing about facing for a machine that has no front", () => {
    const w = new World({ seed: 1 });
    expect(describeTile(w.snapshot(), { x: 16, y: 16 }).some((l) => l.includes("facing"))).toBe(
      false,
    );
  });
});

/**
 * Milestone 5's finding 2: placement stays armed after a click, which is right
 * for laying three crates in a row and wrong for the very next thing a player
 * does, which is hover the machine they just placed and see a ghost instead of
 * it. Staying armed is kept; what is fixed is that armed and inspecting were two
 * modes with no visible difference except the tooltip's wording.
 */
describe("describePlacement", () => {
  const armed = (label: string, facing: Direction | null, reason: string | null) => ({
    label,
    facing,
    reason,
  });

  it("says what is held and that a legal tile can take it", () => {
    const w = new World({ seed: 1 });
    expect(describePlacement(w.snapshot(), { x: 20, y: 20 }, armed("Place Crate", null, null)))
      .toEqual(["Place Crate", "  click to place"]);
  });

  it("carries the facing, because that is what the player is about to commit", () => {
    const w = new World({ seed: 1 });
    const lines = describePlacement(
      w.snapshot(),
      { x: 20, y: 20 },
      armed("Place Conveyor", "east", null),
    );
    expect(lines[0]).toBe("Place Conveyor (facing east)");
  });

  it("gives the sim's own refusal rather than a second opinion", () => {
    const w = new World({ seed: 1 });
    const lines = describePlacement(
      w.snapshot(),
      { x: 16, y: 16 },
      armed("Place Crate", null, "tile occupied"),
    );
    expect(lines[1]).toBe("  tile occupied");
  });

  it("describes the machine already there as well as the placement", () => {
    // The finding itself: hovering the mill you just placed should tell you
    // about the mill. Before this it told you only that the tile was occupied.
    const w = new World({ seed: 1 });
    w.research.unlocked.add("mill");
    const mill = w.placeMachine("mill", { x: 18, y: 18 });
    mill.inventory = { wheat: 2 };

    const lines = describePlacement(
      w.snapshot(),
      { x: 18, y: 18 },
      armed("Place Conveyor", "north", "tile occupied"),
    );
    // No starved line: the flag is set by a tick, and this world has not had
    // one. The point of the test is the two halves being present at once.
    expect(lines).toEqual([
      "Place Conveyor (facing north)",
      "  tile occupied",
      "Mill",
      "  holding 2 wheat",
      "soil",
    ]);
  });

  it("describes a bot standing in the way", () => {
    const w = new World({ seed: 1 });
    const lines = describePlacement(
      w.snapshot(),
      w.getBot(1).pos,
      armed("Place Crate", null, "tile occupied"),
    );
    expect(lines.some((l) => l.startsWith("Bot 1"))).toBe(true);
  });

  it("says nothing extra about ground the player could simply build on", () => {
    // Empty ground is unchanged: two lines, not a crop report the player did
    // not ask for while they are aiming at something.
    const w = new World({ seed: 1 });
    const lines = describePlacement(
      w.snapshot(),
      { x: 20, y: 20 },
      armed("Place Conveyor", "south", null),
    );
    expect(lines).toHaveLength(2);
  });
});

describe("armedMessage", () => {
  it("says what is held and how to stop holding it", () => {
    expect(armedMessage({ label: "Place Conveyor", facing: "north" })).toBe(
      "placing Conveyor (facing north) — R to turn, Esc to stop",
    );
  });

  it("offers no turn for a machine with no front", () => {
    expect(armedMessage({ label: "Place Crate", facing: null })).toBe(
      "placing Crate — Esc to stop",
    );
  });

  it("is nothing at all when nothing is held", () => {
    expect(armedMessage(null)).toBe("");
  });
});
