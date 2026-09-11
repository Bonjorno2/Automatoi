# Milestone 1: Simulation Core Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A headless, deterministic TypeScript simulation of the Automatori world that can be driven by commands and verified entirely with Vitest, with no renderer, worker, or editor.

**Architecture:** One `World` class owns the tile grid, bots, machines, and research state. Callers `issue()` a command to a bot, call `tick()` to advance time, and `takeResult()` when the command resolves. This synchronous issue/tick/result loop is exactly the protocol the SharedArrayBuffer worker bridge will speak in milestone two, so nothing here gets thrown away. All randomness comes from a seeded RNG, so a seed plus a command sequence always yields the same snapshot.

**Tech Stack:** TypeScript 5 (strict, ESM), Vitest 2, Node 20+. No runtime dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md`. Read the "API shape", "Architecture", and "First playable scope" sections before starting.

---

## Conventions for every task

- Source lives in `src/sim/`. Tests live in `tests/sim/` and mirror the source file name.
- Run a single test file with `npx vitest run tests/sim/<name>.test.ts`. Run everything with `npm test`.
- Run `npm run typecheck` before every commit. A commit with type errors is a failed step.
- Commit after each task with the message given. Do not batch tasks into one commit.
- Never add a feature a later task doesn't ask for. If a helper seems useful "for later", leave it out.

## Domain vocabulary (read once)

- **Tick.** One unit of simulated time. Every world action costs a fixed number of ticks.
- **Bot.** A programmable entity on a tile. Has an inventory, a set of hardware modules, and at most one in-progress action.
- **Module.** Hardware bolted onto a bot: `harvester`, `planter`, `scanner`, `radio`. Commands that need a module fail with an error if the bot lacks it.
- **Machine.** A stationary entity on a tile: `console` (research) or `crate` (storage). Bots cannot enter machine tiles.
- **Crop.** A tile can hold one crop with a `growth` counter. It is mature when `growth >= WHEAT_GROWTH_TICKS`.
- **Research.** The console consumes wheat from its own inventory, one per tick, toward the front of a queue. Completing research grants spare hardware to the colony stockpile, which the player then installs by hand.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/sim/index.ts`
- Test: `tests/smoke.test.ts`

**Step 1: Initialise git if the folder is not already a repository**

Run: `git rev-parse --is-inside-work-tree 2>/dev/null || git init`
Expected: either `true` or `Initialized empty Git repository`

**Step 2: Create `package.json`**

```json
{
  "name": "automatori",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "tests"]
}
```

**Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/**/*.test.ts"],
  },
});
```

**Step 5: Create `.gitignore`**

```
node_modules/
dist/
```

**Step 6: Create `src/sim/index.ts`**

```ts
export const SIM_VERSION = 1;
```

**Step 7: Write the smoke test at `tests/smoke.test.ts`**

```ts
import { SIM_VERSION } from "../src/sim/index";

describe("toolchain", () => {
  it("imports source under test", () => {
    expect(SIM_VERSION).toBe(1);
  });
});
```

**Step 8: Install and run**

Run: `npm install`
Expected: `node_modules/` created, no errors.

Run: `npm test`
Expected: `1 passed`

Run: `npm run typecheck`
Expected: no output, exit code 0.

**Step 9: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src tests docs
git commit -m "chore: scaffold TypeScript + Vitest project with design docs"
```

---

### Task 2: Seeded RNG

Determinism depends on never touching `Math.random`. This is the only source of randomness in the sim.

**Files:**
- Create: `src/sim/rng.ts`
- Test: `tests/sim/rng.test.ts`

**Step 1: Write the failing test**

```ts
import { createRng } from "../../src/sim/rng";

describe("createRng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(a()).not.toBe(b());
  });

  it("returns values in [0, 1)", () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/rng.test.ts`
Expected: FAIL, cannot find module `../../src/sim/rng`

**Step 3: Write minimal implementation**

`src/sim/rng.ts` (mulberry32, a tiny well-known 32-bit generator):

```ts
/** Deterministic PRNG. Same seed, same sequence, on every platform. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/sim/rng.test.ts`
Expected: `3 passed`

**Step 5: Commit**

```bash
git add src/sim/rng.ts tests/sim/rng.test.ts
git commit -m "feat(sim): add seeded mulberry32 rng"
```

---

### Task 3: Types, config, and world generation

Creates the `World` class with a generated map, one console in the centre, and one bot with a harvester beside it. No commands yet.

**Files:**
- Create: `src/sim/types.ts`
- Create: `src/sim/config.ts`
- Create: `src/sim/world.ts`
- Modify: `src/sim/index.ts`
- Test: `tests/sim/world.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { WHEAT_GROWTH_TICKS } from "../../src/sim/config";

describe("World generation", () => {
  it("defaults to a 32x32 grid", () => {
    const w = new World({ seed: 1 });
    expect(w.width).toBe(32);
    expect(w.height).toBe(32);
    expect(w.tiles).toHaveLength(32 * 32);
  });

  it("places the research console in the centre", () => {
    const w = new World({ seed: 1 });
    const console = w.machineAt({ x: 16, y: 16 });
    expect(console?.kind).toBe("console");
    expect(w.tileAt({ x: 16, y: 16 })?.crop).toBeNull();
  });

  it("spawns one bot with a harvester east of the console", () => {
    const w = new World({ seed: 1 });
    expect(w.bots.size).toBe(1);
    const bot = w.getBot(1);
    expect(bot.pos).toEqual({ x: 17, y: 16 });
    expect(bot.modules.has("harvester")).toBe(true);
    expect(bot.inventory).toEqual({});
  });

  it("puts soil with some mature wild wheat inside the field radius", () => {
    const w = new World({ seed: 1 });
    const inField = w.tileAt({ x: 18, y: 16 });
    expect(inField?.terrain).toBe("soil");
    const mature = w.tiles.filter(
      (t) => t.crop && t.crop.growth >= WHEAT_GROWTH_TICKS,
    );
    expect(mature.length).toBeGreaterThan(50);
  });

  it("puts grass with no crop outside the field radius", () => {
    const w = new World({ seed: 1 });
    const corner = w.tileAt({ x: 0, y: 0 });
    expect(corner?.terrain).toBe("grass");
    expect(corner?.crop).toBeNull();
  });

  it("generates identical tiles for identical seeds", () => {
    const a = new World({ seed: 99 });
    const b = new World({ seed: 99 });
    expect(a.tiles).toEqual(b.tiles);
  });

  it("generates different tiles for different seeds", () => {
    const a = new World({ seed: 1 });
    const b = new World({ seed: 2 });
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it("returns undefined for out-of-bounds tiles", () => {
    const w = new World({ seed: 1 });
    expect(w.tileAt({ x: -1, y: 0 })).toBeUndefined();
    expect(w.tileAt({ x: 32, y: 0 })).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: FAIL, cannot find module

**Step 3: Create `src/sim/types.ts`**

```ts
export type Direction = "north" | "south" | "east" | "west";
export type Terrain = "grass" | "soil";
export type Item = "wheat";
export type ModuleName = "harvester" | "planter" | "scanner" | "radio";
export type MachineKind = "console" | "crate";
export type ResearchName = "planter" | "scanner" | "crate" | "chassis" | "radio";

export interface Vec {
  x: number;
  y: number;
}

export interface Crop {
  item: Item;
  /** Ticks grown so far. Mature when >= WHEAT_GROWTH_TICKS. */
  growth: number;
}

export interface Tile {
  terrain: Terrain;
  crop: Crop | null;
}

export type Inventory = Partial<Record<Item, number>>;

export interface Message {
  channel: string;
  payload: unknown;
  from: number;
}

export type Command =
  | { kind: "wait"; ticks: number }
  | { kind: "move"; dir: Direction }
  | { kind: "harvest" }
  | { kind: "plant"; item: Item }
  | { kind: "scan"; radius: number }
  | { kind: "deposit"; dir: Direction; item: Item; count: number }
  | { kind: "withdraw"; dir: Direction; item: Item; count: number }
  | { kind: "send"; channel: string; payload: unknown }
  | { kind: "receive"; channel?: string };

export type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface Action {
  command: Command;
  remaining: number;
}

export type BlockedOn = "bot" | "radio" | null;

export interface Bot {
  id: number;
  pos: Vec;
  inventory: Inventory;
  modules: Set<ModuleName>;
  action: Action | null;
  result: CommandResult | null;
  inbox: Message[];
  blockedOn: BlockedOn;
}

export interface Machine {
  id: number;
  kind: MachineKind;
  pos: Vec;
  inventory: Inventory;
}

export interface ScanTile {
  x: number;
  y: number;
  terrain: Terrain;
  crop: Crop | null;
  bot: number | null;
  machine: MachineKind | null;
}

export interface ResearchState {
  unlocked: Set<ResearchName>;
  queue: ResearchName[];
  progress: number;
  spareModules: Partial<Record<ModuleName, number>>;
  spareChassis: number;
}
```

**Step 4: Create `src/sim/config.ts`**

```ts
import type { ResearchName } from "./types";

/** Ticks each command takes before it resolves. */
export const TICK_COST = {
  move: 2,
  harvest: 3,
  plant: 3,
  scan: 1,
  deposit: 1,
  withdraw: 1,
  send: 1,
  receive: 1,
} as const;

export const WHEAT_GROWTH_TICKS = 30;
export const BOT_CAPACITY = 10;

/** Wheat the console must consume to complete each research. */
export const RESEARCH_COST: Record<ResearchName, number> = {
  planter: 10,
  scanner: 10,
  crate: 15,
  chassis: 25,
  radio: 20,
};

/** Chebyshev radius of the soil field around the console. */
export const FIELD_RADIUS = 6;
/** Probability a soil tile starts with mature wild wheat. */
export const WILD_WHEAT_CHANCE = 0.7;
```

**Step 5: Create `src/sim/world.ts`**

```ts
import { createRng } from "./rng";
import { FIELD_RADIUS, WHEAT_GROWTH_TICKS, WILD_WHEAT_CHANCE } from "./config";
import type {
  Bot,
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
```

Note on IDs: bots and machines share one counter. The starting bot is always id 1 and the console is id 2. Task 10's test relies on this when it expects a deployed bot to get id 3.

**Step 6: Replace `src/sim/index.ts`**

```ts
export { World } from "./world";
export type { WorldOptions } from "./world";
export * from "./types";
export * from "./config";
```

Delete `tests/smoke.test.ts`, it has done its job.

**Step 7: Run tests and typecheck**

Run: `npx vitest run tests/sim/world.test.ts`
Expected: `8 passed`

Run: `npm run typecheck`
Expected: exit 0

**Step 8: Commit**

```bash
git add src/sim tests
git commit -m "feat(sim): world generation with console, field, and starting bot"
```

---

### Task 4: Command loop with `wait`

The heart of the sim. `issue()` attaches an action to a bot, `tick()` counts it down, `takeResult()` hands back the outcome. Also adds the `run()` test helper used by every later task.

**Files:**
- Modify: `src/sim/world.ts`
- Create: `tests/sim/helpers.ts`
- Test: `tests/sim/commands.test.ts`

**Step 1: Create the test helper `tests/sim/helpers.ts`**

```ts
import type { World } from "../../src/sim/world";
import type { Command, CommandResult } from "../../src/sim/types";

/** Issue a command and tick until it resolves. Throws if it never does. */
export function run(world: World, botId: number, cmd: Command): CommandResult {
  world.issue(botId, cmd);
  const immediate = world.takeResult(botId);
  if (immediate) return immediate;
  for (let i = 0; i < 10_000; i++) {
    world.tick();
    const r = world.takeResult(botId);
    if (r) return r;
  }
  throw new Error(`command ${cmd.kind} did not resolve within 10000 ticks`);
}

/** Tick n times. */
export function ticks(world: World, n: number): void {
  for (let i = 0; i < n; i++) world.tick();
}
```

**Step 2: Write the failing test `tests/sim/commands.test.ts`**

```ts
import { World } from "../../src/sim/world";
import { run } from "./helpers";

describe("command loop", () => {
  it("wait resolves after exactly the requested ticks", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "wait", ticks: 3 });
    expect(w.takeResult(1)).toBeNull();
    w.tick();
    expect(w.takeResult(1)).toBeNull();
    w.tick();
    expect(w.takeResult(1)).toBeNull();
    w.tick();
    expect(w.takeResult(1)).toEqual({ ok: true, value: undefined });
    expect(w.time).toBe(3);
  });

  it("takeResult clears the result", () => {
    const w = new World({ seed: 1 });
    run(w, 1, { kind: "wait", ticks: 1 });
    expect(w.takeResult(1)).toBeNull();
  });

  it("throws when issuing to a busy bot", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "wait", ticks: 5 });
    expect(() => w.issue(1, { kind: "wait", ticks: 1 })).toThrow("bot 1 is busy");
  });

  it("throws when issuing to an unknown bot", () => {
    const w = new World({ seed: 1 });
    expect(() => w.issue(99, { kind: "wait", ticks: 1 })).toThrow("no bot 99");
  });

  it("fails immediately when the bot lacks the required module", () => {
    const w = new World({ seed: 1 });
    w.issue(1, { kind: "scan", radius: 1 });
    expect(w.takeResult(1)).toEqual({
      ok: false,
      error: "Bot 1 has no Scanner module",
    });
    expect(w.getBot(1).action).toBeNull();
  });
});
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/sim/commands.test.ts`
Expected: FAIL, `w.issue is not a function`

**Step 4: Add the command loop to `src/sim/world.ts`**

Add to the imports:

```ts
import { TICK_COST } from "./config";
import type { Command, CommandResult } from "./types";
```

(Merge with the existing import lines from the same modules.)

Add these module-level helpers above the `World` class:

```ts
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
```

Add these methods to the `World` class, after the lookups section:

```ts
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
```

The `bot` parameter in `execute` is unused for now. That's fine, later tasks use it. If the linter complains, prefix nothing; `noUnusedParameters` is not enabled.

**Step 5: Run tests and typecheck**

Run: `npx vitest run tests/sim/commands.test.ts`
Expected: `5 passed`

Run: `npm run typecheck`
Expected: exit 0

**Step 6: Commit**

```bash
git add src/sim/world.ts tests/sim/helpers.ts tests/sim/commands.test.ts
git commit -m "feat(sim): issue/tick/takeResult command loop with wait"
```

---

### Task 5: Movement and collision

Bumping a wall or a machine returns `false` and the script carries on. Bumping another bot waits until the tile clears, which is how two bots in one corridor deadlock. That deadlock is deliberate game content.

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/move.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { run, ticks } from "./helpers";

describe("move", () => {
  it("moves one tile and costs TICK_COST.move ticks", () => {
    const w = new World({ seed: 1 });
    const r = run(w, 1, { kind: "move", dir: "east" });
    expect(r).toEqual({ ok: true, value: true });
    expect(w.getBot(1).pos).toEqual({ x: 18, y: 16 });
    expect(w.time).toBe(TICK_COST.move);
  });

  it("supports all four directions", () => {
    const w = new World({ seed: 1 });
    run(w, 1, { kind: "move", dir: "south" });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 17 });
    run(w, 1, { kind: "move", dir: "north" });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 16 });
    run(w, 1, { kind: "move", dir: "east" });
    run(w, 1, { kind: "move", dir: "west" });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 16 });
  });

  it("returns false and stays put at the world edge", () => {
    const w = new World({ seed: 1, width: 4, height: 4 });
    // 4x4: centre is (2,2), bot starts at (3,2), the east edge.
    const r = run(w, 1, { kind: "move", dir: "east" });
    expect(r).toEqual({ ok: true, value: false });
    expect(w.getBot(1).pos).toEqual({ x: 3, y: 2 });
  });

  it("returns false when the target tile holds a machine", () => {
    const w = new World({ seed: 1 });
    // Console is directly west of the bot.
    const r = run(w, 1, { kind: "move", dir: "west" });
    expect(r).toEqual({ ok: true, value: false });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 16 });
  });

  it("waits when another bot is on the target tile, then proceeds", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const other = w.deployBot({ x: 18, y: 16 });

    w.issue(1, { kind: "move", dir: "east" });
    ticks(w, TICK_COST.move + 2);
    expect(w.takeResult(1)).toBeNull();
    expect(w.getBot(1).blockedOn).toBe("bot");

    w.issue(other.id, { kind: "move", dir: "east" });
    ticks(w, TICK_COST.move);
    expect(w.takeResult(other.id)).toEqual({ ok: true, value: true });

    w.tick();
    expect(w.takeResult(1)).toEqual({ ok: true, value: true });
    expect(w.getBot(1).pos).toEqual({ x: 18, y: 16 });
    expect(w.getBot(1).blockedOn).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/move.test.ts`
Expected: FAIL, `move is not implemented` and `w.deployBot is not a function`

**Step 3: Implement**

Add above the `World` class in `src/sim/world.ts`:

```ts
const DIR: Record<Direction, Vec> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
```

Add `Direction` to the type imports.

Add a `move` case to `execute`:

```ts
      case "move":
        return this.doMove(bot, cmd.dir);
```

Add these methods:

```ts
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
```

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/sim/move.test.ts`
Expected: `5 passed`

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/move.test.ts
git commit -m "feat(sim): move with wall, machine, and bot collision rules"
```

---

### Task 6: Inventory helpers and harvest

**Files:**
- Create: `src/sim/inventory.ts`
- Modify: `src/sim/world.ts`
- Test: `tests/sim/inventory.test.ts`
- Test: `tests/sim/harvest.test.ts`

**Step 1: Write the failing inventory test**

```ts
import { addItem, removeItem, total } from "../../src/sim/inventory";
import type { Inventory } from "../../src/sim/types";

describe("inventory helpers", () => {
  it("total sums all counts", () => {
    expect(total({})).toBe(0);
    expect(total({ wheat: 4 })).toBe(4);
  });

  it("addItem creates or increments", () => {
    const inv: Inventory = {};
    addItem(inv, "wheat", 2);
    addItem(inv, "wheat", 3);
    expect(inv).toEqual({ wheat: 5 });
  });

  it("removeItem decrements and deletes the key at zero", () => {
    const inv: Inventory = { wheat: 3 };
    removeItem(inv, "wheat", 2);
    expect(inv).toEqual({ wheat: 1 });
    removeItem(inv, "wheat", 1);
    expect(inv).toEqual({});
  });

  it("removeItem throws when short", () => {
    const inv: Inventory = { wheat: 1 };
    expect(() => removeItem(inv, "wheat", 2)).toThrow("not enough wheat");
  });
});
```

**Step 2: Write the failing harvest test**

```ts
import { World } from "../../src/sim/world";
import { BOT_CAPACITY, TICK_COST, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import { run } from "./helpers";

function worldWithWheatUnderBot(): World {
  const w = new World({ seed: 1 });
  const tile = w.tileAt(w.getBot(1).pos)!;
  tile.crop = { item: "wheat", growth: WHEAT_GROWTH_TICKS };
  return w;
}

describe("harvest", () => {
  it("collects mature wheat, clears the tile, costs TICK_COST.harvest", () => {
    const w = worldWithWheatUnderBot();
    const r = run(w, 1, { kind: "harvest" });
    expect(r).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
    expect(w.tileAt(w.getBot(1).pos)!.crop).toBeNull();
    expect(w.time).toBe(TICK_COST.harvest);
  });

  it("returns false on an empty tile", () => {
    const w = new World({ seed: 1 });
    w.tileAt(w.getBot(1).pos)!.crop = null;
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });
    expect(w.getBot(1).inventory).toEqual({});
  });

  it("returns false on an immature crop", () => {
    const w = new World({ seed: 1 });
    w.tileAt(w.getBot(1).pos)!.crop = { item: "wheat", growth: 3 };
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: false });
  });

  it("errors when the inventory is full", () => {
    const w = worldWithWheatUnderBot();
    w.getBot(1).inventory = { wheat: BOT_CAPACITY };
    expect(run(w, 1, { kind: "harvest" })).toEqual({
      ok: false,
      error: "inventory full",
    });
    expect(w.tileAt(w.getBot(1).pos)!.crop).not.toBeNull();
  });

  it("errors when the bot has no harvester", () => {
    const w = worldWithWheatUnderBot();
    w.getBot(1).modules.delete("harvester");
    expect(run(w, 1, { kind: "harvest" })).toEqual({
      ok: false,
      error: "Bot 1 has no Harvester module",
    });
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/sim/inventory.test.ts tests/sim/harvest.test.ts`
Expected: FAIL on both files

**Step 4: Create `src/sim/inventory.ts`**

```ts
import type { Inventory, Item } from "./types";

export function total(inv: Inventory): number {
  let n = 0;
  for (const count of Object.values(inv)) n += count ?? 0;
  return n;
}

export function addItem(inv: Inventory, item: Item, count: number): void {
  inv[item] = (inv[item] ?? 0) + count;
}

export function removeItem(inv: Inventory, item: Item, count: number): void {
  const have = inv[item] ?? 0;
  if (have < count) throw new Error(`not enough ${item}`);
  const left = have - count;
  if (left === 0) delete inv[item];
  else inv[item] = left;
}
```

**Step 5: Implement harvest in `src/sim/world.ts`**

Imports:

```ts
import { addItem, total } from "./inventory";
import { BOT_CAPACITY } from "./config";
```

Case in `execute`:

```ts
      case "harvest":
        return this.doHarvest(bot);
```

Method:

```ts
  private doHarvest(bot: Bot): Outcome {
    const tile = this.tileAt(bot.pos);
    if (!tile?.crop || tile.crop.growth < WHEAT_GROWTH_TICKS) return ok(false);
    if (total(bot.inventory) >= BOT_CAPACITY) return fail("inventory full");
    addItem(bot.inventory, tile.crop.item, 1);
    tile.crop = null;
    return ok(true);
  }
```

**Step 6: Run tests and typecheck**

Run: `npm test`
Expected: all passing (`inventory` 4, `harvest` 5, plus earlier)

Run: `npm run typecheck`
Expected: exit 0

**Step 7: Commit**

```bash
git add src/sim/inventory.ts src/sim/world.ts tests/sim/inventory.test.ts tests/sim/harvest.test.ts
git commit -m "feat(sim): inventory helpers and harvest command"
```

---

### Task 7: Crop growth and plant

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/plant.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { TICK_COST, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import { run, ticks } from "./helpers";

function planterWorld(): World {
  const w = new World({ seed: 1 });
  const bot = w.getBot(1);
  bot.modules.add("planter");
  bot.inventory = { wheat: 2 };
  w.tileAt(bot.pos)!.crop = null;
  return w;
}

describe("plant", () => {
  it("plants a seed on empty soil and consumes one wheat", () => {
    const w = planterWorld();
    const r = run(w, 1, { kind: "plant", item: "wheat" });
    expect(r).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
    expect(w.tileAt(w.getBot(1).pos)!.crop).toEqual({ item: "wheat", growth: 0 });
    expect(w.time).toBe(TICK_COST.plant);
  });

  it("returns false on grass", () => {
    const w = planterWorld();
    w.tileAt(w.getBot(1).pos)!.terrain = "grass";
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: false });
    expect(w.getBot(1).inventory).toEqual({ wheat: 2 });
  });

  it("returns false when the tile already has a crop", () => {
    const w = planterWorld();
    w.tileAt(w.getBot(1).pos)!.crop = { item: "wheat", growth: 5 };
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: false });
  });

  it("returns false with no seed in inventory", () => {
    const w = planterWorld();
    w.getBot(1).inventory = {};
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: false });
  });

  it("errors without a planter module", () => {
    const w = planterWorld();
    w.getBot(1).modules.delete("planter");
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({
      ok: false,
      error: "Bot 1 has no Planter module",
    });
  });
});

describe("crop growth", () => {
  it("grows one per tick and stops at maturity", () => {
    const w = planterWorld();
    run(w, 1, { kind: "plant", item: "wheat" });
    const tile = w.tileAt(w.getBot(1).pos)!;
    ticks(w, 10);
    expect(tile.crop?.growth).toBe(10);
    ticks(w, WHEAT_GROWTH_TICKS);
    expect(tile.crop?.growth).toBe(WHEAT_GROWTH_TICKS);
  });

  it("a planted crop becomes harvestable", () => {
    const w = planterWorld();
    run(w, 1, { kind: "plant", item: "wheat" });
    ticks(w, WHEAT_GROWTH_TICKS);
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: true });
    expect(w.getBot(1).inventory).toEqual({ wheat: 2 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/plant.test.ts`
Expected: FAIL, `plant is not implemented`

**Step 3: Implement**

Import `removeItem` from `./inventory` and `Item` from `./types`.

In `tick()`, grow crops before bots act:

```ts
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
```

Case in `execute`:

```ts
      case "plant":
        return this.doPlant(bot, cmd.item);
```

Method:

```ts
  private doPlant(bot: Bot, item: Item): Outcome {
    const tile = this.tileAt(bot.pos);
    if (!tile || tile.terrain !== "soil" || tile.crop) return ok(false);
    if ((bot.inventory[item] ?? 0) < 1) return ok(false);
    removeItem(bot.inventory, item, 1);
    tile.crop = { item, growth: 0 };
    return ok(true);
  }
```

**Step 4: Run tests and typecheck**

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/plant.test.ts
git commit -m "feat(sim): plant command and per-tick crop growth"
```

---

### Task 8: Scan

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/scan.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import type { ScanTile } from "../../src/sim/types";
import { run } from "./helpers";

function scannerWorld(): World {
  const w = new World({ seed: 1 });
  w.getBot(1).modules.add("scanner");
  return w;
}

describe("scan", () => {
  it("returns a full square of tiles for radius 1 in the interior", () => {
    const w = scannerWorld();
    const r = run(w, 1, { kind: "scan", radius: 1 });
    expect(r.ok).toBe(true);
    const tiles = (r as { ok: true; value: ScanTile[] }).value;
    expect(tiles).toHaveLength(9);
    const xs = tiles.map((t) => t.x);
    expect(Math.min(...xs)).toBe(16);
    expect(Math.max(...xs)).toBe(18);
  });

  it("reports the scanning bot and the adjacent console", () => {
    const w = scannerWorld();
    const r = run(w, 1, { kind: "scan", radius: 1 });
    const tiles = (r as { ok: true; value: ScanTile[] }).value;
    const self = tiles.find((t) => t.x === 17 && t.y === 16)!;
    expect(self.bot).toBe(1);
    expect(self.terrain).toBe("soil");
    const console = tiles.find((t) => t.x === 16 && t.y === 16)!;
    expect(console.machine).toBe("console");
    expect(console.bot).toBeNull();
  });

  it("returns copies, not live crop references", () => {
    const w = scannerWorld();
    const tile = w.tileAt({ x: 17, y: 16 })!;
    tile.crop = { item: "wheat", growth: 3 };
    const r = run(w, 1, { kind: "scan", radius: 0 });
    const scanned = (r as { ok: true; value: ScanTile[] }).value[0]!;
    scanned.crop!.growth = 999;
    expect(tile.crop.growth).not.toBe(999);
  });

  it("clips at the world edge", () => {
    const w = scannerWorld();
    w.getBot(1).pos = { x: 0, y: 0 };
    const r = run(w, 1, { kind: "scan", radius: 1 });
    expect((r as { ok: true; value: ScanTile[] }).value).toHaveLength(4);
  });

  it("errors without a scanner", () => {
    const w = new World({ seed: 1 });
    expect(run(w, 1, { kind: "scan", radius: 1 })).toEqual({
      ok: false,
      error: "Bot 1 has no Scanner module",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/scan.test.ts`
Expected: FAIL, `scan is not implemented`

**Step 3: Implement**

Import `ScanTile` type. Case:

```ts
      case "scan":
        return this.doScan(bot, cmd.radius);
```

Method:

```ts
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
```

Note: the "clips at the world edge" test teleports the bot by writing `pos` directly. That is fine in tests; the sim never checks that a bot got where it is legally.

**Step 4: Run tests and typecheck**

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/scan.test.ts
git commit -m "feat(sim): scan command returning tile, bot, and machine info"
```

---

### Task 9: Machines, deposit, and withdraw

Adds `placeMachine()` for crates (gated by research) and the two transfer commands. Transfers target the machine in a given direction from the bot.

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/transfer.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { BOT_CAPACITY, TICK_COST } from "../../src/sim/config";
import { run } from "./helpers";

describe("deposit", () => {
  it("moves items into the adjacent console", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: 4 };
    const r = run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 3 });
    expect(r).toEqual({ ok: true, value: 3 });
    expect(w.getBot(1).inventory).toEqual({ wheat: 1 });
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({ wheat: 3 });
    expect(w.time).toBe(TICK_COST.deposit);
  });

  it("caps at what the bot holds", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: 2 };
    const r = run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 2 });
    expect(w.getBot(1).inventory).toEqual({});
  });

  it("errors when there is no machine in that direction", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: 1 };
    const r = run(w, 1, { kind: "deposit", dir: "east", item: "wheat", count: 1 });
    expect(r).toEqual({ ok: false, error: "no machine to the east" });
  });
});

describe("withdraw", () => {
  it("pulls items out of the adjacent machine", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 5 };
    const r = run(w, 1, { kind: "withdraw", dir: "west", item: "wheat", count: 2 });
    expect(r).toEqual({ ok: true, value: 2 });
    expect(w.getBot(1).inventory).toEqual({ wheat: 2 });
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({ wheat: 3 });
  });

  it("caps at remaining bot capacity", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 50 };
    w.getBot(1).inventory = { wheat: BOT_CAPACITY - 3 };
    const r = run(w, 1, { kind: "withdraw", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 3 });
    expect(w.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
  });

  it("caps at what the machine holds", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 1 };
    const r = run(w, 1, { kind: "withdraw", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 1 });
  });
});

describe("placeMachine", () => {
  it("places a crate once research is unlocked", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    const crate = w.placeMachine("crate", { x: 17, y: 17 });
    expect(crate.kind).toBe("crate");
    expect(w.machineAt({ x: 17, y: 17 })).toBe(crate);
    expect(w.tileAt({ x: 17, y: 17 })!.crop).toBeNull();
  });

  it("refuses a crate before research", () => {
    const w = new World({ seed: 1 });
    expect(() => w.placeMachine("crate", { x: 17, y: 17 })).toThrow("crate not researched");
  });

  it("refuses a second console", () => {
    const w = new World({ seed: 1 });
    expect(() => w.placeMachine("console", { x: 17, y: 17 })).toThrow("cannot place a second console");
  });

  it("refuses an occupied tile", () => {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    expect(() => w.placeMachine("crate", { x: 17, y: 16 })).toThrow("tile occupied");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/transfer.test.ts`
Expected: FAIL

**Step 3: Implement**

Cases in `execute`:

```ts
      case "deposit":
        return this.doDeposit(bot, cmd.dir, cmd.item, cmd.count);
      case "withdraw":
        return this.doWithdraw(bot, cmd.dir, cmd.item, cmd.count);
```

Methods:

```ts
  private doDeposit(bot: Bot, dir: Direction, item: Item, count: number): Outcome {
    const machine = this.machineAt(add(bot.pos, DIR[dir]));
    if (!machine) return fail(`no machine to the ${dir}`);
    const n = Math.min(Math.max(0, Math.floor(count)), bot.inventory[item] ?? 0);
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

  /** Place a machine the player has researched. */
  placeMachine(kind: MachineKind, pos: Vec): Machine {
    if (kind === "console") throw new Error("cannot place a second console");
    if (!this.research.unlocked.has(kind)) throw new Error(`${kind} not researched`);
    this.assertFree(pos);
    return this.addMachine(kind, pos);
  }
```

Put `placeMachine` next to `deployBot` in the player-actions section. TypeScript narrows `kind` to `"crate"` after the console check, which is why `unlocked.has(kind)` type-checks.

**Step 4: Run tests and typecheck**

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/transfer.test.ts
git commit -m "feat(sim): deposit, withdraw, and placeMachine for crates"
```

---

### Task 10: Research

The console eats one wheat per tick toward the front of the queue. Completing research grants hardware to the colony stockpile. `installModule` and `deployBot` (already written) spend that stockpile.

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/research.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { RESEARCH_COST } from "../../src/sim/config";
import { ticks } from "./helpers";

function fundedWorld(wheat: number): World {
  const w = new World({ seed: 1 });
  w.machineAt({ x: 16, y: 16 })!.inventory = { wheat };
  return w;
}

describe("research", () => {
  it("consumes one wheat per tick and completes at the cost", () => {
    const w = fundedWorld(100);
    w.queueResearch("planter");
    ticks(w, RESEARCH_COST.planter - 1);
    expect(w.research.unlocked.has("planter")).toBe(false);
    expect(w.research.progress).toBe(RESEARCH_COST.planter - 1);
    w.tick();
    expect(w.research.unlocked.has("planter")).toBe(true);
    expect(w.research.queue).toEqual([]);
    expect(w.research.progress).toBe(0);
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({
      wheat: 100 - RESEARCH_COST.planter,
    });
  });

  it("stalls when the console runs out of wheat, then resumes", () => {
    const w = fundedWorld(3);
    w.queueResearch("planter");
    ticks(w, 10);
    expect(w.research.progress).toBe(3);
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 100 };
    ticks(w, RESEARCH_COST.planter - 3);
    expect(w.research.unlocked.has("planter")).toBe(true);
  });

  it("processes the queue in order", () => {
    const w = fundedWorld(1000);
    w.queueResearch("planter");
    w.queueResearch("scanner");
    ticks(w, RESEARCH_COST.planter);
    expect(w.research.unlocked.has("scanner")).toBe(false);
    ticks(w, RESEARCH_COST.scanner);
    expect(w.research.unlocked.has("scanner")).toBe(true);
  });

  it("grants a spare module for module research", () => {
    const w = fundedWorld(1000);
    w.queueResearch("scanner");
    ticks(w, RESEARCH_COST.scanner);
    expect(w.research.spareModules).toEqual({ scanner: 1 });
  });

  it("grants a spare chassis for chassis research", () => {
    const w = fundedWorld(1000);
    w.queueResearch("chassis");
    ticks(w, RESEARCH_COST.chassis);
    expect(w.research.spareChassis).toBe(1);
    const bot = w.deployBot({ x: 18, y: 16 });
    expect(bot.id).toBe(3);
    expect(bot.modules.has("harvester")).toBe(true);
    expect(w.research.spareChassis).toBe(0);
    expect(() => w.deployBot({ x: 19, y: 16 })).toThrow("no spare chassis");
  });

  it("rejects duplicate, already-unlocked, and unknown research", () => {
    const w = fundedWorld(1000);
    w.queueResearch("planter");
    expect(() => w.queueResearch("planter")).toThrow("planter already queued");
    ticks(w, RESEARCH_COST.planter);
    expect(() => w.queueResearch("planter")).toThrow("planter already researched");
    expect(() => w.queueResearch("laser" as never)).toThrow("unknown research laser");
  });
});

describe("installModule", () => {
  it("moves a spare module onto a bot", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 1 };
    w.installModule(1, "planter");
    expect(w.getBot(1).modules.has("planter")).toBe(true);
    expect(w.research.spareModules).toEqual({ planter: 0 });
  });

  it("refuses without a spare", () => {
    const w = new World({ seed: 1 });
    expect(() => w.installModule(1, "planter")).toThrow("no spare planter module");
  });

  it("refuses a duplicate on the same bot", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { harvester: 1 };
    expect(() => w.installModule(1, "harvester")).toThrow("bot 1 already has harvester");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/research.test.ts`
Expected: FAIL, `w.queueResearch is not a function`

**Step 3: Implement**

Import `RESEARCH_COST` from `./config` and `ResearchName` from `./types`.

In `tick()`, add research after bots:

```ts
  tick(): void {
    this.time++;
    this.growCrops();
    for (const bot of this.bots.values()) this.advance(bot);
    this.advanceResearch();
  }
```

Methods (put in the player-actions section):

```ts
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
    if (!current) return;
    const console = this.console();
    if ((console.inventory.wheat ?? 0) < 1) return;
    removeItem(console.inventory, "wheat", 1);
    r.progress++;
    if (r.progress < RESEARCH_COST[current]) return;
    r.queue.shift();
    r.progress = 0;
    r.unlocked.add(current);
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
```

**Step 4: Run tests and typecheck**

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/research.test.ts
git commit -m "feat(sim): research queue, module stockpile, and installModule"
```

---

### Task 11: Radio

`send` broadcasts to every other bot with a radio. `receive` blocks until a matching message exists in the bot's inbox.

**Files:**
- Modify: `src/sim/world.ts`
- Test: `tests/sim/radio.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { run, ticks } from "./helpers";

function radioWorld(): { w: World; a: number; b: number; c: number } {
  const w = new World({ seed: 1 });
  w.research.spareChassis = 2;
  const b = w.deployBot({ x: 18, y: 16 }).id;
  const c = w.deployBot({ x: 19, y: 16 }).id;
  w.getBot(1).modules.add("radio");
  w.getBot(b).modules.add("radio");
  // c has no radio
  return { w, a: 1, b, c };
}

describe("radio", () => {
  it("send delivers to every other radio bot and reports the count", () => {
    const { w, a, b, c } = radioWorld();
    const r = run(w, a, { kind: "send", channel: "haul", payload: { x: 4 } });
    expect(r).toEqual({ ok: true, value: 1 });
    expect(w.getBot(b).inbox).toEqual([{ channel: "haul", payload: { x: 4 }, from: a }]);
    expect(w.getBot(a).inbox).toEqual([]);
    expect(w.getBot(c).inbox).toEqual([]);
    expect(w.time).toBe(TICK_COST.send);
  });

  it("receive returns a queued message immediately", () => {
    const { w, a, b } = radioWorld();
    run(w, a, { kind: "send", channel: "haul", payload: 1 });
    const r = run(w, b, { kind: "receive" });
    expect(r).toEqual({ ok: true, value: { channel: "haul", payload: 1, from: a } });
    expect(w.getBot(b).inbox).toEqual([]);
  });

  it("receive blocks until a message arrives", () => {
    const { w, a, b } = radioWorld();
    w.issue(b, { kind: "receive" });
    ticks(w, 5);
    expect(w.takeResult(b)).toBeNull();
    expect(w.getBot(b).blockedOn).toBe("radio");

    run(w, a, { kind: "send", channel: "ping", payload: null });
    w.tick();
    expect(w.takeResult(b)).toEqual({
      ok: true,
      value: { channel: "ping", payload: null, from: a },
    });
    expect(w.getBot(b).blockedOn).toBeNull();
  });

  it("receive with a channel skips other channels", () => {
    const { w, a, b } = radioWorld();
    run(w, a, { kind: "send", channel: "other", payload: 0 });
    run(w, a, { kind: "send", channel: "want", payload: 1 });
    const r = run(w, b, { kind: "receive", channel: "want" });
    expect(r).toEqual({ ok: true, value: { channel: "want", payload: 1, from: a } });
    expect(w.getBot(b).inbox).toEqual([{ channel: "other", payload: 0, from: a }]);
  });

  it("errors without a radio", () => {
    const { w, c } = radioWorld();
    expect(run(w, c, { kind: "send", channel: "x", payload: 0 })).toEqual({
      ok: false,
      error: `Bot ${c} has no Radio module`,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/radio.test.ts`
Expected: FAIL, `send is not implemented`

**Step 3: Implement**

Cases:

```ts
      case "send":
        return this.doSend(bot, cmd.channel, cmd.payload);
      case "receive":
        return this.doReceive(bot, cmd.channel);
```

Methods:

```ts
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
      bot.blockedOn = "radio";
      return RETRY;
    }
    const [msg] = bot.inbox.splice(idx, 1);
    return ok(msg);
  }
```

Now every `Command` kind has a case. Replace the `default` branch in `execute` with an exhaustiveness check:

```ts
      default: {
        const never: never = cmd;
        return fail(`unknown command ${String(never)}`);
      }
```

**Step 4: Run tests and typecheck**

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0. If it reports `cmd` is not assignable to `never`, a case is missing.

**Step 5: Commit**

```bash
git add src/sim/world.ts tests/sim/radio.test.ts
git commit -m "feat(sim): radio send and blocking receive"
```

---

### Task 12: Snapshot and determinism

`snapshot()` returns a plain, JSON-safe object the renderer, the save system, and the worker bridge will all read. Also proves that two worlds fed the same seed and commands produce identical snapshots.

**Files:**
- Modify: `src/sim/types.ts`
- Modify: `src/sim/world.ts`
- Test: `tests/sim/snapshot.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { run, ticks } from "./helpers";

function drive(w: World): void {
  w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 40 };
  w.queueResearch("planter");
  run(w, 1, { kind: "harvest" });
  run(w, 1, { kind: "move", dir: "east" });
  run(w, 1, { kind: "harvest" });
  run(w, 1, { kind: "move", dir: "west" });
  run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 5 });
  ticks(w, 20);
}

describe("snapshot", () => {
  it("is JSON round-trippable", () => {
    const w = new World({ seed: 5 });
    drive(w);
    const snap = w.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it("reflects world state", () => {
    const w = new World({ seed: 5 });
    drive(w);
    const snap = w.snapshot();
    expect(snap.time).toBe(w.time);
    expect(snap.bots).toHaveLength(1);
    expect(snap.bots[0]!.modules).toEqual(["harvester"]);
    expect(snap.bots[0]!.busy).toBe(false);
    expect(snap.machines[0]!.kind).toBe("console");
    expect(snap.research.queue).toEqual(["planter"]);
    expect(snap.research.unlocked).toEqual([]);
  });

  it("does not share references with the live world", () => {
    const w = new World({ seed: 5 });
    const snap = w.snapshot();
    snap.tiles[0]!.terrain = "soil";
    snap.bots[0]!.pos.x = 999;
    expect(w.tiles[0]!.terrain).toBe("grass");
    expect(w.getBot(1).pos.x).toBe(17);
  });
});

describe("determinism", () => {
  it("same seed and commands give identical snapshots", () => {
    const a = new World({ seed: 123 });
    const b = new World({ seed: 123 });
    drive(a);
    drive(b);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/sim/snapshot.test.ts`
Expected: FAIL, `w.snapshot is not a function`

**Step 3: Add snapshot types to `src/sim/types.ts`**

```ts
export interface BotSnapshot {
  id: number;
  pos: Vec;
  inventory: Inventory;
  modules: ModuleName[];
  busy: boolean;
  blockedOn: BlockedOn;
}

export interface MachineSnapshot {
  id: number;
  kind: MachineKind;
  pos: Vec;
  inventory: Inventory;
}

export interface ResearchSnapshot {
  unlocked: ResearchName[];
  queue: ResearchName[];
  progress: number;
  spareModules: Partial<Record<ModuleName, number>>;
  spareChassis: number;
}

export interface WorldSnapshot {
  seed: number;
  width: number;
  height: number;
  time: number;
  tiles: Tile[];
  bots: BotSnapshot[];
  machines: MachineSnapshot[];
  research: ResearchSnapshot;
}
```

**Step 4: Implement `snapshot()` in `src/sim/world.ts`**

Import `WorldSnapshot`. Add the method after `takeResult`:

```ts
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
      })),
      machines: [...this.machines.values()].map((m) => ({
        id: m.id,
        kind: m.kind,
        pos: { ...m.pos },
        inventory: { ...m.inventory },
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
```

**Step 5: Run tests and typecheck**

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 6: Commit**

```bash
git add src/sim/types.ts src/sim/world.ts tests/sim/snapshot.test.ts
git commit -m "feat(sim): JSON-safe snapshot and determinism test"
```

---

### Task 13: Reference script harness

The first balance test. A hand-written "beginner harvest loop" runs against the sim and must fill the bot's inventory in a bounded number of ticks. When tick costs or field density change, this test tells you the beginner experience changed.

**Files:**
- Test: `tests/sim/reference-scripts.test.ts`

**Step 1: Write the test**

```ts
import { World } from "../../src/sim/world";
import { BOT_CAPACITY } from "../../src/sim/config";
import type { Direction } from "../../src/sim/types";
import { run } from "./helpers";

/**
 * The loop a beginner writes after their first two insights:
 * harvest, step, and turn around at the edge. Stops on the first error,
 * which will be "inventory full".
 */
function beginnerHarvestLoop(w: World, botId: number): string {
  let dir: Direction = "east";
  for (let guard = 0; guard < 10_000; guard++) {
    const h = run(w, botId, { kind: "harvest" });
    if (!h.ok) return h.error;
    const m = run(w, botId, { kind: "move", dir });
    if (!m.ok) return m.error;
    if (m.value === false) {
      run(w, botId, { kind: "move", dir: "south" });
      dir = dir === "east" ? "west" : "east";
    }
  }
  return "guard exhausted";
}

describe("reference scripts", () => {
  it("beginner harvest loop fills the inventory within 200 ticks", () => {
    const w = new World({ seed: 1 });
    const stopReason = beginnerHarvestLoop(w, 1);
    expect(stopReason).toBe("inventory full");
    expect(w.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
    expect(w.time).toBeLessThan(200);
  });

  it("is stable across a handful of seeds", () => {
    for (const seed of [2, 3, 4, 5, 6]) {
      const w = new World({ seed });
      expect(beginnerHarvestLoop(w, 1)).toBe("inventory full");
      expect(w.time).toBeLessThan(250);
    }
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/sim/reference-scripts.test.ts`
Expected: `2 passed`. If the tick bound fails, print `w.time` and decide whether the bound or the config is wrong. Do not raise the bound above 300 without noting why in the commit message; that is a balance signal, not a test bug.

**Step 3: Run everything one last time**

Run: `npm test`
Expected: all passing, no skipped tests.

Run: `npm run typecheck`
Expected: exit 0

**Step 4: Commit**

```bash
git add tests/sim/reference-scripts.test.ts
git commit -m "test(sim): beginner harvest loop as reference balance test"
```

---

## Done criteria for milestone 1

- `npm test` passes with roughly 55 tests across 11 files.
- `npm run typecheck` is clean.
- `World` exposes exactly: constructor, `inBounds`, `tileAt`, `botAt`, `machineAt`, `getBot`, `issue`, `takeResult`, `tick`, `snapshot`, `deployBot`, `placeMachine`, `queueResearch`, `installModule`. Nothing else public.
- No file outside `src/sim/` and `tests/` was created.
- Every commit message in `git log` matches the plan.

## What milestone 2 will build on this

The worker bridge will call `issue()` when a script's blocking call arrives over the SharedArrayBuffer, call `tick()` on a timer, and forward `takeResult()` back to wake the script. `snapshot()` feeds the renderer. None of the sim's public surface should need to change for that; if it does, that is a design finding worth writing down.
