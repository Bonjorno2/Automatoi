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

/** Everything the page needs to draw, read fresh each frame. */
export interface SessionView {
  time: number;
  pos: { x: number; y: number };
  inventory: Record<string, number | undefined>;
  busy: boolean;
  paused: boolean;
  speed: number;
}

/**
 * Owns the world, the colony and the loop that drives them.
 *
 * The loop runs on `requestAnimationFrame`, which the browser stops delivering
 * while the tab is hidden. That is the behaviour we want — a game should not
 * run on unwatched — and the clock's catch-up cap is what absorbs the jump
 * when the tab comes back.
 */
export class GameSession {
  readonly world: World;
  readonly colony: ScriptColony;
  readonly clock: RealtimeClock;
  readonly botId = 1;

  private frame: number | null = null;

  constructor(opts: SessionOptions = {}) {
    this.world = new World({ seed: opts.seed ?? 1 });
    this.clock = new RealtimeClock({ hz: opts.hz ?? 20 });
    this.colony = new ScriptColony({
      world: this.world,
      spawnWorker: spawnWeb,
      clock: this.clock,
    });
  }

  start(): void {
    if (this.frame !== null) return;
    const loop = (): void => {
      this.colony.pass();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
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

  view(): SessionView {
    const bot = this.world.getBot(this.botId);
    return {
      time: this.world.time,
      pos: { ...bot.pos },
      inventory: { ...bot.inventory },
      busy: bot.action !== null,
      paused: this.clock.paused,
      speed: this.clock.speed,
    };
  }
}
