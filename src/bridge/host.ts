import { World } from "../sim/world";
import type { CommandResult } from "../sim/types";
import {
  REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  createChannel, ctrlOf, mirrorOf, readFrame, reqOf, resOf, writeFrame,
} from "./protocol.ts";
import type { HostRequest, MirrorState } from "./protocol.ts";
import { publishMirror } from "./mirror.ts";

export interface ColonyOptions {
  world: World;
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
}

export class Colony {
  readonly world: World;
  protected readonly channels = new Map<number, Channel>();

  constructor(opts: ColonyOptions) {
    this.world = opts.world;
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
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Hand back results the sim has finished with. */
  protected deliver(): void {
    for (const ch of this.channels.values()) {
      if (Atomics.load(ch.ctrl, STATE) !== REQUEST || !ch.pending) continue;
      const result = this.world.takeResult(ch.botId);
      if (result) this.reply(ch, result);
    }
  }

  private reply(ch: Channel, result: CommandResult): void {
    const payload = result.ok ? result.value : result.error;
    Atomics.store(ch.ctrl, RES_LEN, writeFrame(ch.res, payload));
    Atomics.store(ch.ctrl, RES_OK, result.ok ? 1 : 0);
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
