import { World } from "../sim/world";
import type { CommandResult } from "../sim/types";
import {
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  createChannel, ctrlOf, mirrorOf, readFrame, reqOf, resOf, writeFrame,
} from "./protocol.ts";
import type { HostRequest, MirrorState, ResearchStatus } from "./protocol.ts";
import { RESEARCH_COST } from "../sim/config.ts";
import { publishMirror } from "./mirror.ts";
import { DemandClock } from "./clock.ts";
import type { Clock } from "./clock.ts";
import type { SpawnWorker, WorkerHandle } from "./spawn.ts";

export interface ColonyOptions {
  world: World;
  /** Idle time, in ms, after which a script is presumed stuck. */
  hungMs?: number;
}

/** A bot's readable state as `colony.bots()` returns it. */
export type BotView = MirrorState & { id: number };

interface Channel {
  botId: number;
  sab: SharedArrayBuffer;
  ctrl: Int32Array;
  req: Uint8Array;
  res: Uint8Array;
  mirror: Uint8Array;
  /**
   * Host-side: this channel's request has been dispatched and is waiting on the
   * sim. STATE stays at REQUEST for the whole of that wait, so without this the
   * host would re-issue the same command on every tick.
   */
  pending: boolean;
  /** Host-side wall-clock time this channel last received a request. Drives the watchdog. */
  lastActive: number;
}

export class Colony {
  readonly world: World;
  protected readonly hungMs: number;
  protected readonly channels = new Map<number, Channel>();

  constructor(opts: ColonyOptions) {
    this.world = opts.world;
    this.hungMs = opts.hungMs ?? 2000;
  }

  /** Give a bot a channel. The mirror is published at once so a script may read before its first call. */
  attach(botId: number): SharedArrayBuffer {
    if (this.channels.has(botId)) throw new Error(`bot ${botId} already attached`);
    this.world.getBot(botId); // throws for an unknown bot
    const sab = createChannel();
    const channel: Channel = {
      botId, sab,
      ctrl: ctrlOf(sab), req: reqOf(sab), res: resOf(sab), mirror: mirrorOf(sab),
      pending: false,
      lastActive: Date.now(),
    };
    this.channels.set(botId, channel);
    this.publish(channel);
    return sab;
  }

  /**
   * Serve pending requests and advance the world while anything is in flight.
   * Returns when every attached bot is idle. Time only moves when a command is
   * actually counting down, so computing and reading are free.
   */
  pump(maxTicks = 100_000): void {
    this.serve();
    let ticks = 0;
    while (this.anyInFlight()) {
      if (++ticks > maxTicks) throw new Error(`pump exceeded ${maxTicks} ticks`);
      this.world.tick();
      this.publishAll();
      this.deliver();
      this.serve();
    }
    this.publishAll();
  }

  protected anyInFlight(): boolean {
    for (const ch of this.channels.values()) {
      if (this.world.getBot(ch.botId).action) return true;
    }
    return false;
  }

  /** Decode whatever workers have posted and act on it. */
  protected serve(): void {
    for (const ch of this.channels.values()) {
      if (Atomics.load(ch.ctrl, STATE) !== REQUEST) continue;
      if (ch.pending) continue; // already handed to the sim, still counting down
      ch.pending = true;
      ch.lastActive = Date.now();
      const request = readFrame(ch.req, Atomics.load(ch.ctrl, REQ_LEN)) as HostRequest;
      const immediate = this.dispatch(ch, request);
      if (immediate) this.reply(ch, immediate);
    }
  }

  /** Returns a result to reply with now, or null to wait for the sim. */
  private dispatch(ch: Channel, request: HostRequest): CommandResult | null {
    try {
      switch (request.kind) {
        case "command": {
          this.world.issue(ch.botId, request.command);
          return this.world.takeResult(ch.botId); // non-null only for immediate failures
        }
        case "colony":
          return { ok: true, value: request.call === "time" ? this.world.time : this.botViews() };
        case "research":
          this.world.queueResearch(request.name);
          return { ok: true, value: null };
        case "research-status":
          return { ok: true, value: this.researchStatus() };
        case "spawn":
          return this.doSpawn(request.source);
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Build a bot and, if this colony runs workers, start its script.
   *
   * The sim half and the worker half are split because a plain `Colony` has no
   * workers at all — it is the headless half the sim tests use — and it can
   * still legitimately answer "a bot was built". `ScriptColony` overrides the
   * hook to actually run the thing.
   */
  protected doSpawn(source: string): CommandResult {
    const why = this.world.canSpawn();
    if (why) return { ok: false, error: why };
    const bot = this.world.spawnBot();
    this.startSpawned(bot.id, source);
    // The id, so the spawning script can radio it or read it out of colony.bots().
    return { ok: true, value: bot.id };
  }

  /** What to do with a freshly built bot. Nothing, without workers. */
  protected startSpawned(_botId: number, _source: string): void {}

  /** Hand back results the sim has finished with. */
  protected deliver(): void {
    for (const ch of this.channels.values()) {
      if (Atomics.load(ch.ctrl, STATE) !== REQUEST || !ch.pending) continue;
      const result = this.world.takeResult(ch.botId);
      if (result) this.reply(ch, result);
    }
  }

  /**
   * Hand a result back through the channel.
   *
   * **An answer that does not fit must still be an answer.** `writeFrame` throws
   * when a result is larger than the response region — `bot.scanner.scan(7)` is
   * 225 tiles and about 19KB against a 16KB frame — and before milestone 10 that
   * throw escaped here. The consequences were all silent: `pending` stayed true
   * so `serve` skipped the channel forever, the worker stayed parked on
   * `Atomics.wait`, and the watchdog deliberately never fires for a channel that
   * is sitting on a REQUEST. The bot was dead for the rest of the session, the
   * fleet list said "idle", the status line said "ready", and the only trace
   * anywhere was an uncaught rejection in the browser's own console.
   *
   * So the overflow is converted into an ordinary failed result. The script gets
   * an error it can catch, on the line it called from, which is what the design's
   * "Failure is content" promises for everything else.
   */
  private reply(ch: Channel, result: CommandResult): void {
    let ok = result.ok;
    let length: number;
    try {
      length = writeFrame(ch.res, result.ok ? result.value : result.error);
    } catch {
      ok = false;
      // Deliberately not `writeFrame`'s own wording: "frame" is the bridge's
      // vocabulary and a player never sees it anywhere else. What they can act
      // on is that the call asked for too much at once.
      length = writeFrame(ch.res, "result too large to return — ask for less at once");
    }
    Atomics.store(ch.ctrl, RES_LEN, length);
    Atomics.store(ch.ctrl, RES_OK, ok ? 1 : 0);
    ch.pending = false;
    Atomics.store(ch.ctrl, STATE, RESULT);
    Atomics.notify(ch.ctrl, STATE);
  }

  protected publishAll(): void {
    for (const ch of this.channels.values()) this.publish(ch);
  }

  private publish(ch: Channel): void {
    publishMirror(ch.ctrl, ch.mirror, this.viewOf(ch.botId));
  }

  /**
   * What research has done, for a script that wants to know.
   *
   * `cost` is included so a script can work out a fraction without importing
   * `config.ts`, which it cannot: a worker sees the API and nothing else.
   */
  private researchStatus(): ResearchStatus {
    const research = this.world.research;
    const head = research.queue[0];
    return {
      unlocked: [...research.unlocked],
      queue: [...research.queue],
      progress: research.progress,
      cost: head ? RESEARCH_COST[head] : 0,
    };
  }

  private botViews(): BotView[] {
    return [...this.world.bots.keys()].map((id) => ({ id, ...this.viewOf(id) }));
  }

  private viewOf(botId: number): MirrorState {
    const bot = this.world.getBot(botId);
    return {
      time: this.world.time,
      pos: { ...bot.pos },
      inventory: { ...bot.inventory },
      modules: [...bot.modules],
      busy: bot.action !== null,
    };
  }
}

export type ScriptStatus = "done" | "error" | "hung" | "stopped";

export interface ScriptOutcome {
  botId: number;
  status: ScriptStatus;
  message?: string;
  /** 1-based line of the player's source that threw, when the error carried one. */
  line?: number;
  logs: string[];
}

/**
 * Callbacks for one run.
 *
 * Both exist because the returned promise is the wrong shape for a game. A
 * player's script is `while (true) { ... }` and never settles, so anything that
 * waits for the promise to see output would see nothing, ever. The UI watches
 * these instead and treats the promise as optional.
 */
export interface RunOptions {
  /** Fired as each `bot.log` arrives, not batched until the script ends. */
  onLog?: (message: string) => void;
  /** Fired once, the first time a verdict is reached. */
  onSettle?: (outcome: ScriptOutcome) => void;
}

export interface ScriptColonyOptions extends ColonyOptions {
  /**
   * How to start a worker. Required here so this file stays free of any
   * platform import; `host.ts` supplies the Node default for the test suite,
   * and the browser passes `spawnWeb`.
   */
  spawnWorker: SpawnWorker;
  /**
   * What advances simulated time. Defaults to `DemandClock`, which ticks only
   * while a command is counting down — the behaviour every headless test
   * depends on. The page passes a `RealtimeClock`.
   */
  clock?: Clock;
  /**
   * The colony's shared library, compiled into scope ahead of every script.
   *
   * A getter rather than a string on some callers, because the page edits it
   * while bots are running and a snapshot taken at construction would go stale
   * the first time the player saved. Headless callers pass a plain string.
   */
  library?: string | (() => string);
  /**
   * How to watch a bot that another bot's script built.
   *
   * Without this a spawned bot's logs and its dying error go nowhere: the page
   * wires `onLog` and `onSettle` when *it* starts a script, and nothing wires
   * them when a script does. Milestone 9's playtest found exactly that — a child
   * whose script threw on its first line, with the parent reporting success and
   * the fleet list saying "idle".
   */
  onSpawned?: (botId: number) => RunOptions;
}

/**
 * A Colony that can run player scripts in workers.
 *
 * The loop is demand-driven: requests are served the moment they appear, the
 * world only ticks while a command is counting down, and control is yielded to
 * the event loop in between so the worker can actually make progress.
 */
type Settled = { status: ScriptStatus; message?: string; line?: number };

/**
 * Yield to the event loop so a blocked worker can make progress.
 *
 * `setImmediate` is Node-only but matters: `setTimeout(r, 0)` is clamped to a
 * millisecond or more, which would put a floor of ~1ms under every simulated
 * tick and slow the whole suite. The browser has no such call, and does not
 * need one — there the drive loop is paced by the clock, not by this yield.
 */
const yieldToEventLoop: () => Promise<unknown> =
  typeof setImmediate === "function"
    ? () => new Promise((r) => setImmediate(r))
    : () => new Promise((r) => setTimeout(r, 0));

export class ScriptColony extends Colony {
  private readonly workers = new Map<number, WorkerHandle>();
  private readonly settlers = new Map<number, (o: Settled) => void>();
  private readonly spawnWorker: SpawnWorker;
  /** Read afresh per run, so the page can edit the library while bots run. */
  private readonly library: () => string;
  private readonly onSpawned?: (botId: number) => RunOptions;
  readonly clock: Clock;
  private pendingRuns = 0;
  private looping = false;

  constructor(opts: ScriptColonyOptions) {
    super(opts);
    this.spawnWorker = opts.spawnWorker;
    const library = opts.library ?? "";
    this.library = typeof library === "function" ? library : () => library;
    this.onSpawned = opts.onSpawned;
    this.clock = opts.clock ?? new DemandClock();
  }

  /**
   * Start a script. The returned promise resolves when the script settles —
   * which for a `while (true)` script is never, and that is fine. Callers that
   * need to see progress pass `onLog` and `onSettle` and ignore the promise.
   */
  async run(botId: number, source: string, opts: RunOptions = {}): Promise<ScriptOutcome> {
    const sab = this.channels.get(botId)?.sab ?? this.attach(botId);
    const logs: string[] = [];
    let settled: Settled | undefined;
    // First call wins: a worker's dying "error" message must not overwrite a
    // verdict the watchdog or stop() already delivered.
    const settle = (o: Settled): void => {
      if (settled) return;
      settled = o;
      opts.onSettle?.({ botId, logs, ...o });
    };
    this.settlers.set(botId, settle);

    // The watchdog measures idleness from `lastActive`, which is otherwise only
    // touched by attach, serve and stop. A channel that sat idle between runs —
    // the normal case for a player staring at the editor — would arrive here
    // already past `hungMs`, and the first pass would kill the new script
    // before it made a single call. Start its clock now.
    const channel = this.channels.get(botId);
    if (channel) channel.lastActive = Date.now();

    const worker = this.spawnWorker({ sab, botId, source, library: this.library() });
    this.workers.set(botId, worker);

    worker.onMessage((raw) => {
      const m = raw as { kind: string; message?: string; line?: number };
      if (m.kind === "log") {
        const message = String(m.message);
        logs.push(message);
        opts.onLog?.(message);
      }
      else if (m.kind === "done") settle({ status: "done" });
      else if (m.kind === "error") settle({ status: "error", message: m.message, line: m.line });
    });
    worker.onError((message) => settle({ status: "error", message }));

    this.pendingRuns++;
    try {
      void this.drive();
      while (!settled) await yieldToEventLoop();
      return { botId, logs, ...settled };
    } finally {
      this.pendingRuns--;
      // Only tear down what this run owns. A hot reload stops and restarts the
      // same bot immediately, so by the time this cleanup runs the channel may
      // already belong to a successor — and stopping it here would kill the
      // script the player just launched, leaving them with a dead bot and a
      // "stopped" they did not ask for.
      if (this.settlers.get(botId) === settle) this.settlers.delete(botId);
      if (this.workers.get(botId) === worker) await this.stop(botId);
    }
  }

  /** One shared drive loop, however many scripts are running, so bots block independently. */
  private async drive(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      while (this.pendingRuns > 0) {
        this.pass();
        await yieldToEventLoop();
      }
    } finally {
      this.looping = false;
    }
  }

  /**
   * One pass of the loop: serve what the workers posted, advance time by
   * whatever the clock says is due, hand back results, check for hangs.
   *
   * Public because the headless `drive()` loop is not the only caller. A page
   * paced by `requestAnimationFrame` drives this directly, which is also the
   * only way the world can age while no script is running at all — `drive()`
   * exits as soon as the last script settles, and a game's world should not.
   */
  pass(): void {
    this.serve();
    // Under DemandClock this is 1 exactly when something is counting down,
    // which is what the loop did before the clock was pluggable.
    const due = this.clock.ticksDue(this.anyInFlight());
    for (let i = 0; i < due; i++) {
      this.world.tick();
      this.publishAll();
      this.deliver();
    }
    this.checkHung();
  }

  /**
   * A channel idle for longer than `hungMs` means its script never asked for
   * anything — a bare infinite loop. A channel parked on a request (STATE
   * stays REQUEST, e.g. a blocking `receive()`) has asked; the sim just hasn't
   * answered yet, and never counts as hung however long that takes.
   */
  private checkHung(): void {
    for (const [botId, worker] of this.workers) {
      const ch = this.channels.get(botId);
      if (!ch) continue;
      if (Atomics.load(ch.ctrl, STATE) !== IDLE) continue;
      if (Date.now() - ch.lastActive <= this.hungMs) continue;
      this.settlers.get(botId)?.({
        status: "hung",
        message: `bot ${botId} made no world call for ${this.hungMs}ms`,
      });
      void worker.terminate();
    }
  }

  async stop(botId: number): Promise<void> {
    const worker = this.workers.get(botId);
    if (!worker) return;
    this.workers.delete(botId);
    this.settlers.get(botId)?.({ status: "stopped" });
    await worker.terminate();
    this.resetChannel(botId);
  }

  /**
   * A bot built by another bot's script, running from the moment it exists.
   *
   * Not awaited: `run` resolves when the script *settles*, which for the
   * `while (true)` loop a spawned bot usually gets is never. Awaiting here would
   * hang the spawning script on the lifetime of its child.
   */
  protected override startSpawned(botId: number, source: string): void {
    void this.run(botId, source, this.onSpawned?.(botId) ?? {});
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.workers.keys()].map((id) => this.stop(id)));
  }

  /**
   * A terminated worker will never collect the result of a command it issued,
   * so leaving that command counting down would block this bot forever. This
   * reaches into the sim's bot state directly — the only place the bridge does
   * so — to abandon it and leave the channel ready for the next worker.
   */
  private resetChannel(botId: number): void {
    const ch = this.channels.get(botId);
    if (!ch) return;
    const bot = this.world.getBot(botId);
    bot.action = null;
    bot.result = null;
    bot.blockedOn = null;
    ch.pending = false;
    Atomics.store(ch.ctrl, STATE, IDLE);
    ch.lastActive = Date.now();
  }
}
