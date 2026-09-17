import { World } from "../../src/sim/world";
import { BOT_CAPACITY, RESEARCH_COST, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import type { WorldEvent } from "../../src/sim/events";
import { run, ticks } from "./helpers";

/** Drain, then keep only the kinds asked about. Most tests care about one. */
function drain(w: World, ...kinds: WorldEvent["kind"][]): WorldEvent[] {
  const all = w.drainEvents();
  return kinds.length ? all.filter((e) => kinds.includes(e.kind)) : all;
}

function botAt(w: World, x: number, y: number): void {
  const bot = w.getBot(1);
  bot.pos = { x, y };
  bot.action = null;
  bot.result = null;
}

describe("bump", () => {
  it("fires when a bot walks into the edge of the world", () => {
    const w = new World({ seed: 1 });
    botAt(w, 31, 16);
    w.drainEvents();
    expect(run(w, 1, { kind: "move", dir: "east" })).toEqual({ ok: true, value: false });

    const events = drain(w, "bump");
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ kind: "bump", botId: 1, pos: { x: 31, y: 16 }, dir: "east" });
  });

  it("fires when a bot walks into the Research Console", () => {
    // Milestone 3's finding 3: the obvious way home runs into the console and
    // spins there forever, making world calls the whole time so the watchdog
    // correctly never fires.
    const w = new World({ seed: 1 });
    botAt(w, 15, 16);
    w.drainEvents();
    expect(run(w, 1, { kind: "move", dir: "east" })).toEqual({ ok: true, value: false });
    expect(drain(w, "bump")).toHaveLength(1);
  });

  it("fires once per refused move, so a spinning loop reports every attempt", () => {
    const w = new World({ seed: 1 });
    botAt(w, 31, 16);
    w.drainEvents();
    for (let i = 0; i < 3; i++) run(w, 1, { kind: "move", dir: "east" });
    expect(drain(w, "bump")).toHaveLength(3);
  });

  it("does not fire for a move that works", () => {
    const w = new World({ seed: 1 });
    botAt(w, 20, 20);
    w.drainEvents();
    run(w, 1, { kind: "move", dir: "east" });
    expect(drain(w, "bump")).toEqual([]);
  });
});

describe("refused", () => {
  it("fires when harvesting a tile with nothing on it", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    w.tileAt(bot.pos)!.crop = null;
    w.drainEvents();
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });

    const events = drain(w, "refused");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "refused", botId: 1, command: "harvest" });
  });

  it("fires when harvesting a crop that is not ready", () => {
    // Deliberately far from maturity: harvest takes 3 ticks and crops grow
    // during them, so a crop one tick short of ripe ripens mid-harvest and
    // succeeds. That is correct sim behaviour and it ate the first draft of
    // this test.
    const w = new World({ seed: 1 });
    w.tileAt(w.getBot(1).pos)!.crop = { item: "wheat", growth: 3 };
    w.drainEvents();
    run(w, 1, { kind: "harvest" });
    expect(drain(w, "refused")).toHaveLength(1);
    expect(w.tileAt(w.getBot(1).pos)!.crop!.growth).toBeLessThan(WHEAT_GROWTH_TICKS);
  });

  it("fires when planting is refused, whichever way it is refused", () => {
    for (const setup of ["grass", "occupied", "no seed"] as const) {
      const w = new World({ seed: 1 });
      const bot = w.getBot(1);
      bot.modules.add("planter");
      bot.inventory = { wheat: 2 };
      const tile = w.tileAt(bot.pos)!;
      tile.crop = null;
      if (setup === "grass") tile.terrain = "grass";
      if (setup === "occupied") tile.crop = { item: "wheat", growth: 0 };
      if (setup === "no seed") bot.inventory = {};
      w.drainEvents();

      run(w, 1, { kind: "plant", item: "wheat" });
      expect(drain(w, "refused"), setup).toHaveLength(1);
    }
  });

  it("does not fire for a harvest that works", () => {
    const w = new World({ seed: 1 });
    w.tileAt(w.getBot(1).pos)!.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
    w.drainEvents();
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: true });
    expect(drain(w, "refused")).toEqual([]);
  });
});

describe("full", () => {
  it("fires when a bot harvests with no room left", () => {
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    bot.inventory = { wheat: BOT_CAPACITY };
    w.tileAt(bot.pos)!.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
    w.drainEvents();
    // The event is the point of this test and it still fires. Milestone 10 made
    // the outcome a refusal rather than an error, which makes the event *more*
    // load-bearing: it is now the whole of the world-side signal.
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });
    expect(drain(w, "full")).toHaveLength(1);
  });
});

describe("blocked", () => {
  it("fires once when two bots want one tile, not once per tick of waiting", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    botAt(w, 20, 20);
    w.deployBot({ x: 21, y: 20 });
    w.drainEvents();

    w.issue(1, { kind: "move", dir: "east" });
    ticks(w, 12); // far longer than the move costs
    const events = drain(w, "blocked");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "blocked", botId: 1, on: "bot" });
  });

  it("fires once for a radio receive that nobody answers", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).modules.add("radio");
    w.drainEvents();
    w.issue(1, { kind: "receive" });
    ticks(w, 20);
    const events = drain(w, "blocked");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ on: "radio" });
  });
});

describe("starved", () => {
  it("fires when research is queued and the console has nothing to eat", () => {
    // Before this event a player could queue the planter, forget to deliver,
    // and watch a progress bar that never moved with nothing on screen saying
    // why. That is the same silent failure as walking into a wall.
    const w = new World({ seed: 1 });
    w.queueResearch("planter");
    w.drainEvents();
    ticks(w, 30);

    const events = drain(w, "starved");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "starved" });
  });

  it("does not fire while the console has input", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 5 };
    w.queueResearch("planter");
    w.drainEvents();
    ticks(w, 4);
    expect(drain(w, "starved")).toEqual([]);
  });

  it("does not fire when nothing is queued", () => {
    const w = new World({ seed: 1 });
    w.drainEvents();
    ticks(w, 30);
    expect(drain(w, "starved")).toEqual([]);
  });

  it("fires again after being fed and starving a second time", () => {
    const w = new World({ seed: 1 });
    const console = w.machineAt({ x: 16, y: 16 })!;
    w.queueResearch("planter");
    ticks(w, 2);
    w.drainEvents();

    console.inventory = { wheat: 2 };
    ticks(w, 2); // eats both
    expect(drain(w, "starved")).toEqual([]);
    ticks(w, 2); // and starves again
    expect(drain(w, "starved")).toHaveLength(1);
  });
});

describe("research", () => {
  it("fires when a research completes", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: RESEARCH_COST.planter };
    w.queueResearch("planter");
    w.drainEvents();
    ticks(w, RESEARCH_COST.planter + 1);

    const events = drain(w, "research");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "research", name: "planter", pos: { x: 16, y: 16 } });
  });
});

describe("the event list", () => {
  it("is emptied by draining", () => {
    const w = new World({ seed: 1 });
    botAt(w, 31, 16);
    run(w, 1, { kind: "move", dir: "east" });
    expect(w.drainEvents().length).toBeGreaterThan(0);
    expect(w.drainEvents()).toEqual([]);
  });

  it("drops the oldest rather than growing without a consumer", () => {
    // A headless test drains never. An uncapped list would grow for as long as
    // the test ran.
    const w = new World({ seed: 1 });
    botAt(w, 31, 16);
    for (let i = 0; i < 200; i++) run(w, 1, { kind: "move", dir: "east" });
    const events = w.drainEvents();
    expect(events.length).toBeLessThanOrEqual(64);
    expect(events.length).toBeGreaterThan(0);
  });

  it("is not part of a snapshot, so determinism is unaffected", () => {
    const a = new World({ seed: 7 });
    const b = new World({ seed: 7 });
    botAt(a, 31, 16);
    botAt(b, 31, 16);
    for (let i = 0; i < 5; i++) run(a, 1, { kind: "move", dir: "east" });
    for (let i = 0; i < 5; i++) run(b, 1, { kind: "move", dir: "east" });
    a.drainEvents(); // drained on one, left on the other
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(JSON.stringify(a.snapshot())).not.toContain("bump");
  });
});
