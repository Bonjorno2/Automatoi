import { World } from "../../src/sim/world";
import { BOT_CAPACITY, TICK_COST } from "../../src/sim/config";
import { run } from "./helpers";

describe("deposit", () => {
  it("moves items into the adjacent console", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: 4 };
    const r = run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 3 });
    expect(r).toEqual({ ok: true, value: 3 });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({ wheat: 3 });
    expect(w.time).toBe(TICK_COST.deposit);
  });

  it("caps at what the bot holds", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: 2 };
    const r = run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 2 });
    expect(w.getBot(1).inventory).toEqual({});
  });

  it("errors when there is no machine in that direction", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: 1 };
    const r = run(w, 1, { kind: "deposit", dir: "east", item: "wheat", count: 1 });
    expect(r).toEqual({ ok: false, error: "no machine to the east" });
  });
});

describe("withdraw", () => {
  it("pulls items out of the adjacent machine", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 5 };
    const r = run(w, 1, { kind: "withdraw", dir: "west", item: "wheat", count: 2 });
    expect(r).toEqual({ ok: true, value: 2 });
    expect(w.getBot(1).inventory).toEqual({ wheat: 2 });
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({ wheat: 3 });
  });

  it("caps at remaining bot capacity", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 50 };
    w.getBot(1).inventory = { wheat: BOT_CAPACITY - 3 };
    const r = run(w, 1, { kind: "withdraw", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 3 });
    expect(w.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
  });

  it("caps at what the machine holds", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 1 };
    const r = run(w, 1, { kind: "withdraw", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 1 });
  });
});

describe("placeMachine", () => {
  it("places a crate once research is unlocked", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    const crate = w.placeMachine("crate", { x: 17, y: 17 });
    expect(crate.kind).toBe("crate");
    expect(w.machineAt({ x: 17, y: 17 })).toBe(crate);
    expect(w.tileAt({ x: 17, y: 17 })!.crop).toBeNull();
  });

  it("refuses a crate before research", () => {
    const w = new World({ seed: 1 });
    expect(() => w.placeMachine("crate", { x: 17, y: 17 })).toThrow("crate not researched");
  });

  it("refuses a second console", () => {
    const w = new World({ seed: 1 });
    expect(() => w.placeMachine("console", { x: 17, y: 17 })).toThrow("cannot place a second console");
  });

  it("refuses an occupied tile", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    expect(() => w.placeMachine("crate", { x: 17, y: 16 })).toThrow("tile occupied");
  });
});
