import { World } from "../sim/world";
import { ScriptColony } from "../bridge/colony.ts";
import type { RunOptions, ScriptOutcome } from "../bridge/colony.ts";
import { RealtimeClock } from "../bridge/clock.ts";
import { spawnWeb } from "../bridge/spawn.web.ts";

export interface SessionOptions {
  seed?: number;
  /** Simulated ticks per real second. */
  hz?: number;
}

/**
 * Owns the world, the colony and the clock. It does **not** own a loop.
 *
 * It used to: `start()` ran its own `requestAnimationFrame` loop calling
 * `colony.pass()`, while the page ran a second one to draw. Two loops on the
 * same clock source have no defined order between them, so whether a frame drew
 * the world before or after that frame's ticks was down to registration order —
 * and the interpolation alpha was read at an unspecified point relative to the
 * ticks it interpolates between. One loop, `pass()` then draw, fixes the order
 * and makes each half separately measurable, which Task 8 needs.
 *
 * The loop still lives on `requestAnimationFrame`, which the browser stops
 * delivering to a hidden tab. That is the behaviour we want — a game should not
 * run unwatched — and the clock's catch-up cap absorbs the jump on return.
 */
export class GameSession {
  readonly world: World;
  readonly colony: ScriptColony;
  readonly clock: RealtimeClock;
  readonly botId = 1;

  constructor(opts: SessionOptions = {}) {
    this.world = new World({ seed: opts.seed ?? 1 });
    this.clock = new RealtimeClock({ hz: opts.hz ?? 20 });
    this.colony = new ScriptColony({
      world: this.world,
      spawnWorker: spawnWeb,
      clock: this.clock,
    });
  }

  /**
   * Advance the world and service every bot's channel once.
   *
   * Called by the page's single frame loop, before drawing.
   */
  pass(): void {
    this.colony.pass();
  }

  /**
   * Start a script, replacing whatever was running.
   *
   * Hot reload is exactly this: stop then run. Milestone 2's Task 10 made that
   * safe — stopping abandons the in-flight command and leaves the channel clean
   * — so restarting mid-command is not a special case here.
   */
  async runScript(source: string, opts: RunOptions = {}): Promise<ScriptOutcome> {
    await this.colony.stop(this.botId);
    return this.colony.run(this.botId, source, opts);
  }

  stopScript(): Promise<void> {
    return this.colony.stop(this.botId);
  }

  /*
   * `view()` used to live here, flattening one bot's state for the milestone 3
   * text readout. The renderer reads `world.snapshot()` directly and the
   * readout is gone, so a hand-maintained projection of one bot is a second
   * source of truth with no consumer.
   */
}
