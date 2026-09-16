import { Application, Container } from "pixi.js";
import { fit, type Geometry, type Size } from "./geometry.ts";
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
    consumers.tiles.resize(geometry, consumers.snapshot());
    consumers.actors.resize(geometry);
    consumers.hud.resize(geometry, consumers.pane());
  };
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
  app.stage.addChild(staticLayer, tickLayer, frameLayer);

  const stage: Stage = {
    app,
    staticLayer,
    tickLayer,
    frameLayer,
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
