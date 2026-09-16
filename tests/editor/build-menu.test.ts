import { buildOptions } from "../../src/editor/build-menu";
import { World } from "../../src/sim/world";

describe("buildOptions", () => {
  it("offers nothing before any research completes", () => {
    // The first ten minutes are unchanged: there is nothing to place yet, and
    // an empty menu says that more honestly than a menu of disabled buttons.
    expect(buildOptions(new World({ seed: 1 }).snapshot())).toEqual([]);
  });

  it("offers a machine once its research unlocks it", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("mill");
    const options = buildOptions(w.snapshot());
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "machine", machine: "mill", label: "Mill" });
  });

  it("keeps offering a machine after one is placed, because there is no build cost", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("mill");
    w.placeMachine("mill", { x: 20, y: 20 });
    // The assertion this makes is about the mill still being on offer. It was a
    // length of 1 until milestone 7's Task 0, when placing a machine started
    // also putting Remove in the list — which is the point of Remove, and not a
    // reason for this test to be about counting.
    expect(buildOptions(w.snapshot()).filter((o) => o.kind === "machine")).toMatchObject([
      { machine: "mill" },
    ]);
  });

  it("offers a spare module, and stops once it is fitted", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 1 };
    expect(buildOptions(w.snapshot())[0]).toMatchObject({ kind: "module", module: "planter" });
    w.installModule(1, "planter");
    expect(buildOptions(w.snapshot())).toEqual([]);
  });

  it("offers a spare chassis, and stops once it is deployed", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    expect(buildOptions(w.snapshot())[0]).toMatchObject({ kind: "chassis" });
    w.deployBot({ x: 20, y: 20 });
    expect(buildOptions(w.snapshot())).toEqual([]);
  });

  it("counts duplicates in the label rather than repeating the option", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { scanner: 3 };
    w.research.spareChassis = 2;
    const labels = buildOptions(w.snapshot()).map((o) => o.label);
    expect(labels).toEqual(["Fit scanner (3)", "Deploy bot (2)"]);
  });

  it("lists machines in research order, then modules, then the chassis", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("oven");
    w.research.unlocked.add("crate");
    w.research.spareModules = { planter: 1 };
    w.research.spareChassis = 1;
    expect(buildOptions(w.snapshot()).map((o) => o.kind)).toEqual([
      "machine",
      "machine",
      "module",
      "chassis",
    ]);
    expect(buildOptions(w.snapshot()).map((o) => o.label)[0]).toBe("Crate");
  });

  it("offers the conveyor, in the order it is researched", () => {
    // Belts are the first thing a player wants many of, so they arrive at the
    // end of the machine list rather than in the middle of it.
    const w = new World({ seed: 1 });
    for (const r of ["crate", "mill", "oven", "conveyor"] as const) w.research.unlocked.add(r);
    expect(buildOptions(w.snapshot()).map((o) => o.label)).toEqual([
      "Crate",
      "Mill",
      "Oven",
      "Conveyor",
    ]);
  });

  it("offers Remove only once there is something to remove", () => {
    // Milestone 7's Task 0. A world that has only its console in it has nothing
    // this mode could act on, and a tool that can do nothing is not an offer.
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    expect(buildOptions(w.snapshot()).some((o) => o.kind === "remove")).toBe(false);

    w.placeMachine("crate", { x: 20, y: 20 });
    expect(buildOptions(w.snapshot()).some((o) => o.kind === "remove")).toBe(true);

    w.removeMachine({ x: 20, y: 20 });
    expect(buildOptions(w.snapshot()).some((o) => o.kind === "remove")).toBe(false);
  });

  it("puts Remove last, because it is a tool and the rest is stock", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("mill");
    w.research.spareChassis = 1;
    w.placeMachine("mill", { x: 20, y: 20 });
    expect(buildOptions(w.snapshot()).map((o) => o.kind)).toEqual([
      "machine",
      "chassis",
      "remove",
    ]);
  });

  it("never offers the console", () => {
    const w = new World({ seed: 1 });
    for (const r of ["crate", "mill", "oven", "planter", "scanner", "chassis", "radio"] as const) {
      w.research.unlocked.add(r);
    }
    expect(buildOptions(w.snapshot()).some((o) => o.label.includes("Console"))).toBe(false);
  });
});

describe("the sim decides where things go, not the menu", () => {
  it("canPlace gives the same reason placeMachine throws", () => {
    // The ghost's colour and the click's outcome must be one rule asked twice.
    const w = new World({ seed: 1 });
    const cases: { kind: "mill" | "crate"; pos: { x: number; y: number } }[] = [
      { kind: "mill", pos: { x: 20, y: 20 } },
      { kind: "crate", pos: { x: 16, y: 16 } },
      { kind: "crate", pos: { x: -1, y: 5 } },
      { kind: "crate", pos: { x: 17, y: 16 } },
    ];
    for (const { kind, pos } of cases) {
      const reason = w.canPlace(kind, pos);
      if (reason === null) {
        expect(() => w.placeMachine(kind, pos)).not.toThrow();
      } else {
        expect(() => w.placeMachine(kind, pos)).toThrow(reason);
      }
    }
  });

  it("refuses the tile a bot is standing on", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    expect(w.canPlace("crate", w.getBot(1).pos)).toBe("tile occupied");
  });

  it("refuses out of bounds and an unresearched kind, in that order of specificity", () => {
    const w = new World({ seed: 1 });
    expect(w.canPlace("mill", { x: 20, y: 20 })).toBe("mill not researched");
    w.research.unlocked.add("mill");
    expect(w.canPlace("mill", { x: 99, y: 99 })).toBe("out of bounds");
    expect(w.canPlace("mill", { x: 20, y: 20 })).toBeNull();
  });

  it("canDeploy refuses without a spare chassis, then accepts a free tile", () => {
    const w = new World({ seed: 1 });
    expect(w.canDeploy({ x: 20, y: 20 })).toBe("no spare chassis");
    w.research.spareChassis = 1;
    expect(w.canDeploy({ x: 20, y: 20 })).toBeNull();
    expect(w.canDeploy({ x: 16, y: 16 })).toBe("tile occupied");
  });

  it("canRemove gives the same reason removeMachine throws", () => {
    // The remove ghost's colour and the click's outcome, one rule asked twice —
    // the same property canPlace carries above, for the mode that destroys
    // something rather than the one that builds it.
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    w.placeMachine("crate", { x: 20, y: 20 });
    for (const pos of [{ x: 20, y: 20 }, { x: 16, y: 16 }, { x: 2, y: 2 }]) {
      // "hands", because that is who the ghost belongs to. The arm's answers
      // are a different set and are tested where the arm is.
      const reason = w.canRemove(pos, "hands");
      if (reason === null) expect(() => w.removeMachine(pos)).not.toThrow();
      else expect(() => w.removeMachine(pos)).toThrow(reason);
    }
  });

  it("accepts grass as readily as soil", () => {
    // Machines are not crops. Refusing grass would quietly force every factory
    // into the 13x13 field, which is a layout rule nobody decided on.
    const w = new World({ seed: 1 });
    w.research.unlocked.add("mill");
    expect(w.canPlace("mill", { x: 2, y: 2 })).toBeNull();
  });
});
