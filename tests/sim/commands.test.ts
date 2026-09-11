import { World } from "../../src/sim/world";
import { run } from "./helpers";

describe("command loop", () => {
  it("wait resolves after exactly the requested ticks", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "wait", ticks: 3 });
    expect(w.takeResult(1)).toBeNull();
    w.tick();
    expect(w.takeResult(1)).toBeNull();
    w.tick();
    expect(w.takeResult(1)).toBeNull();
    w.tick();
    expect(w.takeResult(1)).toEqual({ ok: true, value: undefined });
    expect(w.time).toBe(3);
  });

  it("takeResult clears the result", () => {
    const w = new World({ seed: 1 });
    run(w, 1, { kind: "wait", ticks: 1 });
    expect(w.takeResult(1)).toBeNull();
  });

  it("throws when issuing to a busy bot", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "wait", ticks: 5 });
    expect(() => w.issue(1, { kind: "wait", ticks: 1 })).toThrow("bot 1 is busy");
  });

  it("throws when issuing to an unknown bot", () => {
    const w = new World({ seed: 1 });
    expect(() => w.issue(99, { kind: "wait", ticks: 1 })).toThrow("no bot 99");
  });

  it("fails immediately when the bot lacks the required module", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "scan", radius: 1 });
    expect(w.takeResult(1)).toEqual({
      ok: false,
      error: "Bot 1 has no Scanner module",
    });
    expect(w.getBot(1).action).toBeNull();
  });
});
