import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { run, ticks } from "./helpers";

function radioWorld(): { w: World; a: number; b: number; c: number } {
  const w = new World({ seed: 1 });
  w.research.spareChassis = 2;
  const b = w.deployBot({ x: 18, y: 16 }).id;
  const c = w.deployBot({ x: 19, y: 16 }).id;
  w.getBot(1).modules.add("radio");
  w.getBot(b).modules.add("radio");
  // c has no radio
  return { w, a: 1, b, c };
}

describe("radio", () => {
  it("send delivers to every other radio bot and reports the count", () => {
    const { w, a, b, c } = radioWorld();
    const r = run(w, a, { kind: "send", channel: "haul", payload: { x: 4 } });
    expect(r).toEqual({ ok: true, value: 1 });
    expect(w.getBot(b).inbox).toEqual([{ channel: "haul", payload: { x: 4 }, from: a }]);
    expect(w.getBot(a).inbox).toEqual([]);
    expect(w.getBot(c).inbox).toEqual([]);
    expect(w.time).toBe(TICK_COST.send);
  });

  it("receive returns a queued message immediately", () => {
    const { w, a, b } = radioWorld();
    run(w, a, { kind: "send", channel: "haul", payload: 1 });
    const r = run(w, b, { kind: "receive" });
    expect(r).toEqual({ ok: true, value: { channel: "haul", payload: 1, from: a } });
    expect(w.getBot(b).inbox).toEqual([]);
  });

  it("receive blocks until a message arrives", () => {
    const { w, a, b } = radioWorld();
    w.issue(b, { kind: "receive" });
    ticks(w, 5);
    expect(w.takeResult(b)).toBeNull();
    expect(w.getBot(b).blockedOn).toBe("radio");

    run(w, a, { kind: "send", channel: "ping", payload: null });
    w.tick();
    expect(w.takeResult(b)).toEqual({
      ok: true,
      value: { channel: "ping", payload: null, from: a },
    });
    expect(w.getBot(b).blockedOn).toBeNull();
  });

  it("receive with a channel skips other channels", () => {
    const { w, a, b } = radioWorld();
    run(w, a, { kind: "send", channel: "other", payload: 0 });
    run(w, a, { kind: "send", channel: "want", payload: 1 });
    const r = run(w, b, { kind: "receive", channel: "want" });
    expect(r).toEqual({ ok: true, value: { channel: "want", payload: 1, from: a } });
    expect(w.getBot(b).inbox).toEqual([{ channel: "other", payload: 0, from: a }]);
  });

  it("errors without a radio", () => {
    const { w, c } = radioWorld();
    expect(run(w, c, { kind: "send", channel: "x", payload: 0 })).toEqual({
      ok: false,
      error: `Bot ${c} has no Radio module`,
    });
  });
});
