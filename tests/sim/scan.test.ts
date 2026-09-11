import { World } from "../../src/sim/world";
import type { ScanTile } from "../../src/sim/types";
import { run } from "./helpers";

function scannerWorld(): World {
  const w = new World({ seed: 1 });
  w.getBot(1).modules.add("scanner");
  return w;
}

describe("scan", () => {
  it("returns a full square of tiles for radius 1 in the interior", () => {
    const w = scannerWorld();
    const r = run(w, 1, { kind: "scan", radius: 1 });
    expect(r.ok).toBe(true);
    const tiles = (r as { ok: true; value: ScanTile[] }).value;
    expect(tiles).toHaveLength(9);
    const xs = tiles.map((t) => t.x);
    expect(Math.min(...xs)).toBe(16);
    expect(Math.max(...xs)).toBe(18);
  });

  it("reports the scanning bot and the adjacent console", () => {
    const w = scannerWorld();
    const r = run(w, 1, { kind: "scan", radius: 1 });
    const tiles = (r as { ok: true; value: ScanTile[] }).value;
    const self = tiles.find((t) => t.x === 17 && t.y === 16)!;
    expect(self.bot).toBe(1);
    expect(self.terrain).toBe("soil");
    const console = tiles.find((t) => t.x === 16 && t.y === 16)!;
    expect(console.machine).toBe("console");
    expect(console.bot).toBeNull();
  });

  it("returns copies, not live crop references", () => {
    const w = scannerWorld();
    const tile = w.tileAt({ x: 17, y: 16 })!;
    tile.crop = { item: "wheat", growth: 3 };
    const r = run(w, 1, { kind: "scan", radius: 0 });
    const scanned = (r as { ok: true; value: ScanTile[] }).value[0]!;
    scanned.crop!.growth = 999;
    expect(tile.crop.growth).not.toBe(999);
  });

  it("clips at the world edge", () => {
    const w = scannerWorld();
    w.getBot(1).pos = { x: 0, y: 0 };
    const r = run(w, 1, { kind: "scan", radius: 1 });
    expect((r as { ok: true; value: ScanTile[] }).value).toHaveLength(4);
  });

  it("errors without a scanner", () => {
    const w = new World({ seed: 1 });
    expect(run(w, 1, { kind: "scan", radius: 1 })).toEqual({
      ok: false,
      error: "Bot 1 has no Scanner module",
    });
  });
});
