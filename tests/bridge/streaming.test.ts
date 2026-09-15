import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import type { ScriptOutcome } from "../../src/bridge/host.ts";

describe("watching a script that never ends", () => {
  it("delivers logs while it is still running", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    const seen: string[] = [];
    let settled: ScriptOutcome | undefined;

    try {
      const running = colony.run(1, `
        let i = 0;
        while (true) { bot.log("tick " + i++); bot.wait(1); }
      `, {
        onLog: (m) => void seen.push(m),
        onSettle: (o) => { settled = o; },
      });
      void running.catch(() => {});

      // The point of the task: output is observable before the script ends,
      // and this script has no end.
      await vi.waitFor(() => expect(seen.length).toBeGreaterThan(2), { timeout: 10_000 });
      expect(seen[0]).toBe("tick 0");
      expect(settled).toBeUndefined();

      await colony.stop(1);
      expect((await running).status).toBe("stopped");
      expect(settled?.status).toBe("stopped");
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("settles once, with the first verdict reached", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    const verdicts: string[] = [];
    try {
      await colony.run(1, `bot.log("hello");`, {
        onSettle: (o) => void verdicts.push(o.status),
      });
      // run()'s own cleanup stops the bot; that must not settle a second time.
      expect(verdicts).toEqual(["done"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("still returns the batched logs for callers that wait", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await colony.run(1, `bot.log("a"); bot.log("b");`);
      expect(outcome.logs).toEqual(["a", "b"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);
});
