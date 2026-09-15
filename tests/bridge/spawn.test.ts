import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/colony.ts";
import type { SpawnWorker } from "../../src/bridge/spawn.ts";

const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));

/**
 * Walk the runtime import graph from an entry file. Type-only imports are
 * skipped: they are erased before anything tries to resolve them, which is why
 * milestone 2's import rule exempts them.
 */
function runtimeImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const specifiers = new Set<string>();

  const visit = (file: string): void => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^\s*import\s+(type\s+)?[^"']*from\s*["']([^"']+)["']/gm)) {
      const [, typeOnly, spec] = m;
      if (typeOnly || !spec) continue;
      specifiers.add(spec);
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      visit(base.endsWith(".ts") ? base : `${base}.ts`);
    }
  };

  visit(entry);
  return specifiers;
}

describe("the worker seam", () => {
  it("the host never reaches past the WorkerHandle interface", async () => {
    const spawned: number[] = [];
    let terminated = false;

    const fakeSpawn: SpawnWorker = (init) => {
      spawned.push(init.botId);
      let onMessage = (_m: unknown): void => {};
      // Queued now, delivered after run() subscribes on the next microtask.
      queueMicrotask(() => onMessage({ kind: "log", message: `bot ${init.botId}` }));
      queueMicrotask(() => onMessage({ kind: "done" }));
      return {
        onMessage: (fn) => { onMessage = fn; },
        onError: () => {},
        terminate: async () => { terminated = true; },
      };
    };

    const colony = new ScriptColony({ world: new World({ seed: 1 }), spawnWorker: fakeSpawn });
    const outcome = await colony.run(1, "// never actually executed");

    expect(spawned).toEqual([1]);
    expect(outcome.status).toBe("done");
    expect(outcome.logs).toEqual(["bot 1"]);
    expect(terminated).toBe(true);
  }, 20_000);

  it("the browser's import graph is free of node builtins", () => {
    for (const entry of ["bridge/colony.ts", "bridge/spawn.web.ts", "bridge/worker-entry.web.ts"]) {
      const specifiers = runtimeImports(resolve(srcDir, entry));
      const builtins = [...specifiers].filter((s) => s.startsWith("node:"));
      expect(builtins, `${entry} must not reach a node builtin`).toEqual([]);
    }
  });

  it("the node graph is the one that owns worker_threads", () => {
    const specifiers = runtimeImports(resolve(srcDir, "bridge/host.ts"));
    expect([...specifiers]).toContain("node:worker_threads");
  });
});
