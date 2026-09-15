import { heldMarks, markAlpha } from "../../src/render/marks";
import { World } from "../../src/sim/world";
import { run, ticks } from "../sim/helpers";

describe("markAlpha", () => {
  it("is fully opaque when new and gone when expired", () => {
    expect(markAlpha(0, 400)).toBe(1);
    expect(markAlpha(400, 400)).toBe(0);
  });

  it("never goes negative past the end", () => {
    // A frame can land long after a mark expired, and a negative alpha in Pixi
    // is not clamped for you.
    expect(markAlpha(10_000, 400)).toBe(0);
  });

  it("holds near-full before fading, so a short mark is actually seen", () => {
    expect(markAlpha(100, 400)).toBe(1);
    const mid = markAlpha(260, 400);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("decreases monotonically", () => {
    let last = Infinity;
    for (let age = 0; age <= 400; age += 10) {
      const a = markAlpha(age, 400);
      expect(a).toBeLessThanOrEqual(last);
      last = a;
    }
  });

  it("survives a zero lifetime without dividing by zero", () => {
    expect(markAlpha(0, 0)).toBe(0);
    expect(Number.isNaN(markAlpha(5, 0))).toBe(false);
  });
});

describe("heldMarks", () => {
  it("is empty for a world where nothing is wrong", () => {
    expect(heldMarks(new World({ seed: 1 }).snapshot())).toEqual([]);
  });

  it("marks a bot blocked by another bot, for as long as it is blocked", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const bot = w.getBot(1);
    bot.pos = { x: 20, y: 20 };
    w.deployBot({ x: 21, y: 20 });

    w.issue(1, { kind: "move", dir: "east" });
    ticks(w, 10);

    const marks = heldMarks(w.snapshot());
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ kind: "blockedBot", pos: { x: 20, y: 20 } });

    // Still held many ticks later: this is a state, not an instant.
    ticks(w, 40);
    expect(heldMarks(w.snapshot())).toHaveLength(1);
  });

  it("marks a bot waiting on a radio message", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).modules.add("radio");
    w.issue(1, { kind: "receive" });
    ticks(w, 5);
    expect(heldMarks(w.snapshot())[0]).toMatchObject({ kind: "blockedRadio" });
  });

  it("marks a starved console, and stops once it is fed", () => {
    const w = new World({ seed: 1 });
    w.queueResearch("planter");
    ticks(w, 3);
    expect(heldMarks(w.snapshot())).toHaveLength(1);
    expect(heldMarks(w.snapshot())[0]).toMatchObject({ kind: "starved", pos: { x: 16, y: 16 } });

    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 4 };
    ticks(w, 1);
    expect(heldMarks(w.snapshot())).toEqual([]);
  });

  it("gives every mark a stable key, so a held mark is not rebuilt each frame", () => {
    const w = new World({ seed: 1 });
    w.queueResearch("planter");
    ticks(w, 3);
    const first = heldMarks(w.snapshot()).map((m) => m.key);
    ticks(w, 5);
    expect(heldMarks(w.snapshot()).map((m) => m.key)).toEqual(first);
  });

  it("clears once the blocking bot moves away", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    w.getBot(1).pos = { x: 20, y: 20 };
    const other = w.deployBot({ x: 21, y: 20 });

    w.issue(1, { kind: "move", dir: "east" });
    ticks(w, 6);
    expect(heldMarks(w.snapshot())).toHaveLength(1);

    other.pos = { x: 25, y: 25 };
    ticks(w, 2);
    expect(heldMarks(w.snapshot())).toEqual([]);
    expect(w.getBot(1).pos).toEqual({ x: 21, y: 20 });
  });

  it("does not mark a bot that simply bumped a wall", () => {
    // A bump is an instant and belongs to the fading path; holding it would
    // leave a permanent mark on the edge of the world.
    const w = new World({ seed: 1 });
    w.getBot(1).pos = { x: 31, y: 16 };
    run(w, 1, { kind: "move", dir: "east" });
    expect(heldMarks(w.snapshot())).toEqual([]);
  });
});
