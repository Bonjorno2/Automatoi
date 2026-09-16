import { Application, Container, Graphics } from "pixi.js";
import { fit, type Geometry, type Size } from "./geometry.ts";
import { VIGNETTE, vignetteBands } from "./texture.ts";
import type { WorldSnapshot } from "../sim/types.ts";

/**
 * The PixiJS application and its layers.
 *
 * Layers are named for how often they are rebuilt, not for what they contain.
 * That is the distinction that survives: crops and, later, items on the ground
 * change on a tick and never between ticks, while actors are interpolated and
 * must be touched every frame. A layer named "crops" would need renaming the
 * moment a belt carries flour across it.
 */
export interface Stage {
  readonly app: Application;
  /** Drawn once, rebuilt only on resize: terrain. */
  readonly staticLayer: Container;
  /** Rebuilt when the world's tick changes: crops now, ground items later. */
  readonly tickLayer: Container;
  /** Rebuilt every frame: bots, machines, marks. */
  readonly frameLayer: Container;
  /**
   * Screen space, above the world and below the HUD: the vignette.
   *
   * Not a fourth "how often is it rebuilt" layer but a different *coordinate
   * system*, which is why it is named for where it is rather than for when.
   * Per Decision 7 of the milestone 7 plan, it frames the pane and not the grid,
   * so Task 7's camera must leave it exactly where it is.
   */
  readonly overlayLayer: Container;
  /** Current fit of the grid into the pane. Replaced on resize. */
  geometry: Geometry;
  /** Called after `geometry` changes, so layers can rebuild against it. */
  onResize: (g: Geometry) => void;
  destroy(): void;
}

/**
 * The layers that cache a fit, and what each needs to rebuild against one.
 *
 * Structural rather than the concrete layer types, so this can be tested with
 * plain objects: Pixi cannot be constructed in the test environment, and a
 * resize fan-out that could only be checked by looking at the screen is how the
 * bug below survived a whole milestone.
 */
export interface GeometryConsumers {
  tiles: { resize(geometry: Geometry, snapshot: WorldSnapshot): void };
  actors: { resize(geometry: Geometry): void };
  hud: { resize(geometry: Geometry, pane: Size): void };
  /**
   * The vignette, which caches the pane rather than the fit.
   *
   * Required rather than optional even though it ignores the geometry. This is
   * the file whose whole existence is a hook nobody assigned, and an optional
   * consumer is a hook nobody assigned with a type that says that is fine.
   */
  overlay: { resize(pane: Size): void };
  /** The current snapshot, read when the resize happens rather than before. */
  snapshot(): WorldSnapshot;
  /** The renderer's pixel size, read for the same reason. */
  pane(): Size;
}

/**
 * Connect the layers that cache a fit to the stage's resize hook.
 *
 * `onResize` existed from milestone 4 and **nothing ever assigned it**, which
 * made `ActorLayer.resize` and `Hud.resize` dead code and left a real bug in the
 * page: after a window resize the terrain redrew at the new tile size while bots
 * and machines stayed at the old one, drawn at the wrong scale in the wrong
 * place. The tile layer caches its fit too, and its crop pool is positioned in
 * pixels, so it has the same problem.
 *
 * Both callbacks read their inputs when the resize fires. The renderer has
 * already been resized by then, and the world has moved on since the page was
 * built; capturing either at wiring time is how this gets quietly re-broken.
 */
export function connectResize(
  stage: { onResize: (geometry: Geometry) => void },
  consumers: GeometryConsumers,
): void {
  stage.onResize = (geometry) => {
    const pane = consumers.pane();
    consumers.tiles.resize(geometry, consumers.snapshot());
    consumers.actors.resize(geometry);
    consumers.hud.resize(geometry, pane);
    consumers.overlay.resize(pane);
  };
}

/**
 * The vignette: unnoticeable when looked at directly, obvious when switched off.
 *
 * Drawn once into one `Graphics` and rebuilt only when the pane changes, which
 * is the same schedule the terrain is on and for the same reason — nothing about
 * it depends on the world.
 */
export interface Overlay {
  resize(pane: Size): void;
  /** Whether the vignette is drawn at all. The manual check in Task 9 needs this. */
  enabled: boolean;
}

export function createOverlay(layer: Container, pane: Size): Overlay {
  const g = new Graphics();
  layer.addChild(g);
  let current = pane;

  const overlay: Overlay = {
    get enabled() {
      return g.visible;
    },
    set enabled(on: boolean) {
      g.visible = on;
    },
    resize(next) {
      current = next;
      g.clear();
      for (const band of vignetteBands(current)) {
        g.rect(band.x, band.y, band.width, band.height).fill({
          color: VIGNETTE.color,
          alpha: band.alpha,
        });
      }
    },
  };
  overlay.resize(pane);
  return overlay;
}

const BACKGROUND = 0x12140f;

export async function createStage(host: HTMLElement, grid: Size): Promise<Stage> {
  const app = new Application();
  // Pixi 8 initialises asynchronously; the v7 constructor form does not exist.
  await app.init({
    resizeTo: host,
    background: BACKGROUND,
    antialias: true,
    autoDensity: true,
    resolution: window.devicePixelRatio || 1,
  });
  host.append(app.canvas);

  const staticLayer = new Container();
  const tickLayer = new Container();
  const frameLayer = new Container();
  const overlayLayer = new Container();
  // The HUD is added to `app.stage` by its own factory, after this runs, so it
  // lands above the overlay without either of them having to name the other.
  app.stage.addChild(staticLayer, tickLayer, frameLayer, overlayLayer);

  const stage: Stage = {
    app,
    staticLayer,
    tickLayer,
    frameLayer,
    overlayLayer,
    geometry: fit(grid, { width: app.screen.width, height: app.screen.height }),
    onResize: () => {},
    destroy() {
      observer.disconnect();
      app.destroy(true, { children: true });
    },
  };

  // `resizeTo` resizes the renderer but knows nothing about the grid fit, so
  // the geometry is recomputed here rather than read per draw.
  const observer = new ResizeObserver(() => {
    const next = fit(grid, { width: host.clientWidth, height: host.clientHeight });
    if (next.size === stage.geometry.size && next.originX === stage.geometry.originX) return;
    stage.geometry = next;
    stage.onResize(next);
  });
  observer.observe(host);

  return stage;
}
