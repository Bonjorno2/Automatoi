import { Application, Container, Graphics } from "pixi.js";
import { fit, type Geometry, type Size } from "./geometry.ts";

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

/**
 * Task 1's proof that Pixi renders at all in a cross-origin isolated page.
 * Task 2 replaces this with the terrain layer.
 */
export function drawPlaceholder(stage: Stage, grid: Size): void {
  const g = stage.geometry;
  stage.staticLayer.removeChildren();
  stage.staticLayer.addChild(
    new Graphics()
      .rect(g.originX, g.originY, g.size * grid.width, g.size * grid.height)
      .fill(0x4a3a2a),
  );
}
