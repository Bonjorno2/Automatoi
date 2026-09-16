import { fit, type Geometry, type Size } from "./geometry.ts";

/**
 * A camera, which is a function from a view to a `Geometry` and nothing else.
 *
 * Decision 5 of the milestone 7 plan: `geometry.ts` is the one part of the
 * renderer tests can catch being wrong, and every layer already goes through
 * `toPixel`/`toCentre`/`toTile`. A camera that produces a `Geometry` therefore
 * works everywhere for free — including the inspector's hit-testing — without a
 * single layer knowing it exists. Scaling a Pixi container instead would put
 * the renderer's idea of where a tile is and the inspector's idea of where a
 * tile is into two coordinate systems, and they would drift the first time one
 * of them was touched.
 *
 * No Pixi import, and no DOM: the wheel and the drag live in `main.ts`, and
 * what is here is the arithmetic that can be wrong.
 */
export interface View {
  /** Tile size in pixels. Always a whole number, per Decision 6. */
  size: number;
  /** Pixels added to the centred origin. Whole numbers, for the same reason. */
  panX: number;
  panY: number;
}

export const ZOOM = {
  /**
   * Multiplied per wheel notch, then rounded to a whole tile size.
   *
   * Decision 6: a fractional tile size seams a 1024-tile field and a fractional
   * origin antialiases every edge into softness, which is the whole argument
   * `fit` already makes at length. Zoom steps between integers and therefore
   * feels stepped — the same price the game already pays on a window resize.
   */
  factor: 1.25,
  /** The most a tile may be. Past this the grid is a handful of tiles. */
  max: 72,
} as const;

/**
 * The floor is the fit, not a constant.
 *
 * Zooming out stops when the whole grid is visible, which means the far end of
 * the zoom range *is* today's view rather than merely resembling it — and it
 * means panning has nothing to clamp there, because the grid already fits.
 */
export function minSize(grid: Size, pane: Size): number {
  return Math.max(1, fit(grid, pane).size);
}

/** The view that shows the whole grid: today's behaviour, and where `Home` goes. */
export function fitView(grid: Size, pane: Size): View {
  return { size: fit(grid, pane).size, panX: 0, panY: 0 };
}

/**
 * The geometry a view produces.
 *
 * At the fit size with no pan this is `fit` exactly, which is the property that
 * makes the default path provably unchanged rather than merely similar.
 */
export function viewGeometry(view: View, grid: Size, pane: Size): Geometry {
  if (grid.width <= 0 || grid.height <= 0) return { size: 0, originX: 0, originY: 0 };
  const size = Math.max(0, Math.floor(view.size));
  return {
    size,
    originX: Math.floor((pane.width - size * grid.width) / 2) + Math.round(view.panX),
    originY: Math.floor((pane.height - size * grid.height) / 2) + Math.round(view.panY),
  };
}

const clamp = (n: number, lo: number, hi: number): number =>
  lo > hi ? lo : n < lo ? lo : n > hi ? hi : n;

/**
 * Keep the grid covering the pane, or fully inside it.
 *
 * Stricter than the plan's "cannot be lost off-screen entirely", and simpler to
 * state: when the grid is larger than the pane it must cover it, so there is
 * never a bar of background along an edge; when it is smaller it must sit
 * wholly within it. One interval expresses both, because the two cases only
 * differ in which end of `pane - grid` is the low one.
 */
export function clampView(view: View, grid: Size, pane: Size): View {
  const span = (extent: number, along: number): { lo: number; hi: number } => {
    const base = Math.floor((along - extent) / 2);
    const slack = along - extent;
    return { lo: Math.min(0, slack) - base, hi: Math.max(0, slack) - base };
  };
  const x = span(view.size * grid.width, pane.width);
  const y = span(view.size * grid.height, pane.height);
  return {
    size: view.size,
    panX: Math.round(clamp(view.panX, x.lo, x.hi)),
    panY: Math.round(clamp(view.panY, y.lo, y.hi)),
  };
}

/** One notch of zoom, as a whole tile size, inside the range this pane allows. */
export function zoomedSize(size: number, steps: number, grid: Size, pane: Size): number {
  const lo = minSize(grid, pane);
  if (steps === 0) return clamp(size, lo, Math.max(lo, ZOOM.max));
  let next = Math.round(size * Math.pow(ZOOM.factor, steps));
  // A notch that rounds back to where it started would make the wheel dead at
  // small sizes, where one pixel per tile is a large step.
  if (next === size) next += Math.sign(steps);
  return clamp(next, lo, Math.max(lo, ZOOM.max));
}

/**
 * Zoom about a pixel, keeping whatever is under it under it.
 *
 * The tile coordinate at `px` is held fixed and the pan is solved for. Both the
 * size and the pan are whole numbers afterwards, so the point can land up to
 * half a pixel from where it started; that is the same rounding `fit` already
 * chose, for the same reason.
 */
export function zoomAbout(
  view: View,
  grid: Size,
  pane: Size,
  px: { x: number; y: number },
  steps: number,
): View {
  const size = zoomedSize(view.size, steps, grid, pane);
  if (size === view.size) return view;

  const before = viewGeometry(view, grid, pane);
  if (before.size <= 0) return { ...view, size };
  const tileX = (px.x - before.originX) / before.size;
  const tileY = (px.y - before.originY) / before.size;

  // The origin that would put that same tile coordinate back under the cursor,
  // minus the centred origin the new size implies, is the pan we need.
  const baseX = Math.floor((pane.width - size * grid.width) / 2);
  const baseY = Math.floor((pane.height - size * grid.height) / 2);
  return clampView(
    {
      size,
      panX: px.x - tileX * size - baseX,
      panY: px.y - tileY * size - baseY,
    },
    grid,
    pane,
  );
}

/** Drag the view by a pixel delta, clamped. */
export function panBy(view: View, grid: Size, pane: Size, dx: number, dy: number): View {
  return clampView({ size: view.size, panX: view.panX + dx, panY: view.panY + dy }, grid, pane);
}
