import { World } from "../../src/sim/world";
import { run } from "./helpers";

describe("installing a module", () => {
  it("adds the module and spends the spare", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 2 };
    w.installModule(1, "planter");
    expect(w.getBot(1).modules.has("planter")).toBe(true);
    expect(w.research.spareModules.planter).toBe(1);
  });

  it("makes the module's verb work, which is the whole point", () => {
    // Milestone 3's finding 1: research completed into a void because nothing
    // could fit what it produced, so four snippet chips could never run.
    const w = new World({ seed: 1 });
    const bot = w.getBot(1);
    bot.inventory = { wheat: 1 };
    w.tileAt(bot.pos)!.crop = null;

    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({
      ok: false,
      error: "Bot 1 has no Planter module",
    });

    w.research.spareModules = { planter: 1 };
    w.installModule(1, "planter");
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: true });
  });

  it("refuses a second copy, and spends nothing doing so", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 2 };
    w.installModule(1, "planter");
    expect(() => w.installModule(1, "planter")).toThrow("already has planter");
    expect(w.research.spareModules.planter).toBe(1);
  });

  it("refuses without a spare", () => {
    const w = new World({ seed: 1 });
    expect(() => w.installModule(1, "scanner")).toThrow("no spare scanner module");
  });

  it("refuses for a bot that does not exist", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { scanner: 1 };
    expect(() => w.installModule(99, "scanner")).toThrow("no bot 99");
    expect(w.research.spareModules.scanner).toBe(1);
  });

  it("fits to the bot asked for, not to the first one", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const second = w.deployBot({ x: 20, y: 20 });
    w.research.spareModules = { scanner: 1 };
    w.installModule(second.id, "scanner");

    expect(second.modules.has("scanner")).toBe(true);
    expect(w.getBot(1).modules.has("scanner")).toBe(false);
  });
});

describe("deploying the second bot", () => {
  it("spends the chassis and starts with a harvester", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const bot = w.deployBot({ x: 20, y: 20 });

    expect(bot.modules.has("harvester")).toBe(true);
    expect(bot.id).not.toBe(1);
    expect(w.research.spareChassis).toBe(0);
    expect(w.bots.size).toBe(2);
  });

  it("can be driven independently of the first", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const second = w.deployBot({ x: 20, y: 20 });

    w.issue(1, { kind: "move", dir: "north" });
    w.issue(second.id, { kind: "move", dir: "south" });
    for (let i = 0; i < 3; i++) w.tick();

    expect(w.getBot(1).pos).toEqual({ x: 17, y: 15 });
    expect(w.getBot(second.id).pos).toEqual({ x: 20, y: 21 });
  });

  it("refuses an occupied tile without spending the chassis", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    expect(() => w.deployBot({ x: 16, y: 16 })).toThrow("tile occupied");
    expect(w.research.spareChassis).toBe(1);
  });
});
