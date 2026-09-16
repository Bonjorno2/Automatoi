import {
  ZOOM,
  clampView,
  fitView,
  minSize,
  panBy,
  viewGeometry,
  zoomAbout,
  zoomedSize,
  type View,
} from "../../src/render/camera";
import { fit, toTile } from "../../src/render/geometry";

const GRID = { width: 32, height: 32 };
const PANE = { width: 653, height: 900 };

describe("the default path is provably unchanged", () => {
  it("reproduces fit exactly at zoom 1 with no pan", () => {
    // Decision 5 rests on this: every layer consumes a Geometry, so if the
    // camera's identity view is not `fit` to the pixel, the camera has changed
    // what the game looks like before anyone has touched it.
    for (const pane of [PANE, { width: 351, height: 768 }, { width: 1200, height: 400 }]) {
      expect(viewGeometry(fitView(GRID, pane), GRID, pane)).toEqual(fit(GRID, pane));
    }
  });

  it("sends Home back to exactly that view from anywhere", () => {
    let view = fitView(GRID, PANE);
    view = zoomAbout(view, GRID, PANE, { x: 120, y: 300 }, 4);
    view = panBy(view, GRID, PANE, -80, 40);
    expect(view).not.toEqual(fitView(GRID, PANE));
    expect(viewGeometry(fitView(GRID, PANE), GRID, PANE)).toEqual(fit(GRID, PANE));
  });

  it("survives the degenerate pane the page really lays out at startup", () => {
    const pane = { width: 0, height: 0 };
    expect(viewGeometry(fitView(GRID, pane), GRID, pane)).toEqual(fit(GRID, pane));
    expect(viewGeometry(fitView({ width: 0, height: 0 }, PANE), { width: 0, height: 0 }, PANE))
      .toEqual({ size: 0, originX: 0, originY: 0 });
  });
});

describe("zooming about a point", () => {
  it("keeps what is under the cursor under the cursor, once there is room to", () => {
    // The whole reason zoom takes a pixel rather than a level. One pixel of
    // slack, because both the size and the origin are whole numbers — the same
    // rounding `fit` already chose and for the same reason.
    //
    // "Once there is room" is not a hedge: the clamp and this property are in
    // genuine conflict, and the clamp wins. See the test below.
    let view = fitView(GRID, PANE);
    for (let i = 0; i < 6; i++) view = zoomAbout(view, GRID, PANE, { x: 326, y: 450 }, 1);
    expect(view.size * GRID.height).toBeGreaterThan(PANE.height);

    for (const px of [{ x: 200, y: 400 }, { x: 120, y: 700 }, { x: 540, y: 240 }]) {
      for (const steps of [1, 1, -1, 2]) {
        const before = viewGeometry(view, GRID, PANE);
        const tileBefore = {
          x: (px.x - before.originX) / before.size,
          y: (px.y - before.originY) / before.size,
        };
        const next = zoomAbout(view, GRID, PANE, px, steps);
        const after = viewGeometry(next, GRID, PANE);
        if (after.size * GRID.height <= PANE.height) break; // clamped; see below
        expect(Math.abs((px.x - after.originX) / after.size - tileBefore.x) * after.size)
          .toBeLessThanOrEqual(1);
        expect(Math.abs((px.y - after.originY) / after.size - tileBefore.y) * after.size)
          .toBeLessThanOrEqual(1);
        view = next;
      }
    }
  });

  it("lets the clamp win when the two rules disagree", () => {
    // Zooming out towards the fit, the point under the cursor cannot be held:
    // holding it would require showing background past the grid's edge on the
    // axis that has run out of slack. The clamp is the rule that survives, and
    // the visible consequence is that a zoom-out near an edge drifts toward the
    // middle. Measured at about 22 pixels on the step into the fit.
    let view = fitView(GRID, PANE);
    for (let i = 0; i < 6; i++) view = zoomAbout(view, GRID, PANE, { x: 326, y: 450 }, 1);
    const px = { x: 50, y: 860 };
    for (let i = 0; i < 20; i++) view = zoomAbout(view, GRID, PANE, px, -1);

    // It reaches the fit's *size*, and it does not reach the fit's position:
    // zooming out about a corner drags the grid into that corner, and a grid
    // smaller than its pane is allowed to sit there. Home is what re-centres,
    // which is why Home exists rather than being a synonym for zooming out.
    const geo = viewGeometry(view, GRID, PANE);
    expect(geo.size).toBe(fit(GRID, PANE).size);
    expect(geo).not.toEqual(fit(GRID, PANE));
    expect(viewGeometry(fitView(GRID, PANE), GRID, PANE)).toEqual(fit(GRID, PANE));
  });

  it("names the same tile under the cursor at every zoom and pan", () => {
    // The manual check the plan asks for, as a test. `toTile` is what the
    // inspector's tooltip is built on, and it is the thing that breaks if
    // Decision 5 is wrong.
    let view = fitView(GRID, PANE);
    const px = { x: 300, y: 500 };
    for (const steps of [2, 1, 3, -2]) {
      view = zoomAbout(view, GRID, PANE, px, steps);
      const geo = viewGeometry(view, GRID, PANE);
      const tile = toTile(geo, GRID, px);
      expect(tile).not.toBeNull();
      // And the tile's own box really does contain the pixel.
      expect(px.x).toBeGreaterThanOrEqual(geo.originX + tile!.x * geo.size);
      expect(px.x).toBeLessThan(geo.originX + (tile!.x + 1) * geo.size);
      expect(px.y).toBeGreaterThanOrEqual(geo.originY + tile!.y * geo.size);
      expect(px.y).toBeLessThan(geo.originY + (tile!.y + 1) * geo.size);
    }
  });
});

describe("the zoom range", () => {
  it("stops zooming out when the whole grid is visible", () => {
    // The floor is the fit rather than a constant, so the far end of the range
    // is today's view instead of merely resembling it.
    expect(minSize(GRID, PANE)).toBe(fit(GRID, PANE).size);
    let size = 40;
    for (let i = 0; i < 40; i++) size = zoomedSize(size, -1, GRID, PANE);
    expect(size).toBe(fit(GRID, PANE).size);
  });

  it("stops zooming in at the maximum", () => {
    let size = fit(GRID, PANE).size;
    for (let i = 0; i < 60; i++) size = zoomedSize(size, 1, GRID, PANE);
    expect(size).toBe(ZOOM.max);
  });

  it("always moves by at least one pixel, so the wheel is never dead", () => {
    // At size 6 a 1.25 factor rounds back to 6, which would make the wheel do
    // nothing at exactly the sizes where one pixel is a large step.
    for (let size = 2; size < ZOOM.max; size++) {
      const inward = zoomedSize(size, 1, GRID, { width: 4000, height: 4000 });
      if (size < ZOOM.max) expect(inward).toBeGreaterThan(size);
    }
  });

  it("does nothing for a zero-step notch", () => {
    const view = fitView(GRID, PANE);
    expect(zoomAbout(view, GRID, PANE, { x: 100, y: 100 }, 0)).toEqual(view);
  });
});

describe("panning", () => {
  const zoomed = (): View => {
    let v = fitView(GRID, PANE);
    for (let i = 0; i < 5; i++) v = zoomAbout(v, GRID, PANE, { x: 326, y: 450 }, 1);
    return v;
  };

  it("never lets a gap open along an edge when the grid is bigger than the pane", () => {
    const view = zoomed();
    expect(view.size * GRID.width).toBeGreaterThan(PANE.width);
    for (const [dx, dy] of [[9999, 0], [-9999, 0], [0, 9999], [0, -9999]] as const) {
      const geo = viewGeometry(panBy(view, GRID, PANE, dx, dy), GRID, PANE);
      expect(geo.originX).toBeLessThanOrEqual(0);
      expect(geo.originX + geo.size * GRID.width).toBeGreaterThanOrEqual(PANE.width);
    }
  });

  it("keeps a grid smaller than the pane wholly inside it", () => {
    const view = fitView(GRID, PANE);
    for (const [dx, dy] of [[9999, 9999], [-9999, -9999]] as const) {
      const geo = viewGeometry(panBy(view, GRID, PANE, dx, dy), GRID, PANE);
      expect(geo.originX).toBeGreaterThanOrEqual(0);
      expect(geo.originY).toBeGreaterThanOrEqual(0);
      expect(geo.originX + geo.size * GRID.width).toBeLessThanOrEqual(PANE.width);
      expect(geo.originY + geo.size * GRID.height).toBeLessThanOrEqual(PANE.height);
    }
  });

  it("lets a grid smaller than its pane slide inside it rather than locking it", () => {
    // A deliberate choice, and the alternative was tried first. Locking pan to
    // zero whenever the grid is smaller than the pane is tidier to state, and
    // it breaks zoom-about-the-cursor at every zoom level below the one where
    // the grid finally outgrows the pane — which in a tall pane is most of the
    // range. Sliding costs a grid that can sit off-centre; locking costs the
    // feature Task 7 is mostly for.
    const view = fitView(GRID, PANE);
    const slackY = PANE.height - view.size * GRID.height;
    expect(slackY).toBeGreaterThan(0);
    expect(panBy(view, GRID, PANE, 0, 400).panY).toBe(Math.ceil(slackY / 2));
    expect(panBy(view, GRID, PANE, 0, -400).panY).toBe(-Math.floor(slackY / 2));
  });

  it("leaves whole-number pans, so no edge is antialiased into softness", () => {
    let view = zoomed();
    view = panBy(view, GRID, PANE, -13.4, 7.6);
    expect(Number.isInteger(view.panX)).toBe(true);
    expect(Number.isInteger(view.panY)).toBe(true);
    const geo = viewGeometry(view, GRID, PANE);
    expect(Number.isInteger(geo.originX)).toBe(true);
    expect(Number.isInteger(geo.originY)).toBe(true);
  });

  it("is idempotent once it is against a stop", () => {
    const once = panBy(zoomed(), GRID, PANE, -9999, -9999);
    expect(panBy(once, GRID, PANE, -9999, -9999)).toEqual(once);
    expect(clampView(once, GRID, PANE)).toEqual(once);
  });
});
