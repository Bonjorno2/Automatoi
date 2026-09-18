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

/*
 * The numbers in the JSDoc below are written as `%name%` and substituted by
 * `scripts/generate-dts.ts` from `config.ts` and `protocol.ts`. Hover text that
 * quotes a tick cost is hover text that goes stale the first time the cost is
 * tuned, and the design says outright that these are tuned in playtests. An
 * unknown placeholder fails the generator rather than shipping as literal `%`.
 */

export interface BotApi {
  /**
   * Step one tile. Costs %ticks.move% ticks.
   *
   * Answers `false` rather than throwing when the way is blocked — the world's
   * edge, a machine, another bot — so a loop can turn around instead of dying.
   *
   * ```js
   * if (!bot.move("east")) bot.move("south");
   * ```
   */
  move(dir: Direction): boolean;
  /**
   * Do nothing for `ticks` ticks, and cost exactly that many.
   *
   * The way to poll without spinning: a `while` loop with no world call in it
   * burns the per-tick CPU budget and gets the bot hung.
   */
  wait(ticks: number): void;
  /** Where this bot is standing. Costs no ticks, like every read. */
  pos(): { x: number; y: number };
  /**
   * What this bot is carrying, keyed by item, so a beginner writes
   * `bot.inventory().wheat ?? 0`. Costs no ticks.
   *
   * A chassis holds %BOT_CAPACITY% items **in total**, not %BOT_CAPACITY% of
   * each. At that point `harvest()` starts answering `false`.
   */
  inventory(): Record<string, number | undefined>;
  /** Write a line to this bot's console panel. Costs no ticks and never blocks. */
  log(message: string): void;
  /**
   * Machine verbs. Unlike the module namespaces below these live on `bot`
   * directly: a crate is a machine standing on a tile, not a chassis module,
   * so there is no hardware namespace to hang them on. They fail with the
   * sim's own message when no crate is adjacent.
   *
   * Both cost %ticks.deposit% tick and answer with **how many actually moved**,
   * which can be fewer than asked and can be 0: a deposit is capped by the
   * machine's room for that item (%MACHINE_CAPACITY% of each, %CONVEYOR_CAPACITY%
   * on a belt) and a withdraw by the room left on the chassis. A partial
   * transfer is the answer rather than a refusal, so check the number.
   *
   * ```js
   * const moved = bot.deposit("north", "wheat", bot.inventory().wheat ?? 0);
   * if (moved === 0) bot.log("crate is full");
   * ```
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
  harvester?: {
    /**
     * Take the mature crop under the bot. Costs %ticks.harvest% ticks.
     *
     * Answers `false` and never throws: `false` for bare ground, for a crop
     * still growing, and — since milestone 10's playtest — for a full chassis.
     * A wheat tile ripens %growth.wheat% ticks after it is planted.
     *
     * ```js
     * while (true) {
     *   bot.harvester.harvest();
     *   bot.move("east");
     * }
     * ```
     */
    harvest(): boolean;
  };
  planter?: {
    /**
     * Sow one seed from this bot's own inventory into the soil under it. Costs
     * %ticks.plant% ticks.
     *
     * Answers `false` without spending anything when the item is not a seed,
     * when the tile is grass or already planted, or when the bot is not
     * carrying one — so harvest before you plant.
     *
     * ```js
     * if (bot.harvester.harvest()) bot.planter.plant("wheat");
     * ```
     */
    plant(item: Item): boolean;
  };
  scanner?: {
    /**
     * Read the square of tiles within `radius` of the bot — `(2r+1)²` of them,
     * each with its terrain, crop, bot id and machine. Costs %ticks.scan% tick
     * however wide it is.
     *
     * **Radius 6 is the largest that fits.** A result crosses back through a
     * %RES_BYTES%-byte channel, and at radius 7 it does not fit: the call
     * throws `result too large to return — ask for less at once`, which a
     * planner should catch and retry narrower. Measured, in milestone 10's
     * playtest, after a radius-8 scan killed a bot outright.
     *
     * ```js
     * for (const tile of bot.scanner.scan(2)) {
     *   if (tile.crop) bot.log("crop at " + tile.x + "," + tile.y);
     * }
     * ```
     */
    scan(radius: number): ScanTile[];
  };
  radio?: {
    /**
     * Broadcast on a channel to every other bot that has a radio, and answer
     * with how many heard it. Costs %ticks.send% tick.
     *
     * Zero back means nobody was listening — the payload is gone, not queued
     * for a bot that has not been built yet.
     */
    send(channel: string, payload: unknown): number;
    /**
     * Take the next message, optionally only from one channel. Costs
     * %ticks.receive% tick when one is already queued and **blocks this bot
     * indefinitely** when none is.
     *
     * Blocking is per bot: one bot parked here never stalls another. There is
     * no way to ask without blocking, so the bot that waits should be the one
     * with nothing else to do.
     *
     * ```js
     * while (true) {
     *   const order = bot.radio.receive("haul");
     *   bot.log("bot " + order.from + " wants " + JSON.stringify(order.payload));
     * }
     * ```
     */
    receive(channel?: string): Message;
  };
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
   * build over something should be ready to catch one. Each costs
   * %ticks.place% ticks, which is what makes a long belt run a real expense in
   * a script's own budget rather than a free stamp.
   */
  builder?: {
    place(machine: MachineKind, dir: Direction, facing?: Direction): boolean;
    remove(dir: Direction): boolean;
  };
}

export interface ColonyApi {
  /**
   * Every bot in the colony, this one included, as read-only views: position,
   * inventory, fitted modules, and whether a command is in flight. Costs no
   * ticks.
   *
   * `busy` means "has a command running", which is true of a bot working and
   * equally true of a bot deadlocked against another — it is not a liveness
   * check.
   */
  bots(): Array<MirrorState & { id: number }>;
  /** The world's tick count. Costs no ticks, and is the same number for every bot. */
  time(): number;
  /**
   * Whether a machine would go on a tile — **any** tile, not just one this bot
   * is standing next to. Costs no ticks.
   *
   * This is the question a planner has: where to walk, before walking there.
   * `bot.builder.place` can only ever answer about the four tiles around the
   * bot, and answers by throwing.
   *
   * It pairs with a scan, because a scan tile already has an `x` and a `y`:
   *
   * ```js
   * const spot = bot.scanner.scan(4).find((t) => colony.canPlace(t, "crate"));
   * ```
   *
   * **It is a snapshot, not a reservation.** True means the tile is free now;
   * another bot can be standing on it by the time you arrive, so the `place`
   * that follows can still fail and should still be caught. Placing is also what
   * tells you *why* not — this answers yes or no, and the arm says the rest.
   *
   * A kind nobody has researched is `false`. A kind that does not exist is an
   * error, because that one is a typo.
   */
  canPlace(pos: { x: number; y: number }, machine: MachineKind): boolean;
  research: {
    /**
     * Ask the Research Console for something. Costs no ticks; the console pays
     * for it in harvested goods, and a queued item arrives whenever the goods do.
     *
     * Write-only on its own — `status()` is how a script learns it landed.
     */
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
    // `pos` is narrowed to the two fields rather than passed whole: a scan tile
    // is a legal argument by structure, and sending one back would put its
    // terrain, crop and machine through the request frame for nothing.
    canPlace: (pos, machine) =>
      call({ kind: "can-place", pos: { x: pos.x, y: pos.y }, machine }) as boolean,
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
