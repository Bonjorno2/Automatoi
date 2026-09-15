import { World } from "../../src/sim/world";
import { MACHINE_CAPACITY, RECIPE } from "../../src/sim/config";
import type { MachineKind, Machine } from "../../src/sim/types";
import { run, ticks } from "./helpers";

/** A world with one machine of `kind` beside the bot, and nothing else new. */
function withMachine(kind: MachineKind): { w: World; m: Machine } {
  const w = new World({ seed: 1 });
  w.research.unlocked.add(kind === "mill" ? "mill" : kind === "oven" ? "oven" : "crate");
  const m = w.placeMachine(kind, { x: 18, y: 16 });
  w.drainEvents();
  return { w, m };
}

const jams = (w: World): number => w.drainEvents().filter((e) => e.kind === "jammed").length;
const starves = (w: World): number => w.drainEvents().filter((e) => e.kind === "starved").length;

describe("a mill", () => {
  it("turns three wheat into one flour, in exactly the recipe's ticks", () => {
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 3 };

    ticks(w, RECIPE.mill!.ticks);
    expect(m.inventory.flour ?? 0).toBe(0);
    ticks(w, 2);
    expect(m.inventory).toEqual({ flour: 1 });
  });

  it("consumes the input at the start, not at the end", () => {
    // Otherwise a machine holds both its input and its output for the whole
    // conversion, and a capacity check has to guess which it is looking at.
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 3 };
    ticks(w, 2);
    expect(m.inventory.wheat ?? 0).toBe(0);
    expect(m.inventory.flour ?? 0).toBe(0);
  });

  it("keeps converting while it has input", () => {
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 9 };
    ticks(w, RECIPE.mill!.ticks * 3 + 6);
    expect(m.inventory).toEqual({ flour: 3 });
  });

  it("starves on too little input, once rather than once per tick", () => {
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 2 };
    ticks(w, 40);
    expect(starves(w)).toBe(1);
    expect(m.inventory).toEqual({ wheat: 2 });
  });

  it("stops starving once it is fed", () => {
    const { w, m } = withMachine("mill");
    ticks(w, 5);
    expect(w.snapshot().machines.find((x) => x.kind === "mill")!.starved).toBe(true);
    m.inventory = { wheat: 3 };
    ticks(w, 2);
    expect(w.snapshot().machines.find((x) => x.kind === "mill")!.starved).toBe(false);
  });
});

describe("an oven", () => {
  it("turns two flour into one bread", () => {
    const { w, m } = withMachine("oven");
    m.inventory = { flour: 2 };
    ticks(w, RECIPE.oven!.ticks + 2);
    expect(m.inventory).toEqual({ bread: 1 });
  });

  it("will not accept wheat as a substitute for flour", () => {
    const { w, m } = withMachine("oven");
    m.inventory = { wheat: 20 };
    ticks(w, RECIPE.oven!.ticks + 2);
    expect(m.inventory).toEqual({ wheat: 20 });
    expect(starves(w)).toBe(1);
  });
});

describe("jamming", () => {
  it("refuses to start when the output has nowhere to go", () => {
    // The input must survive. A machine that eats its input and then discovers
    // it cannot store the result has destroyed the player's harvest.
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 3, flour: MACHINE_CAPACITY };
    ticks(w, RECIPE.mill!.ticks + 5);
    expect(m.inventory.wheat).toBe(3);
    expect(m.inventory.flour).toBe(MACHINE_CAPACITY);
  });

  it("emits jammed once, not once per tick", () => {
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 3, flour: MACHINE_CAPACITY };
    ticks(w, 40);
    expect(jams(w)).toBe(1);
  });

  it("is reachable by simply not collecting the output", () => {
    // The case the design cares about, and the one a shared total capacity made
    // impossible: every recipe here is net-negative in item count, so a machine
    // can only back up if its output is counted on its own.
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: MACHINE_CAPACITY };
    for (let i = 0; i < 40; i++) {
      ticks(w, RECIPE.mill!.ticks + 2);
      m.inventory.wheat = MACHINE_CAPACITY; // a diligent bot, a forgetful player
    }
    expect(m.inventory.flour).toBe(MACHINE_CAPACITY);
    expect(w.snapshot().machines.find((x) => x.kind === "mill")!.jammed).toBe(true);
  });

  it("is not jammed merely for being full of its own input", () => {
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: MACHINE_CAPACITY };
    ticks(w, 3);
    expect(jams(w)).toBe(0);
    expect(m.inventory.wheat).toBe(MACHINE_CAPACITY - 3);
  });

  it("stops claiming to be jammed once it is merely empty", () => {
    // Found by playing, not by arguing. A jammed mill that is then emptied is
    // starved; leaving the older flag set made the inspector report "holding
    // nothing — jammed — no room for the output".
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 3, flour: MACHINE_CAPACITY };
    ticks(w, 3);
    expect(w.snapshot().machines.find((x) => x.kind === "mill")!.jammed).toBe(true);

    m.inventory = {};
    ticks(w, 2);
    const mill = w.snapshot().machines.find((x) => x.kind === "mill")!;
    expect(mill.jammed).toBe(false);
    expect(mill.starved).toBe(true);
  });

  it("clears once there is room again", () => {
    const { w, m } = withMachine("mill");
    m.inventory = { wheat: 3, flour: MACHINE_CAPACITY };
    ticks(w, 5);
    expect(w.snapshot().machines.find((x) => x.kind === "mill")!.jammed).toBe(true);
    m.inventory = { wheat: 3 };
    ticks(w, RECIPE.mill!.ticks + 5);
    expect(w.snapshot().machines.find((x) => x.kind === "mill")!.jammed).toBe(false);
    expect(m.inventory).toEqual({ flour: 1 });
  });
});

describe("machines without a recipe", () => {
  it("leaves the console and the crate alone", () => {
    const { w, m } = withMachine("crate");
    m.inventory = { wheat: 5 };
    const console = w.machineAt({ x: 16, y: 16 })!;
    console.inventory = { wheat: 5 };
    ticks(w, 50);
    expect(m.inventory).toEqual({ wheat: 5 });
    expect(console.inventory).toEqual({ wheat: 5 });
    expect(jams(w)).toBe(0);
  });
});

describe("depositing into a machine with limited room", () => {
  it("transfers what fits and leaves the rest with the bot", () => {
    const { w, m } = withMachine("crate");
    m.inventory = { wheat: MACHINE_CAPACITY - 2 };
    const bot = w.getBot(1);
    bot.pos = { x: 17, y: 16 };
    bot.inventory = { wheat: 5 };

    expect(run(w, 1, { kind: "deposit", dir: "east", item: "wheat", count: 5 })).toEqual({
      ok: true,
      value: 2,
    });
    expect(bot.inventory).toEqual({ wheat: 3 });
  });

  it("counts room per item, so a crate full of wheat still accepts bread", () => {
    const { w, m } = withMachine("crate");
    m.inventory = { wheat: MACHINE_CAPACITY };
    const bot = w.getBot(1);
    bot.pos = { x: 17, y: 16 };
    bot.inventory = { bread: 4 };
    expect(run(w, 1, { kind: "deposit", dir: "east", item: "bread", count: 4 })).toEqual({
      ok: true,
      value: 4,
    });
  });

  it("transfers nothing into a machine full of that item, and says so with a zero", () => {
    const { w, m } = withMachine("crate");
    m.inventory = { wheat: MACHINE_CAPACITY };
    const bot = w.getBot(1);
    bot.pos = { x: 17, y: 16 };
    bot.inventory = { wheat: 5 };

    expect(run(w, 1, { kind: "deposit", dir: "east", item: "wheat", count: 5 })).toEqual({
      ok: true,
      value: 0,
    });
    expect(bot.inventory).toEqual({ wheat: 5 });
  });
});

describe("determinism", () => {
  it("survives machines that convert", () => {
    const build = (): World => {
      const w = new World({ seed: 21 });
      w.research.unlocked.add("mill");
      w.placeMachine("mill", { x: 18, y: 16 }).inventory = { wheat: 12 };
      ticks(w, 80);
      return w;
    };
    expect(build().snapshot()).toEqual(build().snapshot());
  });
});
