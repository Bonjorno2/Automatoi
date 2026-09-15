import { createRng } from "./rng";
import { addItem, removeItem, total } from "./inventory";
import {
  BOT_CAPACITY,
  CROP_GROWTH,
  FIELD_RADIUS,
  MACHINE_CAPACITY,
  RECIPE,
  RESEARCH_COST,
  RESEARCH_ITEM,
  TICK_COST,
  WHEAT_GROWTH_TICKS,
  WILD_WHEAT_CHANCE,
} from "./config";
import type { Recipe } from "./config";
import type {
  Bot,
  Command,
  CommandResult,
  Direction,
  Item,
  Machine,
  MachineKind,
  ModuleName,
  ResearchName,
  ResearchState,
  ScanTile,
  Tile,
  Vec,
  WorldSnapshot,
} from "./types";
import type { WorldEvent } from "./events";

export interface WorldOptions {
  seed: number;
  width?: number;
  height?: number;
}

/** Events retained between drains. Oldest are dropped past this. */
const MAX_EVENTS = 64;

const RETRY = Symbol("retry");
type Outcome = CommandResult | typeof RETRY;

const ok = (value: unknown): CommandResult => ({ ok: true, value });
const fail = (error: string): CommandResult => ({ ok: false, error });

const MODULE_FOR: Partial<Record<Command["kind"], ModuleName>> = {
  harvest: "harvester",
  plant: "planter",
  scan: "scanner",
  send: "radio",
  receive: "radio",
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Exported so a renderer can interpolate a move without restating the mapping. */
export const DIR: Record<Direction, Vec> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

/** Growth at which an item is harvestable. Infinite for anything not a crop. */
const ripeAt = (item: Item): number => CROP_GROWTH[item] ?? Infinity;

/** Typed Object.entries over an item -> count map. */
const entries = (stack: Partial<Record<Item, number>>): [Item, number][] =>
  Object.entries(stack) as [Item, number][];

/** How far through its conversion a machine is, in [0, 1). 0 when idle. */
function machineProgress(machine: Machine): number {
  const recipe = RECIPE[machine.kind];
  if (!recipe || machine.progress <= 0) return 0;
  return Math.min(1, (machine.progress - 1) / recipe.ticks);
}

export class World {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  readonly tiles: Tile[] = [];
  readonly bots = new Map<number, Bot>();
  readonly machines = new Map<number, Machine>();
  readonly research: ResearchState = {
    unlocked: new Set(),
    queue: [],
    progress: 0,
    spareModules: {},
    spareChassis: 0,
  };
  time = 0;
  private nextId = 1;

  /**
   * Events since the last drain, oldest first, capped.
   *
   * Capped because nothing guarantees a consumer: a headless test drains never,
   * and an uncapped list would grow for as long as the test ran. Dropping the
   * oldest is right for the only consumer there is — a renderer showing what
   * just happened does not want a backlog from ten seconds ago.
   */
  private events: WorldEvent[] = [];
  /** Machines already reported as starved, so the event fires on the edge only. */
  private starved = new Set<number>();
  /** The same, for machines with output they cannot put down. */
  private jammed = new Set<number>();

  constructor(opts: WorldOptions) {
    this.seed = opts.seed;
    this.width = opts.width ?? 32;
    this.height = opts.height ?? 32;
    this.generate();
  }

  private generate(): void {
    const rng = createRng(this.seed);
    const centre = { x: Math.floor(this.width / 2), y: Math.floor(this.height / 2) };
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const dist = Math.max(Math.abs(x - centre.x), Math.abs(y - centre.y));
        const inField = dist <= FIELD_RADIUS;
        const tile: Tile = { terrain: inField ? "soil" : "grass", crop: null };
        if (inField && rng() < WILD_WHEAT_CHANCE) {
          tile.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
        }
        this.tiles.push(tile);
      }
    }
    // Bot first so it is always id 1; the console becomes id 2.
    this.addBot({ x: centre.x + 1, y: centre.y }, ["harvester"]);
    this.addMachine("console", centre);
  }

  // ---- lookups ----

  inBounds(p: Vec): boolean {
    return p.x >= 0 && p.y >= 0 && p.x < this.width && p.y < this.height;
  }

  tileAt(p: Vec): Tile | undefined {
    return this.inBounds(p) ? this.tiles[p.y * this.width + p.x] : undefined;
  }

  botAt(p: Vec): Bot | undefined {
    for (const b of this.bots.values()) {
      if (b.pos.x === p.x && b.pos.y === p.y) return b;
    }
    return undefined;
  }

  machineAt(p: Vec): Machine | undefined {
    for (const m of this.machines.values()) {
      if (m.pos.x === p.x && m.pos.y === p.y) return m;
    }
    return undefined;
  }

  getBot(id: number): Bot {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`no bot ${id}`);
    return bot;
  }

  // ---- command loop ----

  /** Attach a command to a bot. Validation failures resolve immediately. */
  issue(botId: number, command: Command): void {
    const bot = this.getBot(botId);
    if (bot.action) throw new Error(`bot ${botId} is busy`);
    bot.result = null;
    const needed = MODULE_FOR[command.kind];
    if (needed && !bot.modules.has(needed)) {
      bot.result = fail(`Bot ${botId} has no ${capitalise(needed)} module`);
      return;
    }
    const cost = command.kind === "wait" ? command.ticks : TICK_COST[command.kind];
    bot.action = { command, remaining: cost, total: cost };
  }

  /**
   * Take every event since the last call, and clear them.
   *
   * The only reader. `snapshot()` deliberately does not carry events: a
   * snapshot is a statement about what the world *is*, and two worlds that
   * diverge only in what they recently failed at are still the same world.
   */
  drainEvents(): WorldEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  private emit(event: WorldEvent): void {
    if (this.events.length >= MAX_EVENTS) this.events.shift();
    this.events.push(event);
  }

  /** Return and clear the bot's pending result, or null if none yet. */
  takeResult(botId: number): CommandResult | null {
    const bot = this.getBot(botId);
    const r = bot.result;
    bot.result = null;
    return r;
  }

  /** Plain, JSON-safe copy of the world for rendering and saving. */
  snapshot(): WorldSnapshot {
    return {
      seed: this.seed,
      width: this.width,
      height: this.height,
      time: this.time,
      tiles: this.tiles.map((t) => ({
        terrain: t.terrain,
        crop: t.crop ? { ...t.crop } : null,
      })),
      bots: [...this.bots.values()].map((b) => ({
        id: b.id,
        pos: { ...b.pos },
        inventory: { ...b.inventory },
        modules: [...b.modules],
        busy: b.action !== null,
        blockedOn: b.blockedOn,
        action: b.action
          ? {
              kind: b.action.command.kind,
              dir: b.action.command.kind === "move" ? b.action.command.dir : null,
              remaining: b.action.remaining,
              total: b.action.total,
            }
          : null,
      })),
      machines: [...this.machines.values()].map((m) => ({
        id: m.id,
        kind: m.kind,
        pos: { ...m.pos },
        inventory: { ...m.inventory },
        starved: this.starved.has(m.id),
        jammed: this.jammed.has(m.id),
        progress: machineProgress(m),
      })),
      research: {
        unlocked: [...this.research.unlocked],
        queue: [...this.research.queue],
        progress: this.research.progress,
        spareModules: { ...this.research.spareModules },
        spareChassis: this.research.spareChassis,
      },
    };
  }

  /** Advance the world by one tick. */
  tick(): void {
    this.time++;
    this.growCrops();
    for (const bot of this.bots.values()) this.advance(bot);
    this.advanceMachines();
    this.advanceResearch();
  }

  /**
   * Run every machine that has a recipe, one tick's worth.
   *
   * The ordering rule that matters: **room for the output is checked before the
   * input is consumed.** A machine that eats three wheat and then discovers it
   * cannot store the flour has destroyed the wheat, and a player watching their
   * harvest disappear into a full mill would be right to call that a bug.
   */
  private advanceMachines(): void {
    for (const machine of this.machines.values()) {
      const recipe = RECIPE[machine.kind];
      if (!recipe) continue;

      if (machine.progress > 0) {
        machine.progress++;
        if (machine.progress <= recipe.ticks) continue;
        for (const [item, n] of entries(recipe.output)) addItem(machine.inventory, item, n);
        machine.progress = 0;
        continue;
      }

      if (!this.hasInputs(machine, recipe)) {
        this.flag(this.starved, machine, "starved");
        this.starved.add(machine.id);
        continue;
      }
      this.starved.delete(machine.id);

      if (!this.hasRoomFor(machine, recipe)) {
        this.flag(this.jammed, machine, "jammed");
        this.jammed.add(machine.id);
        continue;
      }
      this.jammed.delete(machine.id);

      for (const [item, n] of entries(recipe.input)) removeItem(machine.inventory, item, n);
      machine.progress = 1;
    }
  }

  private hasInputs(machine: Machine, recipe: Recipe): boolean {
    return entries(recipe.input).every(([item, n]) => (machine.inventory[item] ?? 0) >= n);
  }

  /**
   * Room for the output, counted per item.
   *
   * Consuming three wheat does not make room for flour, because wheat and flour
   * have separate limits. That is what lets a mill nobody collects from back up
   * while its input keeps arriving.
   */
  private hasRoomFor(machine: Machine, recipe: Recipe): boolean {
    return entries(recipe.output).every(
      ([item, n]) => (machine.inventory[item] ?? 0) + n <= MACHINE_CAPACITY,
    );
  }

  /** Emit a machine-state event on the edge only, never once per tick. */
  private flag(seen: Set<number>, machine: Machine, kind: "starved" | "jammed"): void {
    if (seen.has(machine.id)) return;
    this.emit({ kind, machineId: machine.id, pos: { ...machine.pos } });
  }

  private growCrops(): void {
    for (const tile of this.tiles) {
      if (!tile.crop) continue;
      if (tile.crop.growth < ripeAt(tile.crop.item)) tile.crop.growth++;
    }
  }

  private advance(bot: Bot): void {
    if (!bot.action) return;
    bot.action.remaining--;
    if (bot.action.remaining > 0) return;
    const outcome = this.execute(bot, bot.action.command);
    if (outcome === RETRY) {
      bot.action.remaining = 1;
      return;
    }
    bot.action = null;
    bot.blockedOn = null;
    bot.result = outcome;
  }

  private execute(bot: Bot, cmd: Command): Outcome {
    switch (cmd.kind) {
      case "wait":
        return ok(undefined);
      case "move":
        return this.doMove(bot, cmd.dir);
      case "harvest":
        return this.doHarvest(bot);
      case "plant":
        return this.doPlant(bot, cmd.item);
      case "scan":
        return this.doScan(bot, cmd.radius);
      case "deposit":
        return this.doDeposit(bot, cmd.dir, cmd.item, cmd.count);
      case "withdraw":
        return this.doWithdraw(bot, cmd.dir, cmd.item, cmd.count);
      case "send":
        return this.doSend(bot, cmd.channel, cmd.payload);
      case "receive":
        return this.doReceive(bot, cmd.channel);
      default: {
        const never: never = cmd;
        return fail(`unknown command ${String(never)}`);
      }
    }
  }

  private doMove(bot: Bot, dir: Direction): Outcome {
    const target = add(bot.pos, DIR[dir]);
    if (!this.inBounds(target) || this.machineAt(target)) {
      // Milestone 3's findings 2 and 3: walking into the world's edge and
      // walking into the Research Console are the same silent failure, and a
      // naive `while (true)` loop does both forever without a single signal.
      this.emit({ kind: "bump", botId: bot.id, pos: { ...bot.pos }, dir });
      return ok(false);
    }
    if (this.botAt(target)) {
      // On the edge only: a bot can wait here for many ticks, and one event per
      // tick of waiting is a stream, not a signal.
      if (bot.blockedOn !== "bot") {
        this.emit({ kind: "blocked", botId: bot.id, pos: { ...bot.pos }, on: "bot" });
      }
      bot.blockedOn = "bot";
      return RETRY;
    }
    bot.pos = target;
    return ok(true);
  }

  private doHarvest(bot: Bot): Outcome {
    const tile = this.tileAt(bot.pos);
    if (!tile?.crop || tile.crop.growth < ripeAt(tile.crop.item)) {
      this.emit({ kind: "refused", botId: bot.id, pos: { ...bot.pos }, command: "harvest" });
      return ok(false);
    }
    if (total(bot.inventory) >= BOT_CAPACITY) {
      this.emit({ kind: "full", botId: bot.id, pos: { ...bot.pos } });
      return fail("inventory full");
    }
    addItem(bot.inventory, tile.crop.item, 1);
    tile.crop = null;
    return ok(true);
  }

  private doPlant(bot: Bot, item: Item): Outcome {
    const tile = this.tileAt(bot.pos);
    const refuse = (): Outcome => {
      this.emit({ kind: "refused", botId: bot.id, pos: { ...bot.pos }, command: "plant" });
      return ok(false);
    };
    // Flour is not a seed. An item with no entry in CROP_GROWTH cannot be
    // planted, and refusing here is what keeps that rule in one place.
    if (CROP_GROWTH[item] === undefined) return refuse();
    if (!tile || tile.terrain !== "soil" || tile.crop) return refuse();
    if ((bot.inventory[item] ?? 0) < 1) return refuse();
    removeItem(bot.inventory, item, 1);
    tile.crop = { item, growth: 0 };
    return ok(true);
  }

  private doScan(bot: Bot, radius: number): Outcome {
    const r = Math.max(0, Math.floor(radius));
    const out: ScanTile[] = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const p = { x: bot.pos.x + dx, y: bot.pos.y + dy };
        const tile = this.tileAt(p);
        if (!tile) continue;
        out.push({
          x: p.x,
          y: p.y,
          terrain: tile.terrain,
          crop: tile.crop ? { ...tile.crop } : null,
          bot: this.botAt(p)?.id ?? null,
          machine: this.machineAt(p)?.kind ?? null,
        });
      }
    }
    return ok(out);
  }

  private doDeposit(bot: Bot, dir: Direction, item: Item, count: number): Outcome {
    const machine = this.machineAt(add(bot.pos, DIR[dir]));
    if (!machine) return fail(`no machine to the ${dir}`);
    // Capped by the machine's room for *this item* as well as the bot's stock.
    // A partial transfer is the right answer: refusing the whole thing would
    // leave a bot holding cargo it could have delivered most of.
    const room = MACHINE_CAPACITY - (machine.inventory[item] ?? 0);
    const n = Math.min(Math.max(0, Math.floor(count)), bot.inventory[item] ?? 0, Math.max(0, room));
    if (n > 0) {
      removeItem(bot.inventory, item, n);
      addItem(machine.inventory, item, n);
    }
    return ok(n);
  }

  private doWithdraw(bot: Bot, dir: Direction, item: Item, count: number): Outcome {
    const machine = this.machineAt(add(bot.pos, DIR[dir]));
    if (!machine) return fail(`no machine to the ${dir}`);
    const room = BOT_CAPACITY - total(bot.inventory);
    const n = Math.min(Math.max(0, Math.floor(count)), machine.inventory[item] ?? 0, room);
    if (n > 0) {
      removeItem(machine.inventory, item, n);
      addItem(bot.inventory, item, n);
    }
    return ok(n);
  }

  private doSend(bot: Bot, channel: string, payload: unknown): Outcome {
    let delivered = 0;
    for (const other of this.bots.values()) {
      if (other.id === bot.id || !other.modules.has("radio")) continue;
      other.inbox.push({ channel, payload, from: bot.id });
      delivered++;
    }
    return ok(delivered);
  }

  private doReceive(bot: Bot, channel?: string): Outcome {
    const idx = bot.inbox.findIndex((m) => channel === undefined || m.channel === channel);
    if (idx < 0) {
      if (bot.blockedOn !== "radio") {
        this.emit({ kind: "blocked", botId: bot.id, pos: { ...bot.pos }, on: "radio" });
      }
      bot.blockedOn = "radio";
      return RETRY;
    }
    const [msg] = bot.inbox.splice(idx, 1);
    return ok(msg);
  }

  // ---- player (UI) actions, gated by research stock ----

  /**
   * Why a machine cannot go here, or null if it can.
   *
   * Exists so that the UI showing a red ghost and the sim refusing the click
   * are the *same* rule rather than two copies of it. A build menu that decided
   * for itself where a mill fits would drift from this the first time a rule
   * changed, and the player would find out by clicking.
   */
  canPlace(kind: MachineKind, pos: Vec): string | null {
    if (kind === "console") return "cannot place a second console";
    if (!this.research.unlocked.has(kind)) return `${kind} not researched`;
    return this.tileBlocked(pos);
  }

  /** The same question for a spare chassis. */
  canDeploy(pos: Vec): string | null {
    if (this.research.spareChassis < 1) return "no spare chassis";
    return this.tileBlocked(pos);
  }

  /** Place a new bot using a spare chassis from research. */
  deployBot(pos: Vec): Bot {
    const why = this.canDeploy(pos);
    if (why) throw new Error(why);
    this.research.spareChassis--;
    return this.addBot(pos, ["harvester"]);
  }

  /** Place a machine the player has researched. */
  placeMachine(kind: MachineKind, pos: Vec): Machine {
    const why = this.canPlace(kind, pos);
    if (why) throw new Error(why);
    return this.addMachine(kind, pos);
  }

  private tileBlocked(pos: Vec): string | null {
    if (!this.inBounds(pos)) return "out of bounds";
    if (this.botAt(pos) || this.machineAt(pos)) return "tile occupied";
    return null;
  }

  // ---- research ----

  queueResearch(name: ResearchName): void {
    if (!(name in RESEARCH_COST)) throw new Error(`unknown research ${name}`);
    if (this.research.unlocked.has(name)) throw new Error(`${name} already researched`);
    if (this.research.queue.includes(name)) throw new Error(`${name} already queued`);
    this.research.queue.push(name);
  }

  installModule(botId: number, module: ModuleName): void {
    const bot = this.getBot(botId);
    const spare = this.research.spareModules[module] ?? 0;
    if (spare < 1) throw new Error(`no spare ${module} module`);
    if (bot.modules.has(module)) throw new Error(`bot ${botId} already has ${module}`);
    this.research.spareModules[module] = spare - 1;
    bot.modules.add(module);
  }

  private console(): Machine {
    for (const m of this.machines.values()) if (m.kind === "console") return m;
    throw new Error("world has no console");
  }

  private advanceResearch(): void {
    const r = this.research;
    const current = r.queue[0];
    const console = this.console();
    if (!current) {
      this.starved.delete(console.id);
      return;
    }
    const fuel = RESEARCH_ITEM[current] ?? "wheat";
    if ((console.inventory[fuel] ?? 0) < 1) {
      // A research queued with nothing to eat is a machine starved for input.
      // Before this event there was no signal at all: the player queued the
      // planter, forgot to deliver, and watched a progress bar that never
      // moved for a reason nothing on screen explained.
      if (!this.starved.has(console.id)) {
        this.emit({ kind: "starved", machineId: console.id, pos: { ...console.pos } });
        this.starved.add(console.id);
      }
      return;
    }
    this.starved.delete(console.id);
    removeItem(console.inventory, fuel, 1);
    r.progress++;
    if (r.progress < RESEARCH_COST[current]) return;
    r.queue.shift();
    r.progress = 0;
    r.unlocked.add(current);
    this.emit({ kind: "research", name: current, pos: { ...console.pos } });
    this.grant(current);
  }

  private grant(name: ResearchName): void {
    switch (name) {
      case "chassis":
        this.research.spareChassis++;
        return;
      case "planter":
      case "scanner":
      case "radio":
        this.research.spareModules[name] = (this.research.spareModules[name] ?? 0) + 1;
        return;
      case "crate":
        return; // unlocks placeMachine("crate"), nothing to stock
    }
  }

  // ---- entity creation (private until research gates them) ----

  private addBot(pos: Vec, modules: ModuleName[]): Bot {
    const bot: Bot = {
      id: this.nextId++,
      pos: { ...pos },
      inventory: {},
      modules: new Set(modules),
      action: null,
      result: null,
      inbox: [],
      blockedOn: null,
    };
    this.bots.set(bot.id, bot);
    return bot;
  }

  private addMachine(kind: MachineKind, pos: Vec): Machine {
    const tile = this.tileAt(pos);
    if (tile) tile.crop = null;
    const machine: Machine = { id: this.nextId++, kind, pos: { ...pos }, inventory: {}, progress: 0 };
    this.machines.set(machine.id, machine);
    return machine;
  }
}
