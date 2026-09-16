import type {
  Direction,
  Item,
  MachineKind,
  Message,
  ResearchName,
  ScanTile,
} from "../sim/types";
import {
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  ctrlOf, mirrorOf, readFrame, reqOf, resOf, writeFrame,
} from "./protocol.ts";
import type { HostRequest, MirrorState, ResearchStatus } from "./protocol.ts";
import { readMirror } from "./mirror.ts";

export interface BotApi {
  move(dir: Direction): boolean;
  wait(ticks: number): void;
  pos(): { x: number; y: number };
  /** Keyed by item, so a beginner writes `bot.inventory().wheat ?? 0`. */
  inventory(): Record<string, number | undefined>;
  log(message: string): void;
  /**
   * Machine verbs. Unlike the module namespaces below these live on `bot`
   * directly: a crate is a machine standing on a tile, not a chassis module,
   * so there is no hardware namespace to hang them on. They fail with the
   * sim's own message when no crate is adjacent.
   */
  deposit(dir: Direction, item: Item, count: number): number;
  withdraw(dir: Direction, item: Item, count: number): number;

  /**
   * Module namespaces, declared optional so the shipped `.d.ts` is honest
   * about what a given chassis may not have and `bot.scanner?.scan(2)`
   * typechecks.
   *
   * Deliberate asymmetry: they are optional in the *type* but always present
   * at *runtime*. Making them genuinely undefined would replace the design's
   * promised "Bot 1 has no Scanner module" with a bare TypeError from the
   * engine, because the call would never reach the sim that knows how to say
   * that. The cost is that `if (bot.scanner)` is true whatever the chassis
   * carries; read `modules` from a bot view for real feature detection.
   *
   * Do not "fix" this by dropping the `?` or by returning undefined.
   */
  harvester?: { harvest(): boolean };
  planter?: { plant(item: Item): boolean };
  scanner?: { scan(radius: number): ScanTile[] };
  radio?: { send(channel: string, payload: unknown): number; receive(channel?: string): Message };
  /**
   * The builder arm: the first verbs that change the world's layout rather than
   * moving through it.
   *
   * `facing` is which way the new machine points and defaults to `dir`, so the
   * natural loop lays a line pointing the way the bot is walking:
   *
   * ```js
   * for (let i = 0; i < 5; i++) {
   *   bot.builder.place("conveyor", "north");
   *   bot.move("north");
   * }
   * ```
   *
   * Both throw the sim's own reason when they refuse — "tile occupied",
   * "conveyor not researched", "crate is not empty" — so a script that might
   * build over something should be ready to catch one.
   */
  builder?: {
    place(machine: MachineKind, dir: Direction, facing?: Direction): boolean;
    remove(dir: Direction): boolean;
  };
}

export interface ColonyApi {
  bots(): Array<MirrorState & { id: number }>;
  time(): number;
  research: {
    queue(name: ResearchName): void;
    /**
     * What has finished, what is queued, and how far the head of the queue has
     * got. Costs no ticks, like every other read.
     *
     * Before this, queueing was write-only: a script could ask for the planter
     * and had no way at all to learn it had arrived, so the reference script
     * waited on a number worked out on paper.
     *
     * ```js
     * const r = colony.research.status();
     * if (!r.unlocked.includes("conveyor")) bot.log(r.progress + "/" + r.cost);
     * ```
     */
    status(): ResearchStatus;
  };
  /**
   * The Fabricator, if one has been researched. Builds a bot and starts it.
   *
   * ```js
   * const id = colony.fabricator.spawn(() => {
   *   while (true) { bot.harvester.harvest(); bot.move("east"); }
   * });
   * ```
   *
   * **The function is source, not a closure.** What crosses to the new bot is
   * `script.toString()`, because a function cannot travel between workers. A
   * variable from the script that called `spawn` is therefore *not* in scope
   * inside it, and referring to one is a reference error in the new bot rather
   * than in this one. What *is* in scope is `bot`, `colony`, and everything in
   * the shared library — which is where code meant for more than one bot goes.
   *
   * Returns the new bot's id, so the caller can radio it or find it in
   * `colony.bots()`. Refuses with the sim's own reason when there is no
   * fabricator, no spare chassis, or no free tile beside the machine.
   *
   * Optional in the type and present at runtime, like every module namespace —
   * `api.ts` documents that asymmetry at length above and it is settled.
   */
  fabricator?: {
    spawn(script: () => void): number;
  };
}

/** Posted to the host thread out of band; logging never blocks the script. */
export type LogMessage = { kind: "log"; botId: number; message: string };

export function makeApi(
  sab: SharedArrayBuffer,
  botId: number,
  onLog: (m: LogMessage) => void = () => {},
): { bot: BotApi; colony: ColonyApi } {
  const ctrl = ctrlOf(sab);
  const req = reqOf(sab);
  const res = resOf(sab);
  const mirror = mirrorOf(sab);

  /** Post a request and park until the host answers. */
  function call(request: HostRequest): unknown {
    Atomics.store(ctrl, REQ_LEN, writeFrame(req, request));
    Atomics.store(ctrl, STATE, REQUEST);
    Atomics.notify(ctrl, STATE);
    while (Atomics.load(ctrl, STATE) !== RESULT) Atomics.wait(ctrl, STATE, REQUEST);
    const ok = Atomics.load(ctrl, RES_OK) === 1;
    const value = readFrame(res, Atomics.load(ctrl, RES_LEN));
    Atomics.store(ctrl, STATE, IDLE);
    if (!ok) throw new Error(String(value));
    return value;
  }

  const read = (): MirrorState => readMirror(ctrl, mirror) as MirrorState;

  const bot: BotApi = {
    move: (dir) => call({ kind: "command", command: { kind: "move", dir } }) as boolean,
    wait: (ticks) => void call({ kind: "command", command: { kind: "wait", ticks } }),
    pos: () => read().pos,
    inventory: () => read().inventory,
    log: (message) => onLog({ kind: "log", botId, message }),
    deposit: (dir, item, count) =>
      call({ kind: "command", command: { kind: "deposit", dir, item, count } }) as number,
    withdraw: (dir, item, count) =>
      call({ kind: "command", command: { kind: "withdraw", dir, item, count } }) as number,
    harvester: {
      harvest: () => call({ kind: "command", command: { kind: "harvest" } }) as boolean,
    },
    planter: {
      plant: (item) => call({ kind: "command", command: { kind: "plant", item } }) as boolean,
    },
    scanner: {
      scan: (radius) => call({ kind: "command", command: { kind: "scan", radius } }) as ScanTile[],
    },
    radio: {
      send: (channel, payload) =>
        call({ kind: "command", command: { kind: "send", channel, payload } }) as number,
      receive: (channel) =>
        call({ kind: "command", command: { kind: "receive", channel } }) as Message,
    },
    builder: {
      place: (machine, dir, facing) =>
        call({ kind: "command", command: { kind: "place", machine, dir, facing } }) as boolean,
      remove: (dir) => call({ kind: "command", command: { kind: "remove", dir } }) as boolean,
    },
  };

  const colony: ColonyApi = {
    bots: () => call({ kind: "colony", call: "bots" }) as Array<MirrorState & { id: number }>,
    time: () => call({ kind: "colony", call: "time" }) as number,
    research: {
      queue: (name) => void call({ kind: "research", name }),
      status: () => call({ kind: "research-status" }) as ResearchStatus,
    },
    fabricator: {
      // `${script}` rather than a template of the body: a function's own text
      // includes its parameter list and braces, so wrapping it in a call is what
      // makes an arrow, a function expression and a named function all work.
      spawn: (script) => call({ kind: "spawn", source: `(${script})();` }) as number,
    },
  };

  return { bot, colony };
}
