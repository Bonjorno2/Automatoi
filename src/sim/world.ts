import { createRng } from "./rng";
import {
  FIELD_RADIUS,
  TICK_COST,
  WHEAT_GROWTH_TICKS,
  WILD_WHEAT_CHANCE,
} from "./config";
import type {
  Bot,
  Command,
  CommandResult,
  Machine,
  MachineKind,
  ModuleName,
  ResearchState,
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
    for (const bot of this.bots.values()) this.advance(bot);
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
      default:
        return fail(`${cmd.kind} is not implemented`);
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
    const machine: Machine = { id: this.nextId++, kind, pos: { ...pos }, inventory: {} };
    this.machines.set(machine.id, machine);
    return machine;
  }
}
