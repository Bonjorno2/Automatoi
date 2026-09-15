import { fit, toCentre, toPixel, toTile } from "../../src/render/geometry";

const GRID = { width: 32, height: 32 };

describe("fit", () => {
  it("scales a square grid to a square pane", () => {
    const g = fit(GRID, { width: 640, height: 640 });
    expect(g.size).toBe(20);
    expect(g.originX).toBe(0);
    expect(g.originY).toBe(0);
  });

  it("centres horizontally in a wide pane", () => {
    const g = fit(GRID, { width: 900, height: 640 });
    // Height is the binding constraint, so the grid is 640 wide in a 900 pane.
    expect(g.size).toBe(20);
    expect(g.originX).toBe(130);
    expect(g.originY).toBe(0);
  });

  it("centres vertically in a tall pane", () => {
    const g = fit(GRID, { width: 640, height: 900 });
    expect(g.size).toBe(20);
    expect(g.originX).toBe(0);
    expect(g.originY).toBe(130);
  });

  it("uses a whole number of pixels per tile", () => {
    // 600 / 32 is 18.75. A fractional tile leaves seams between adjacent
    // rectangles, so the fit rounds down and letterboxes the remainder.
    const g = fit(GRID, { width: 600, height: 600 });
    expect(g.size).toBe(18);
    expect(g.originX).toBe((600 - 18 * 32) / 2);
  });

  it("keeps the origin on a whole pixel", () => {
    // Caught on the real page: an odd leftover centres to a half pixel, which
    // offsets the whole field off the device grid and softens every edge.
    const g = fit(GRID, { width: 641, height: 640 });
    expect(g.size).toBe(20);
    expect(Number.isInteger(g.originX)).toBe(true);
    expect(g.originX).toBe(0);
  });

  it("handles a non-square grid", () => {
    const g = fit({ width: 40, height: 20 }, { width: 400, height: 400 });
    expect(g.size).toBe(10);
    expect(g.originX).toBe(0);
    expect(g.originY).toBe(100);
  });

  it("produces no NaN or Infinity for a degenerate pane", () => {
    for (const pane of [
      { width: 0, height: 0 },
      { width: 0, height: 500 },
      { width: 500, height: 0 },
      { width: -10, height: -10 },
    ]) {
      const g = fit(GRID, pane);
      expect(Number.isFinite(g.size)).toBe(true);
      expect(Number.isFinite(g.originX)).toBe(true);
      expect(Number.isFinite(g.originY)).toBe(true);
      expect(g.size).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces no NaN for a degenerate grid", () => {
    const g = fit({ width: 0, height: 0 }, { width: 640, height: 640 });
    expect(Number.isFinite(g.size)).toBe(true);
    expect(Number.isFinite(g.originX)).toBe(true);
  });
});

describe("toPixel", () => {
  it("maps tile 0,0 to the origin", () => {
    const g = fit(GRID, { width: 900, height: 640 });
    expect(toPixel(g, { x: 0, y: 0 })).toEqual({ x: g.originX, y: g.originY });
  });

  it("advances by one tile size per tile", () => {
    const g = fit(GRID, { width: 640, height: 640 });
    expect(toPixel(g, { x: 3, y: 2 })).toEqual({ x: 60, y: 40 });
  });

  it("accepts fractional tiles, which is what interpolation produces", () => {
    const g = fit(GRID, { width: 640, height: 640 });
    expect(toPixel(g, { x: 3.5, y: 2 })).toEqual({ x: 70, y: 40 });
  });
});

describe("toCentre", () => {
  it("is half a tile past the corner", () => {
    const g = fit(GRID, { width: 640, height: 640 });
    expect(toCentre(g, { x: 0, y: 0 })).toEqual({ x: 10, y: 10 });
    expect(toCentre(g, { x: 3, y: 2 })).toEqual({ x: 70, y: 50 });
  });
});

describe("toTile", () => {
  it("round-trips every corner of the grid", () => {
    const g = fit(GRID, { width: 900, height: 700 });
    for (const t of [
      { x: 0, y: 0 },
      { x: 31, y: 0 },
      { x: 0, y: 31 },
      { x: 31, y: 31 },
      { x: 16, y: 16 },
    ]) {
      expect(toTile(g, GRID, toCentre(g, t))).toEqual(t);
    }
  });

  it("returns null in the letterbox rather than clamping to an edge tile", () => {
    const g = fit(GRID, { width: 900, height: 640 });
    expect(g.originX).toBeGreaterThan(0);
    expect(toTile(g, GRID, { x: 5, y: 300 })).toBeNull();
    expect(toTile(g, GRID, { x: 895, y: 300 })).toBeNull();
  });

  it("returns null above and below the grid", () => {
    const g = fit(GRID, { width: 640, height: 900 });
    expect(toTile(g, GRID, { x: 300, y: 5 })).toBeNull();
    expect(toTile(g, GRID, { x: 300, y: 895 })).toBeNull();
  });

  it("includes the top-left pixel of a tile and excludes the next one", () => {
    const g = fit(GRID, { width: 640, height: 640 });
    expect(toTile(g, GRID, { x: 20, y: 20 })).toEqual({ x: 1, y: 1 });
    expect(toTile(g, GRID, { x: 39.9, y: 39.9 })).toEqual({ x: 1, y: 1 });
    expect(toTile(g, GRID, { x: 40, y: 40 })).toEqual({ x: 2, y: 2 });
  });

  it("returns null rather than dividing by a zero tile size", () => {
    const g = fit(GRID, { width: 0, height: 0 });
    expect(toTile(g, GRID, { x: 0, y: 0 })).toBeNull();
  });
});
