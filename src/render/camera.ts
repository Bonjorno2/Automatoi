import { fit, type Geometry, type Size } from "./geometry.ts";
import type { WorldSnapshot } from "../sim/types.ts";

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

/** A rectangle in tile space, in tiles. Half-open: `x + width` is the first tile outside. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The view that frames a rectangle of the grid rather than the whole of it.
 *
 * Milestone 7's finding 1: a narrow window no longer *shrinks* the world as you
 * resize into it, but the page still opened at the whole-grid fit, so a 900-wide
 * window started at 8 pixels per tile — where a belt's arrow is 2.4 pixels and
 * the only thing a player can get wrong about a belt is invisible. The grid is
 * 32x32 and what is on it fits in about 13x13, so twenty-six columns of that
 * opening view were empty grass.
 *
 * This is the opening view only. **`Home` still goes to `fitView`**, which is
 * "show me everything" and has to keep meaning that.
 *
 * Everything returned goes through `clampView` and the same `ZOOM.max` ceiling
 * the wheel obeys, so this cannot produce a view the camera would otherwise
 * refuse — a one-tile rectangle frames at the maximum zoom rather than at four
 * hundred pixels per tile. A degenerate rectangle falls back to the fit, for the
 * same reason `fit` returns size 0 rather than NaN: the page really does lay out
 * before there is anything to frame.
 */
export function frameView(rect: Rect, grid: Size, pane: Size): View {
  if (rect.width <= 0 || rect.height <= 0) return fitView(grid, pane);
  // Asked of the *fit* rather than of the clamped size below: `minSize` floors
  // at one pixel so the wheel is never dead, which means the clamp can never
  // report the degenerate case and a guard placed after it would never fire.
  if (fit(grid, pane).size <= 0) return fitView(grid, pane);

  const lo = minSize(grid, pane);
  const wanted = fit({ width: rect.width, height: rect.height }, pane).size;
  const size = clamp(wanted, lo, Math.max(lo, ZOOM.max));

  // The pan that moves the rectangle's centre to the pane's centre. `viewGeometry`
  // centres the *grid*, so the offset needed is between the two centres — which
  // is zero when the rectangle is the grid, and that is a test.
  const gridCentre = { x: (grid.width * size) / 2, y: (grid.height * size) / 2 };
  const rectCentre = {
    x: (rect.x + rect.width / 2) * size,
    y: (rect.y + rect.height / 2) * size,
  };
  return clampView(
    { size, panX: gridCentre.x - rectCentre.x, panY: gridCentre.y - rectCentre.y },
    grid,
    pane,
  );
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
 * The part of the grid the player actually has, with a tile of air around it.
 *
 * **Derived from the snapshot rather than from `FIELD_RADIUS` and the console's
 * position.** Those two would be a second opinion about where the field is, and
 * it would be wrong the first time a player built outside it — which they can,
 * because `canPlace` accepts grass as readily as soil and a test exists to keep
 * it that way. A bounding box over what is drawn cannot disagree with what is
 * drawn, which is the discipline `fieldLines` follows for the same reason.
 *
 * Soil, machines and bots. Not crops: a crop only grows on soil, so it is
 * already inside the box, and reading them too would be a second loop over the
 * same tiles to reach the same answer.
 */
export function occupiedRect(snapshot: WorldSnapshot, margin = 1): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const see = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (let y = 0; y < snapshot.height; y++) {
    for (let x = 0; x < snapshot.width; x++) {
      if (snapshot.tiles[y * snapshot.width + x]?.terrain === "soil") see(x, y);
    }
  }
  for (const machine of snapshot.machines) see(machine.pos.x, machine.pos.y);
  for (const bot of snapshot.bots) see(bot.pos.x, bot.pos.y);

  // A world of nothing but grass is the whole grid, which is also what a world
  // that has not finished being built looks like for a frame.
  if (minX > maxX) return { x: 0, y: 0, width: snapshot.width, height: snapshot.height };

  const x = Math.max(0, minX - margin);
  const y = Math.max(0, minY - margin);
  return {
    x,
    y,
    width: Math.min(snapshot.width, maxX + margin + 1) - x,
    height: Math.min(snapshot.height, maxY + margin + 1) - y,
  };
}

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
