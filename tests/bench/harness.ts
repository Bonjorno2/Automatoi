import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { RealtimeClock } from "../../src/bridge/clock.ts";
import type { Clock } from "../../src/bridge/clock.ts";
import { REQUEST, STATE } from "../../src/bridge/protocol.ts";

/**
 * A headless colony paced by a wall clock, so that a measurement can be trusted.
 *
 * **Why this exists.** Milestone 9's finding 2. Every headless benchmark in this
 * project drives `ScriptColony.pass()` in a tight loop under `DemandClock`, which
 * advances one simulated tick per pass as fast as the event loop turns. A bot is
 * an OS worker thread and takes real milliseconds to boot. Simulated time and
 * wall time are different clocks, and only one of them waits for a thread — so a
 * benchmark that spawns a bot measures a colony the new bot has not joined yet.
 *
 * Measured, on the machine that wrote this, with the probe that motivated the
 * harness — the same worker boot costing ~37ms of wall time in every case:
 *
 * | clock            | simulated ticks a worker boot costs |
 * |------------------|-------------------------------------|
 * | `DemandClock`    | **1752**                            |
 * | realtime 20Hz    | 0                                   |
 * | realtime 200Hz   | 7                                   |
 * | realtime 1000Hz  | 36                                  |
 *
 * A harvest round in this game is roughly 120 ticks, so under the demand clock a
 * spawned bot arrives about fourteen rounds late and its parent has already
 * cleared the field. That is exactly the failure that made four versions of the
 * cycle-four benchmark compare one working bot against one working bot.
 *
 * **What this does about it.** Two things, and the second matters more than the
 * first.
 *
 * 1. It paces the world with `RealtimeClock`, so thread latency costs a number of
 *    ticks in the same proportion the page sees.
 * 2. It *counts commands per bot inside the measured window*, so a benchmark can
 *    assert that every bot it is claiming to measure actually did something. The
 *    old bug was silent; this is the part that makes it loud.
 */

/**
 * Simulated ticks per real second, for benchmarks.
 *
 * Ten times the page's 20Hz, and the ratio is the whole decision. At 20Hz a
 * worker boot rounds to nothing, but a 1200-tick benchmark takes a minute of wall
 * time, which is a benchmark nobody runs. At 200Hz a boot costs 7 ticks — under
 * 6% of one harvest round, so the conclusion is the page's conclusion — and the
 * same benchmark takes about six seconds.
 *
 * Faster is not better here: at 1000Hz a boot is 36 ticks, which is a third of a
 * round and starts to be the thing being measured again. This number is a
 * fidelity/patience trade and both ends of it are real.
 */
export const BENCH_HZ = 200;

/**
 * Counts the commands each bot issues, by watching the channels the base class
 * is about to serve.
 *
 * A subclass rather than a change to `src/`: this is the only consumer, and the
 * sim has no per-bot command counter for a benchmark's convenience to add one.
 * `serve` is the class's own extension point and `channels` is protected, so
 * nothing here reaches past what `ScriptColony` already offers.
 */
class CountingColony extends ScriptColony {
  /** Commands served, by bot id, for the whole life of the colony. */
  readonly commands = new Map<number, number>();

  protected override serve(): void {
    for (const [id, ch] of this.channels) {
      // The same two conditions the base class uses to decide a request is new,
      // checked before it flips `pending`.
      if (Atomics.load(ch.ctrl, STATE) === REQUEST && !ch.pending) {
        this.commands.set(id, (this.commands.get(id) ?? 0) + 1);
      }
    }
    super.serve();
  }
}

export interface BenchOptions {
  world: World;
  /** Source for bot 1, the bot the benchmark starts by hand. */
  script: string;
  /** Shared library, compiled ahead of every script including spawned ones. */
  library?: string;
  /** Simulated ticks per real second. Defaults to {@link BENCH_HZ}. */
  hz?: number;
  /** The measured window closes the first pass this answers true. */
  until: (world: World) => boolean;
  /**
   * The measured window opens the first pass this answers true. Without it the
   * window opens immediately.
   *
   * A realtime clock makes this far less necessary than it was — a boot costs
   * single-digit ticks rather than a thousand — but a benchmark that wants to
   * measure steady state rather than start-up can still ask.
   */
  startWhen?: (world: World) => boolean;
  /** Wall-clock ceiling for the whole run. Defaults to 120s. */
  timeoutMs?: number;
  /** Injectable so the harness's own tests need neither a worker nor a wall clock. */
  clock?: Clock;
}

export interface BotWork {
  id: number;
  /** `world.time` when this bot's first command was served; null if it never ran one. */
  bootTick: number | null;
  /** Commands served during the measured window. */
  commands: number;
}

export interface BenchResult {
  /** Simulated ticks the measured window lasted. The headline number. */
  ticks: number;
  /** Wall-clock ms the measured window lasted. */
  wallMs: number;
  /** Simulated ticks burned before the window opened. */
  warmUpTicks: number;
  hz: number;
  /** Every bot that existed when the window closed, in world order. */
  bots: BotWork[];
  /** Did `until` actually come true, or did the run hit its deadline? */
  reachedTarget: boolean;
  /**
   * Did every bot alive at the close issue at least one command inside the
   * window?
   *
   * The guard milestone 9's benchmark needed and did not have. False means the
   * window did not measure the colony it claims to — some bot was booting, dead
   * or finished throughout — and any per-bot conclusion drawn from it is void.
   */
  everyBotWorked: boolean;
}

/**
 * Yield, without spinning.
 *
 * `setImmediate` would turn the loop every few microseconds and pace the clock
 * beautifully, and that is exactly wrong here: it pegs the main thread and
 * starves the worker threads whose real progress is the thing being measured.
 * A ~1ms timeout gives five passes per tick at {@link BENCH_HZ}, which is ample
 * resolution, and leaves the CPU to the bots.
 */
const breathe = (): Promise<unknown> => new Promise((r) => setTimeout(r, 0));

/**
 * Run one measurement.
 *
 * Throws only for a broken setup. A run that times out, or one where a bot never
 * worked, comes back as a result saying so — a benchmark should assert on those
 * rather than have them raised as errors, because the numbers alongside them are
 * what explains the failure.
 */
export async function measure(opts: BenchOptions): Promise<BenchResult> {
  const { world, script, until, startWhen } = opts;
  const hz = opts.hz ?? BENCH_HZ;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const clock = opts.clock ?? new RealtimeClock({ hz });

  const colony = new CountingColony({
    world,
    clock,
    library: opts.library ?? "",
    // A benchmark's scripts are long-lived and the watchdog is not what is being
    // tested. It still fires, just not on the scale of a measurement.
    hungMs: 120_000,
  });

  /** First tick each bot was seen to issue a command. */
  const bootTick = new Map<number, number>();
  const noteBoots = (): void => {
    for (const [id, count] of colony.commands) {
      if (count > 0 && !bootTick.has(id)) bootTick.set(id, world.time);
    }
  };

  const deadline = Date.now() + timeoutMs;
  const expired = (): boolean => Date.now() > deadline;

  try {
    void colony.run(1, script);

    // Phase 1: warm up, if asked. Boots are recorded here too, so a bot that
    // started during the warm-up still reports the tick it started on.
    if (startWhen) {
      while (!startWhen(world) && !expired()) {
        colony.pass();
        noteBoots();
        await breathe();
      }
    }

    // The window opens.
    const tick0 = world.time;
    const ms0 = Date.now();
    const commands0 = new Map(colony.commands);

    let reachedTarget = false;
    while (!expired()) {
      if (until(world)) { reachedTarget = true; break; }
      colony.pass();
      noteBoots();
      await breathe();
    }

    const ticks = world.time - tick0;
    const wallMs = Date.now() - ms0;

    const bots: BotWork[] = [...world.bots.keys()].map((id) => ({
      id,
      bootTick: bootTick.get(id) ?? null,
      commands: (colony.commands.get(id) ?? 0) - (commands0.get(id) ?? 0),
    }));

    return {
      ticks,
      wallMs,
      warmUpTicks: tick0,
      hz,
      bots,
      reachedTarget,
      everyBotWorked: bots.length > 0 && bots.every((b) => b.commands > 0),
    };
  } finally {
    await colony.stopAll();
  }
}

/** A one-line summary, for a benchmark that wants its numbers in the log. */
export function describeResult(label: string, r: BenchResult): string {
  const split = r.bots
    .map((b) => `bot ${b.id}: ${b.commands} cmds, booted@${b.bootTick ?? "never"}`)
    .join("; ");
  return (
    `${label}: ${r.ticks} ticks in ${r.wallMs}ms at ${r.hz}Hz ` +
    `(warm-up ${r.warmUpTicks}) — ${split}` +
    (r.reachedTarget ? "" : " — TIMED OUT")
  );
}
