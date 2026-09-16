import { connectResize } from "../../src/render/stage";
import { World } from "../../src/sim/world";
import type { Geometry } from "../../src/render/geometry";
import type { WorldSnapshot } from "../../src/sim/types";

/**
 * The bug this file exists for: `stage.onResize` was a hook nobody assigned.
 *
 * `ActorLayer.resize` and `Hud.resize` both existed, both were dead, and after a
 * window resize the actor layer kept drawing at the tile size it had captured at
 * construction while the terrain redrew at the new one — bots and machines at
 * the wrong scale, in the wrong place, over correct ground.
 *
 * Pixi cannot be built in this environment, so the test is of the fan-out rather
 * than of the pixels: every layer that caches a fit is told about a new one.
 */
function fakes() {
  const calls: { layer: string; size: number; pane?: number }[] = [];
  const snapshot = new World({ seed: 1 }).snapshot();
  return {
    calls,
    snapshot,
    consumers: {
      tiles: {
        resize(g: Geometry, snap: WorldSnapshot) {
          calls.push({ layer: "tiles", size: g.size });
          // The tile layer rebuilds its crops against a snapshot; handing it a
          // stale or absent one would redraw an empty field.
          expect(snap).toBe(snapshot);
        },
      },
      actors: {
        resize(g: Geometry) {
          calls.push({ layer: "actors", size: g.size });
        },
      },
      hud: {
        resize(g: Geometry, pane: { width: number; height: number }) {
          calls.push({ layer: "hud", size: g.size, pane: pane.width });
        },
      },
      snapshot: () => snapshot,
      pane: () => ({ width: 800, height: 600 }),
    },
  };
}

const GEO: Geometry = { originX: 4, originY: 8, size: 20 };

describe("connectResize", () => {
  it("tells every layer that caches a fit about the new one", () => {
    const { calls, consumers } = fakes();
    const stage = { onResize: (_g: Geometry) => {} };
    connectResize(stage, consumers);

    stage.onResize(GEO);

    expect(calls.map((c) => c.layer).sort()).toEqual(["actors", "hud", "tiles"]);
    for (const call of calls) expect(call.size).toBe(20);
  });

  it("does nothing until the stage reports a resize", () => {
    const { calls, consumers } = fakes();
    const stage = { onResize: (_g: Geometry) => {} };
    connectResize(stage, consumers);
    expect(calls).toEqual([]);
  });

  it("reads the pane size at resize time rather than at wiring time", () => {
    // The renderer is resized before the hook fires, so a pane size captured
    // when the page was built is the old one by the time it is used.
    const { calls, consumers } = fakes();
    let width = 800;
    const stage = { onResize: (_g: Geometry) => {} };
    connectResize(stage, { ...consumers, pane: () => ({ width, height: 600 }) });

    width = 1200;
    stage.onResize(GEO);

    expect(calls.find((c) => c.layer === "hud")?.pane).toBe(1200);
  });

  it("passes the latest snapshot, not the one from when it was wired", () => {
    // Same hazard, and the one that would redraw an empty field: a snapshot
    // captured at wiring time is a world with no crops harvested and no
    // machines placed.
    const world = new World({ seed: 1 });
    const seen: WorldSnapshot[] = [];
    let latest = world.snapshot();
    const stage = { onResize: (_g: Geometry) => {} };
    connectResize(stage, {
      tiles: { resize: (_g, snap) => void seen.push(snap) },
      actors: { resize: () => {} },
      hud: { resize: () => {} },
      snapshot: () => latest,
      pane: () => ({ width: 800, height: 600 }),
    });

    world.tick();
    latest = world.snapshot();
    stage.onResize(GEO);

    expect(seen).toHaveLength(1);
    expect(seen[0]!.time).toBe(1);
  });
});
