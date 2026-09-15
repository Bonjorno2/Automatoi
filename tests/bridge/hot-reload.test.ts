import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { ScriptColony as NeutralColony } from "../../src/bridge/colony.ts";
import type { SpawnWorker } from "../../src/bridge/spawn.ts";

interface FakeWorker {
  post: (m: unknown) => void;
  terminated: boolean;
}

/**
 * A worker whose `terminate()` resolves on a microtask, as a real web Worker's
 * does. Node's takes long enough to hide the ordering this file is about: the
 * outgoing run's cleanup landing *after* its replacement has registered.
 */
function fakeSpawner(): { spawn: SpawnWorker; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const spawn: SpawnWorker = () => {
    const fake: FakeWorker = { post: () => {}, terminated: false };
    workers.push(fake);
    return {
      onMessage: (fn) => { fake.post = fn; },
      onError: () => {},
      terminate: async () => { fake.terminated = true; },
    };
  };
  return { spawn, workers };
}

describe("hot reload lifecycle", () => {
  it("the outgoing run must not terminate its replacement's worker", async () => {
    const { spawn, workers } = fakeSpawner();
    const colony = new NeutralColony({ world: new World({ seed: 1 }), spawnWorker: spawn });

    // A script with no end: the fake never posts done.
    const first = colony.run(1, "forever");
    void first.catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    // Exactly what Ctrl+S does.
    await colony.stop(1);
    const second = colony.run(1, "replacement");
    void second.catch(() => {});

    // Give the outgoing run's cleanup every chance to fire late.
    await new Promise((r) => setTimeout(r, 50));

    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.terminated, "replacement was killed by its predecessor").toBe(false);

    workers[1]!.post({ kind: "done" });
    expect((await second).status).toBe("done");
    expect((await first).status).toBe("stopped");
  }, 20_000);
});

/** Exactly what the editor does on Ctrl+S, and what GameSession.runScript does. */
async function restart(
  colony: ScriptColony,
  botId: number,
  source: string,
  opts: Parameters<ScriptColony["run"]>[2] = {},
): ReturnType<ScriptColony["run"]> {
  await colony.stop(botId);
  return colony.run(botId, source, opts);
}

describe("hot reload", () => {
  it("does not let the outgoing run tear down its replacement", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      // A script with no end, as a player's script normally is.
      const first = colony.run(1, `while (true) { bot.move("east"); }`);
      void first.catch(() => {});
      await vi.waitFor(() => expect(colony.world.time).toBeGreaterThan(0), { timeout: 5000 });

      const logs: string[] = [];
      const outcome = await restart(
        colony, 1,
        `bot.log("a"); bot.wait(1); bot.log("b"); bot.wait(1); bot.log("survived");`,
        { onLog: (m) => void logs.push(m) },
      );

      expect(outcome.status).toBe("done");
      expect(logs).toEqual(["a", "b", "survived"]);
      expect((await first).status).toBe("stopped");
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("survives being restarted repeatedly mid-command", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      for (let i = 0; i < 4; i++) {
        const pending = restart(colony, 1, `while (true) { bot.move("east"); bot.move("west"); }`);
        void pending.then((o) => o).catch(() => {});
        await new Promise((r) => setTimeout(r, 60));
      }
      // The bot must still be usable after all that churn.
      const logs: string[] = [];
      const outcome = await restart(colony, 1, `bot.log("alive at " + bot.pos().x);`, {
        onLog: (m) => void logs.push(m),
      });
      expect(outcome.status).toBe("done");
      expect(logs[0]).toMatch(/^alive at \d+$/);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);
});
