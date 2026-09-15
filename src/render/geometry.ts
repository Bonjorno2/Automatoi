import type { Vec } from "../sim/types";

/**
 * The only arithmetic between tile coordinates and pixels, in both directions.
 *
 * It is a module of its own, with no Pixi import, because it is the one part of
 * the renderer that can be wrong in a way tests can catch. Everything else is a
 * colour or a shape and has to be checked by eye.
 */
export interface Geometry {
  /** Side of one tile, in CSS pixels. Always a whole number, possibly 0. */
  size: number;
  /** Pixel offset of tile (0,0), centring the grid in its pane. */
  originX: number;
  originY: number;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Scale a grid to fit a pane, whole, and centre the remainder as letterbox.
 *
 * The tile size is floored to an integer, and so are the origins. A fractional
 * size puts adjacent tile rectangles on fractional pixel boundaries, and the
 * seams that produces on a 1024-tile field are far more visible than the few
 * pixels of letterbox that flooring costs. A fractional *origin* is subtler and
 * was caught on the real page: it keeps every boundary shared, so there are no
 * seams, but it offsets the whole grid half a pixel off the device grid and
 * antialiases every edge in the field into softness.
 *
 * A degenerate pane or grid yields size 0 rather than NaN or Infinity. The page
 * really does lay out a zero-height pane for a frame or two during startup, and
 * a NaN that reaches Pixi disappears the whole canvas silently.
 */
export function fit(grid: Size, pane: Size): Geometry {
  if (grid.width <= 0 || grid.height <= 0) return { size: 0, originX: 0, originY: 0 };
  const size = Math.max(0, Math.floor(Math.min(pane.width / grid.width, pane.height / grid.height)));
  return {
    size,
    originX: Math.floor((pane.width - size * grid.width) / 2),
    originY: Math.floor((pane.height - size * grid.height) / 2),
  };
}

/**
 * Top-left pixel of a tile.
 *
 * Fractional tile coordinates are legal and expected: an interpolated bot
 * part-way through a move lives at x = 4.37.
 */
export function toPixel(g: Geometry, tile: { x: number; y: number }): { x: number; y: number } {
  return { x: g.originX + tile.x * g.size, y: g.originY + tile.y * g.size };
}

/** Centre pixel of a tile. What actors and marks are positioned by. */
export function toCentre(g: Geometry, tile: { x: number; y: number }): { x: number; y: number } {
  const half = g.size / 2;
  return { x: g.originX + tile.x * g.size + half, y: g.originY + tile.y * g.size + half };
}

/**
 * Pixel back to tile, or null if the pixel is outside the grid.
 *
 * Null rather than a clamp: the inspector must distinguish "hovering the edge
 * tile" from "hovering the letterbox beside it", and a clamping version reports
 * the former for both.
 */
export function toTile(g: Geometry, grid: Size, px: { x: number; y: number }): Vec | null {
  if (g.size <= 0) return null;
  const x = Math.floor((px.x - g.originX) / g.size);
  const y = Math.floor((px.y - g.originY) / g.size);
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return { x, y };
}
