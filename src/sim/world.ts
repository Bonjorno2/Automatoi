import { createRng } from "./rng";
import { addItem, removeItem, total } from "./inventory";
import {
  BOT_CAPACITY,
  FIELD_RADIUS,
  TICK_COST,
  WHEAT_GROWTH_TICKS,
  WILD_WHEAT_CHANCE,
} from "./config";
import type {
  Bot,
  Command,
  CommandResult,
  Direction,
  Item,
  Machine,
  MachineKind,
  ModuleName,
  ResearchState,
  ScanTile,
  Tile,
  Vec,
} from "./types";

export interface WorldOptions {
  seed: number;
  width?: number;
  height?: number;
}

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

const DIR: Record<Direction, Vec> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

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
    bot.action = { command, remaining: cost };
  }

  /** Return and clear the bot's pending result, or null if none yet. */
  takeResult(botId: number): CommandResult | null {
    const bot = this.getBot(botId);
    const r = bot.result;
    bot.result = null;
    return r;
  }

  /** Advance the world by one tick. */
  tick(): void {
    this.time++;
    this.growCrops();
    for (const bot of this.bots.values()) this.advance(bot);
  }

  private growCrops(): void {
    for (const tile of this.tiles) {
      if (tile.crop && tile.crop.growth < WHEAT_GROWTH_TICKS) tile.crop.growth++;
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
      default:
        return fail(`${cmd.kind} is not implemented`);
    }
  }

  private doMove(bot: Bot, dir: Direction): Outcome {
    const target = add(bot.pos, DIR[dir]);
    if (!this.inBounds(target) || this.machineAt(target)) return ok(false);
    if (this.botAt(target)) {
      bot.blockedOn = "bot";
      return RETRY;
    }
    bot.pos = target;
    return ok(true);
  }

  private doHarvest(bot: Bot): Outcome {
    const tile = this.tileAt(bot.pos);
    if (!tile?.crop || tile.crop.growth < WHEAT_GROWTH_TICKS) return ok(false);
    if (total(bot.inventory) >= BOT_CAPACITY) return fail("inventory full");
    addItem(bot.inventory, tile.crop.item, 1);
    tile.crop = null;
    return ok(true);
  }

  private doPlant(bot: Bot, item: Item): Outcome {
    const tile = this.tileAt(bot.pos);
    if (!tile || tile.terrain !== "soil" || tile.crop) return ok(false);
    if ((bot.inventory[item] ?? 0) < 1) return ok(false);
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

  // ---- player (UI) actions, gated by research stock ----

  /** Place a new bot using a spare chassis from research. */
  deployBot(pos: Vec): Bot {
    if (this.research.spareChassis < 1) throw new Error("no spare chassis");
    this.assertFree(pos);
    this.research.spareChassis--;
    return this.addBot(pos, ["harvester"]);
  }

  private assertFree(pos: Vec): void {
    if (!this.inBounds(pos)) throw new Error("out of bounds");
    if (this.botAt(pos) || this.machineAt(pos)) throw new Error("tile occupied");
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
    const machine: Machine = { id: this.nextId++, kind, pos: { ...pos }, inventory: {} };
    this.machines.set(machine.id, machine);
    return machine;
  }
}
