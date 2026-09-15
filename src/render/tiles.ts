import { Container, Graphics } from "pixi.js";
import type { WorldSnapshot } from "../sim/types.ts";
import { CROP_HEIGHT, TERRAIN, cropColor, cropStage } from "./palette.ts";
import { toPixel, type Geometry } from "./geometry.ts";

/**
 * The ground: terrain underneath, crops on top.
 *
 * Two layers with very different update rules, which is the whole reason this
 * module exists rather than one draw call per tile:
 *
 * - **Terrain** never changes during a game. It is drawn into a single
 *   `Graphics` once and touched again only on resize. A thousand `Graphics`
 *   objects redrawn per frame is how a canvas becomes a slideshow.
 * - **Crops** change on a tick and never between ticks. They are pooled per
 *   tile, created on demand, and their *geometry* is rebuilt only when the
 *   growth stage changes — colour, which changes every tick, rides on `tint`,
 *   which is free.
 *
 * Milestone 5's items on the ground are the second inhabitant of the crop
 * layer, not a third layer. The pool is keyed by tile index and knows nothing
 * about wheat; that is deliberate.
 */
export interface TileLayer {
  /** Called when the world's tick changed. Cheap when nothing grew. */
  update(snapshot: WorldSnapshot): void;
  /** Rebuild against a new fit. */
  resize(geometry: Geometry, snapshot: WorldSnapshot): void;
}

interface CropSprite {
  g: Graphics;
  /** Last stage its geometry was built for, so unchanged stages skip the rebuild. */
  stage: number;
}

export function createTileLayer(
  staticLayer: Container,
  tickLayer: Container,
  geometry: Geometry,
  snapshot: WorldSnapshot,
): TileLayer {
  let geo = geometry;
  const terrain = new Graphics();
  staticLayer.addChild(terrain);

  const crops = new Container();
  tickLayer.addChild(crops);
  const pool = new Map<number, CropSprite>();

  function drawTerrain(snap: WorldSnapshot): void {
    terrain.clear();
    for (let y = 0; y < snap.height; y++) {
      for (let x = 0; x < snap.width; x++) {
        const tile = snap.tiles[y * snap.width + x];
        if (!tile) continue;
        const shade = TERRAIN[tile.terrain];
        const p = toPixel(geo, { x, y });
        terrain.rect(p.x, p.y, geo.size, geo.size);
        terrain.fill((x + y) % 2 === 0 ? shade.base : shade.alt);
      }
    }
  }

  /**
   * A stalk with a head, drawn white so `tint` can carry the ripeness colour.
   * Anchored to the bottom of the tile so growth reads as rising, not swelling.
   */
  function drawCrop(sprite: CropSprite, stage: number): void {
    const size = geo.size;
    const h = CROP_HEIGHT[stage]! * size;
    const stalk = Math.max(1, Math.round(size * 0.12));
    const g = sprite.g;
    g.clear();
    g.rect(-stalk / 2, -h, stalk, h).fill(0xffffff);
    if (stage >= 2) {
      // The head is what distinguishes "nearly ready" from "ready" at a glance.
      const head = size * (stage === 3 ? 0.34 : 0.24);
      g.ellipse(0, -h, head / 2, head * 0.42).fill(0xffffff);
    }
    sprite.stage = stage;
  }

  function update(snap: WorldSnapshot): void {
    const seen = new Set<number>();
    for (let i = 0; i < snap.tiles.length; i++) {
      const crop = snap.tiles[i]?.crop;
      if (!crop) continue;
      seen.add(i);
      let sprite = pool.get(i);
      if (!sprite) {
        sprite = { g: new Graphics(), stage: -1 };
        const x = i % snap.width;
        const y = Math.floor(i / snap.width);
        const p = toPixel(geo, { x, y });
        // Positioned at the bottom-centre of its tile; the shape is drawn
        // relative to that, so growth only changes the shape.
        sprite.g.position.set(p.x + geo.size / 2, p.y + geo.size);
        crops.addChild(sprite.g);
        pool.set(i, sprite);
      }
      const stage = cropStage(crop.growth);
      if (stage !== sprite.stage) drawCrop(sprite, stage);
      sprite.g.tint = cropColor(crop.item, crop.growth);
      sprite.g.visible = true;
    }
    // Harvested tiles: destroy rather than hide. A field is harvested far more
    // often than it is planted, and a pool that only grows is a slow leak.
    for (const [i, sprite] of pool) {
      if (seen.has(i)) continue;
      sprite.g.destroy();
      pool.delete(i);
    }
  }

  function resize(next: Geometry, snap: WorldSnapshot): void {
    geo = next;
    drawTerrain(snap);
    for (const [, sprite] of pool) sprite.g.destroy();
    pool.clear();
    update(snap);
  }

  drawTerrain(snapshot);
  update(snapshot);

  return { update, resize };
}
