import { createRng } from "./rng";
import { addItem, removeItem, total } from "./inventory";
import {
  BOT_CAPACITY,
  CONVEYOR_TICKS,
  CROP_GROWTH,
  FACES,
  FIELD_RADIUS,
  ITEMS,
  capacityOf,
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
  Inventory,
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
  place: "builder",
  remove: "builder",
};

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Exported so a renderer can interpolate a move without restating the mapping. */
export const DIR: Record<Direction, Vec> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/**
 * A quarter turn, exported for the same reason `DIR` is.
 *
 * Rotating a belt is a thing the build menu does, the builder arm will do, and
 * the ghost has to draw. A second copy of what "turn right" means is a second
 * thing to keep in step with this one.
 */
export const CLOCKWISE: Record<Direction, Direction> = {
  north: "east",
  east: "south",
  south: "west",
  west: "north",
};

/**
 * The other quarter turn, milestone 6's finding 4: north to west was three
 * presses because clockwise was the only direction there was.
 *
 * **Derived rather than written out.** Four more hand-typed rows would be four
 * more chances to get one wrong, and a table that disagreed with `CLOCKWISE`
 * would send a belt somewhere the ghost did not promise. A test asserts the two
 * are inverses, which is cheaper than reading them.
 */
export const COUNTER_CLOCKWISE: Record<Direction, Direction> = Object.fromEntries(
  Object.entries(CLOCKWISE).map(([from, to]) => [to, from]),
) as Record<Direction, Direction>;

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

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
        stalled: b.stalled,
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
        dir: m.dir,
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
    // After the machines, so a conversion's output waits one step before a belt
    // takes it. Either order is deterministic; this one keeps "produced" and
    // "collected" from being the same instant, where a player can see neither.
    this.advanceConveyors();
    this.advanceResearch();
  }

  /**
   * One belt step, for every belt in the world at once.
   *
   * Two phases, and the split is the whole algorithm:
   *
   * - **Give.** Every belt hands one item to the tile it faces, decided against
   *   a copy of the world taken *before* the step. Reading the running state
   *   instead is the classic belt bug — an item crossing five tiles in one tick
   *   because the loop happened to visit the belts downstream-first. Deciding
   *   against `before` makes travel time a property of the line's length rather
   *   than of the order its belts were built in, which is Fact 2 of the plan.
   * - **Take.** Every belt with room takes one item from the machine behind it,
   *   and only an item that machine's recipe *makes*. This phase reads the
   *   running state, which is safe because a belt never takes from another belt:
   *   a crate and the console have no recipe, so nothing can be pulled out of
   *   them, and a mill's wheat is its input rather than its output.
   *
   * Gives are applied in id order against a ledger of room already spoken for,
   * so two belts feeding one target cannot both take the last slot and which of
   * them wins is the same on every run.
   */
  private advanceConveyors(): void {
    if (this.time % CONVEYOR_TICKS !== 0) return;
    const belts = [...this.machines.values()].filter((m) => m.kind === "conveyor" && m.dir);
    if (belts.length === 0) return;

    const before = new Map<number, Inventory>();
    for (const machine of this.machines.values()) before.set(machine.id, { ...machine.inventory });
    const spokenFor = new Map<number, Inventory>();

    for (const belt of belts) {
      const held = before.get(belt.id)!;
      const item = ITEMS.find((i) => (held[i] ?? 0) > 0);
      if (!item) {
        // An empty belt has nothing to be stuck with.
        this.jammed.delete(belt.id);
        continue;
      }
      const target = this.machineAt(add(belt.pos, DIR[belt.dir!]));
      // Bare ground, a bot, the world's edge: the item stays where it is. A belt
      // is never a way to destroy something.
      //
      // It is also **jammed**, which is milestone 6's finding 3: a belt holding
      // four items it can never hand on drew exactly like a belt holding four it
      // was about to. Every other machine in the game can say it is stuck, and
      // `jammed` has meant "output it cannot put down" since milestone 5.
      if (!target) {
        this.flag(this.jammed, belt, "jammed");
        this.jammed.add(belt.id);
        continue;
      }

      // **A belt held up by a full neighbour is deliberately not flagged.** That
      // belt is backed up, which is normal, temporary, and caused by something
      // further down the line that is itself already flagged. Lighting up a
      // whole working line every time a mill got busy would teach the player
      // that the colour means nothing. The rule is about the layout being wrong
      // — nothing ahead of it, ever — not about the belt being full right now.
      this.jammed.delete(belt.id);

      const claimed = spokenFor.get(target.id) ?? {};
      const room =
        capacityOf(target.kind) - (before.get(target.id)![item] ?? 0) - (claimed[item] ?? 0);
      if (room <= 0) continue;

      removeItem(belt.inventory, item, 1);
      addItem(target.inventory, item, 1);
      claimed[item] = (claimed[item] ?? 0) + 1;
      spokenFor.set(target.id, claimed);
    }

    for (const belt of belts) {
      const source = this.machineAt(sub(belt.pos, DIR[belt.dir!]));
      const recipe = source ? RECIPE[source.kind] : undefined;
      if (!source || !recipe) continue;
      const item = ITEMS.find(
        (i) => (recipe.output[i] ?? 0) > 0 && (source.inventory[i] ?? 0) > 0,
      );
      if (!item) continue;
      if ((belt.inventory[item] ?? 0) >= capacityOf(belt.kind)) continue;
      removeItem(source.inventory, item, 1);
      addItem(belt.inventory, item, 1);
    }
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
        // Clearing `jammed` here matters. A machine that jammed and was then
        // emptied is starved, not jammed, and leaving the older flag set made
        // the inspector say "holding nothing — jammed — no room for the
        // output", which is three words of nonsense and sends the player to
        // look for a problem that is no longer there.
        this.jammed.delete(machine.id);
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
      ([item, n]) => (machine.inventory[item] ?? 0) + n <= capacityOf(machine.kind),
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
    this.scoreProgress(bot, outcome);
  }

  /**
   * Did that command achieve anything?
   *
   * Milestone 8's finding 3: a bot walled in by belts read "idle", exactly like
   * one whose script had ended, because `blockedOn` models bot-on-bot and radio
   * and not walking into a machine.
   *
   * **A count rather than a third `blockedOn` value**, per Decision 5 of the
   * milestone 9 plan. Those two are *waiting* — the command has not resolved and
   * the script is suspended. Bumping a machine is not waiting: the move
   * resolves, answers false, and the script runs on. One field holding both
   * would mean "blocked" stopped having a single meaning.
   *
   * What counts as nothing is the command's own answer, not a list of command
   * kinds kept in step by hand: a `move` that returned false, a `deposit` or
   * `withdraw` that transferred zero, a `harvest` with nothing to take. A `wait`
   * answers `undefined` and therefore resets, which is right — waiting on
   * purpose is not being stuck.
   *
   * A failed outcome is left alone. That is an error, the script stops, and the
   * design gives errors their own signal.
   */
  private scoreProgress(bot: Bot, outcome: Outcome): void {
    if (outcome === RETRY || !outcome.ok) return;
    const nothing = outcome.value === false || outcome.value === 0;
    bot.stalled = nothing ? bot.stalled + 1 : 0;
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
      case "place":
        return this.doPlace(bot, cmd.machine, cmd.dir, cmd.facing ?? cmd.dir);
      case "remove":
        return this.doRemove(bot, cmd.dir);
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
    // **Capacity is asked first, and the order is the whole signal.**
    //
    // A full harvest was an error until milestone 10's playtest — the one place
    // in this command where the two halves disagreed, since "nothing to take"
    // refused and "nowhere to put it" threw, so a full bot stopped dead mid-loop
    // with its script killed. Nothing else in the API behaves that way: a `move`
    // into a wall answers false, a `deposit` with no room answers 0. The design's
    // own "Failure is content" table already puts the matching case — "crate
    // full" — in the world and explicitly not in the editor.
    //
    // Making it a refusal removes a signal unless something replaces it, and
    // driving the page proved the obvious candidates do not. `stalled` resets on
    // every successful `move`, so the canonical `harvest(); move();` loop never
    // accumulates one. And while this check sat *below* the crop check, a full
    // bot walking over ground it had already cleared reported "refused" — 36 of
    // them and not a single `full` — because the tile was empty and the sim
    // answered about the tile rather than about the bot.
    //
    // Asked first, "I am full" is the answer whatever the bot is standing on, so
    // the marker follows it for as long as the condition lasts. That is what the
    // design means by a world-side signal.
    if (total(bot.inventory) >= BOT_CAPACITY) {
      this.emit({ kind: "full", botId: bot.id, pos: { ...bot.pos } });
      return ok(false);
    }
    if (!tile?.crop || tile.crop.growth < ripeAt(tile.crop.item)) {
      this.emit({ kind: "refused", botId: bot.id, pos: { ...bot.pos }, command: "harvest" });
      return ok(false);
    }
    addItem(bot.inventory, tile.crop.item, 1);
    // Emitted before the crop is cleared, so the event carries what was taken.
    this.emit({ kind: "harvest", botId: bot.id, pos: { ...bot.pos }, item: tile.crop.item });
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
    const room = capacityOf(machine.kind) - (machine.inventory[item] ?? 0);
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

  /**
   * Build on the tile in `dir`, through the same predicate everything else asks.
   *
   * `canPlace` now has three callers — the ghost that colours itself, the build
   * menu's click, and this — and exactly one of them decides. A builder arm that
   * worked out for itself where a mill fits is the drift Decision 7 of the
   * milestone 4 plan exists to prevent, one level up from a renderer.
   */
  private doPlace(bot: Bot, machine: MachineKind, dir: Direction, facing: Direction): Outcome {
    const target = add(bot.pos, DIR[dir]);
    const why = this.canPlace(machine, target);
    if (why) {
      // A world-side signal as well as the script's error, because somebody
      // watching the canvas is a reader too.
      this.emit({ kind: "refused", botId: bot.id, pos: { ...bot.pos }, command: "place" });
      return fail(why);
    }
    this.addMachine(machine, target, facing);
    return ok(true);
  }

  /**
   * Take the machine on the tile in `dir` away, through the same predicate the
   * build menu's remove mode asks.
   *
   * Removal exists mostly because a belt is a wall: a player who has fenced
   * themselves out of their own field needs something that is not a new game.
   * Milestone 6's playtest found that this — a script, needing a research the
   * fenced-in bot could no longer pay for — was the *only* way out, so
   * milestone 7's Task 0 gave the same rules to the player's hands and moved
   * them into `canRemove`, where both callers can reach them.
   *
   * They are no longer quite the same rules. The arm still refuses a machine
   * with anything to lose and the hands no longer do — see `canRemove`, where
   * the case that forced them apart is written down.
   */
  private doRemove(bot: Bot, dir: Direction): Outcome {
    const target = add(bot.pos, DIR[dir]);
    const machine = this.machineAt(target);
    // Asked here rather than left to `canRemove`, because a script pointed at a
    // direction and should be told about that direction. The cursor's version
    // of this same question is about a tile and words it differently.
    if (!machine) return fail(`no machine to the ${dir}`);

    const why = this.canRemove(target, "arm");
    if (why) {
      // A world-side signal as well as the script's error, the way `doPlace`
      // refuses: somebody watching the canvas is a reader too. The hands-phase
      // path emits nothing, because a player who clicked is already looking at
      // the tile and at the reason in the tooltip.
      this.emit({ kind: "refused", botId: bot.id, pos: { ...bot.pos }, command: "remove" });
      return fail(why);
    }
    this.takeMachine(machine);
    return ok(true);
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

  /**
   * Why the machine on this tile cannot be taken away, or null if it can.
   *
   * The same shape as `canPlace`, for the same reason and with the same two
   * callers that must never disagree: the ghost the player is dragging around
   * and the arm a script is driving.
   *
   * **The arm refuses anything with something to lose; the hands do not.** That
   * asymmetry is the fix for the soft-lock and is worth the paragraph.
   *
   * There is no ground for items to spill onto in this game, so removing a full
   * crate deletes what was in it, and a machine part-way through a conversion
   * has already eaten its input — an empty inventory is not the same as nothing
   * to lose. Decision 10 of the milestone 7 plan therefore refused both callers
   * and accepted a named hole: a cage of belts that are *carrying* something
   * takes two steps to dismantle, the first being `withdraw` into the caged
   * bot's own cargo.
   *
   * That route needs the bot to have room, and `builder.test.ts` now drives the
   * case where it does not — a bot at `BOT_CAPACITY` behind four belts at
   * `capacityOf("conveyor")`. Every exit is shut at once, which is a world that
   * cannot be recovered, and the design's "no crash is fatal" outranks item
   * conservation when the two are actually in conflict.
   *
   * So the two callers are told apart by what they *are*: an arm is a line of
   * code, which must never silently delete a player's harvest, and hands are a
   * person who has read what the tile holds. The reading is not optional — the
   * ghost's tooltip names the exact contents before the click, which is
   * `removalCost` in `inspector.ts` and a test rather than a screenshot.
   */
  canRemove(pos: Vec, by: "hands" | "arm"): string | null {
    const machine = this.machineAt(pos);
    if (!machine) return "nothing to remove";
    if (machine.kind === "console") return "the Research Console cannot be removed";
    if (by === "arm") {
      if (total(machine.inventory) > 0) return `${machine.kind} is not empty`;
      if (machine.progress > 0) return `${machine.kind} is working`;
    }
    return null;
  }

  /**
   * Take a machine off the map by hand, the player-side pair to `canRemove` the
   * way `placeMachine` is to `canPlace`.
   *
   * Free and instant, like every other hands-phase action. `bot.builder.remove`
   * keeps its tick cost: a script doing this a hundred times is a cost, and a
   * player clicking once is not.
   *
   * Returns what was destroyed, which is usually nothing. It is returned rather
   * than emitted because the caller is a click and the answer belongs on the
   * status line beside "fitted planter to bot 1" — and because a function that
   * can delete a player's items should hand back what it deleted rather than
   * leave the caller to have looked first.
   */
  removeMachine(pos: Vec): Inventory {
    const why = this.canRemove(pos, "hands");
    if (why) throw new Error(why);
    // Not null: `canRemove` answered null, which it only does for a machine.
    const machine = this.machineAt(pos)!;
    const lost = { ...machine.inventory };
    this.takeMachine(machine);
    return lost;
  }

  /**
   * The deletion itself, for both the hands and the arm.
   *
   * Ids are never reused, so a left-behind flag would never fire again — but it
   * would sit in a set that only grows, and a leak that small is still a leak.
   * One helper rather than two copies is what stops the newer caller from being
   * the one that forgets.
   */
  private takeMachine(machine: Machine): void {
    this.machines.delete(machine.id);
    this.starved.delete(machine.id);
    this.jammed.delete(machine.id);
  }

  /**
   * Why a script cannot start another bot right now, or null if it can.
   *
   * The same shape as `canPlace` and `canRemove`, and for the same reason: the
   * bridge asks it, the sim answers, and there is no second copy of the rule.
   *
   * `spawn` is deliberately not "create a bot anywhere". It needs a fabricator
   * standing on the map, a chassis from research stock — the same one the build
   * menu's Deploy spends — and a free tile beside the machine. Without the
   * machine it would be a menu item spelled as code; with it, a factory that
   * builds bots is a thing that has a place and can be belted to.
   */
  canSpawn(): string | null {
    if (!this.research.unlocked.has("fabricator")) return "fabricator not researched";
    const fabricator = this.fabricator();
    if (!fabricator) return "no fabricator built";
    if (this.research.spareChassis < 1) return "no spare chassis";
    if (!this.freeTileBeside(fabricator.pos)) return "no room beside the fabricator";
    return null;
  }

  /** Build a bot at the fabricator, spending a chassis. */
  spawnBot(): Bot {
    const why = this.canSpawn();
    if (why) throw new Error(why);
    const pos = this.freeTileBeside(this.fabricator()!.pos)!;
    this.research.spareChassis--;
    // A harvester, like every other new bot: the fabricator makes chassis, not
    // modules, and the build menu's Fit is still how a module gets onto one.
    return this.addBot(pos, ["harvester"]);
  }

  private fabricator(): Machine | undefined {
    for (const m of this.machines.values()) if (m.kind === "fabricator") return m;
    return undefined;
  }

  /**
   * Somewhere beside a machine that a bot could stand, in a fixed order.
   *
   * `DIR`'s own order rather than anything cleverer, so two identical worlds put
   * their new bot on the same tile — determinism is a property the whole test
   * suite rests on.
   */
  private freeTileBeside(pos: Vec): Vec | null {
    for (const dir of Object.keys(DIR) as Direction[]) {
      const p = add(pos, DIR[dir]);
      if (this.tileBlocked(p) === null) return p;
    }
    return null;
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

  /**
   * Place a machine the player has researched.
   *
   * `facing` is accepted for every kind and recorded only by those that have a
   * front, so a build menu can offer one call rather than two.
   */
  placeMachine(kind: MachineKind, pos: Vec, facing: Direction = "north"): Machine {
    const why = this.canPlace(kind, pos);
    if (why) throw new Error(why);
    return this.addMachine(kind, pos, facing);
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

  /**
   * Grant a research outright, as a restored progress key does.
   *
   * The same two steps the console performs when it finishes one — unlock it,
   * then `grant` whatever it hands out — so a key that says "scanner" leaves a
   * spare scanner to fit rather than a permission with no hardware behind it.
   *
   * Deliberately **not** a cheat hatch with a nicer name: it emits no `research`
   * event, because nothing just happened in the world, and the suggestion rules
   * key off that event. A restored colony should not be told its scanner has
   * arrived; it had one before the page was closed.
   *
   * Silent about research it already has, because restoring is idempotent and a
   * player typing their key twice has done nothing wrong.
   */
  unlockResearch(name: ResearchName): void {
    if (!(name in RESEARCH_COST)) throw new Error(`unknown research ${name}`);
    if (this.research.unlocked.has(name)) return;
    this.research.unlocked.add(name);
    this.grant(name);
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
      case "builder":
        this.research.spareModules[name] = (this.research.spareModules[name] ?? 0) + 1;
        return;
      case "crate":
      case "mill":
      case "oven":
      case "conveyor":
      case "fabricator":
        return; // unlocks placeMachine(kind), nothing to stock
      case "library":
        // Unlocks a source buffer, which lives in the editor rather than in the
        // world. The sim's only part in it is saying whether it exists.
        return;
      default: {
        // Exhaustive rather than a silent fallthrough: mill and oven landed in
        // milestone 5 without a case here and granted nothing by accident
        // rather than by decision, which happened to be right.
        const never: never = name;
        throw new Error(`no grant for research ${String(never)}`);
      }
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
      stalled: 0,
    };
    this.bots.set(bot.id, bot);
    return bot;
  }

  private addMachine(kind: MachineKind, pos: Vec, facing: Direction = "north"): Machine {
    const tile = this.tileAt(pos);
    if (tile) tile.crop = null;
    const machine: Machine = {
      id: this.nextId++,
      kind,
      pos: { ...pos },
      dir: FACES[kind] ? facing : null,
      inventory: {},
      progress: 0,
    };
    this.machines.set(machine.id, machine);
    return machine;
  }
}
