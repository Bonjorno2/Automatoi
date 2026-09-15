# Milestone 4: The World You Can Watch

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A player presses Run and *watches* it happen — a bot gliding tile to tile across a field of wheat that visibly ripens, bumping off the wall with a mark that says so, the Research Console filling toward the planter. Every silent failure milestone 3 found gets a face. The text readout dies.

**Architecture:** The renderer is a pure view. It reads a world snapshot and draws; it never calls `issue`, never mutates a tile, never advances time. That direction of dependency is the whole design — it is what lets the sim run headless at 10,000 ticks in a Vitest file and at 20 Hz in a browser from the same code. Three layers stack inside one PixiJS `Application`, **named by update frequency rather than by content**: **static** (terrain, drawn once), **tick** (crops today, ground items and belts in milestone 5), **frame** (actors, interpolated). The clock grows the interpolation alpha it deliberately did not have in milestone 3, which is the half of the accumulator that only means something once something is being drawn.

**Tech Stack:** Adds `pixi.js` 8.20.1. Everything else unchanged — TypeScript 5 strict ESM, Vite 5, Vitest 2, Monaco.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md`, sections "Architecture", "Failure is content" and "First playable scope". **Milestone 3 reference:** `docs/plans/2026-09-15-milestone-3-editor.md`, especially its "Findings from Task 11" — findings 2, 3 and 6 are this milestone's work, and finding 1 is explicitly *not* (see Decision 2).

---

## Decisions already made

These were settled before this plan was written. Do not relitigate them mid-task.

1. **The renderer comes before the hands phase.** Milestone 3's handoff argued the opposite: that wiring `placeMachine`/`installModule` is more urgent than drawing. The counter-argument won on one point — the hands phase is *placement*, and placement without a map is a coordinate form. Building click-to-place against a four-line text readout means building it twice. The renderer is therefore milestone 4; the hands phase is milestone 5 and inherits a canvas to click on.

2. **Finding 1 stays open for one more milestone.** Research still pays out into a void at the end of this milestone. That is a known, accepted, temporary state. What this milestone *does* owe it: the console's research progress must be visible on the canvas, so that when milestone 5 makes the payout collectable, the player already knows it is coming.

3. **No camera.** The world is 32x32 and fits. The canvas scales the whole grid to its pane and letterboxes the remainder. No panning, no zoom, no scroll handling, no culling. This is a deliberate scope cut that a larger world will later force open; it removes an entire class of input plumbing from a milestone that does not need it yet.

4. **`src/sim/` may be modified now, but its 164 tests may not.** Milestone 3 froze the sim entirely. That rule expires here, because the renderer needs two things the sim does not yet expose (Task 4's action progress, Task 5's events). Both are **additive**: new fields, new arrays, no changed semantics. The rule that replaces the freeze is the same one milestone 3 used for seams — if an existing test needs editing to pass, the change is wrong. Fix the change, not the test.

5. **Colored squares, drawn well.** The design says "art beyond coloured squares" is out of scope, and it stays out: no sprite sheets, no imported assets, no animation frames. Everything is `Graphics` primitives. That is not a licence to be ugly — a considered palette, growth stages, facing, and legible status marks all come free from geometry, and they are the difference between a debug view and a game.

6. **The renderer is not unit-tested; its arithmetic is.** WebGL in Vitest is a trap. Every task therefore splits: pure functions (grid geometry, crop stage, interpolated position, palette) go in their own modules with real tests, and the Pixi glue that consumes them carries a **Manual check** block instead. If a bug can only be caught by eye, the task says so out loud.

7. **Everything keyed by kind is a table, not a branch.** This is the design's *Factorio* half arriving early, and it is a discipline rather than a feature. The world today has one item and two machine kinds; milestone 5 brings a production chain — wheat → flour → bread — and with it a mill, an oven, and two new items that can sit on the ground. A renderer written as `if (kind === "console") … else if (kind === "crate")` makes each of those a task. A renderer written as a lookup keyed by `MachineKind` and `Item` makes each of them a table row.

   The line this decision does **not** cross: no art for machines that do not exist, no layer for items that cannot be on the ground yet, no speculative `BeltRenderer`. Generic *seams*, concrete *contents*. If a task cannot name the row it is adding today, it is not adding the table.

---

## Three facts this plan depends on

The first two are **not yet verified** and each has a step that checks it before anything is built on top. The third is verified below.

### Fact 1: PixiJS 8 runs in a cross-origin isolated page (verify in Task 1)

`pixi.js` 8 initialises asynchronously (`await app.init(...)`, unlike v7's constructor) and picks WebGPU or WebGL at runtime. Two things are unverified: that it bundles cleanly under Vite's COEP headers (it is a local dependency, so no CORP negotiation is expected — but "expected" is why this is a step and not a sentence), and that its worker-based asset loading, if any path we touch triggers it, survives isolation. Task 1 Step 1 puts a single rectangle on screen and stops. **If that rectangle does not appear, nothing else in this milestone works**, and finding out at Task 1 costs an hour instead of a day.

### Fact 2: a 1024-tile snapshot per frame is or is not affordable (measure in Task 2)

`world.snapshot()` deep-copies every tile, every bot, every machine. At 60 fps on a 32x32 world that is ~61,000 object allocations a second, purely to observe a grid that changes a handful of tiles per tick. The design says the renderer reads a snapshot each frame; that is a statement about *direction*, not about *allocation*. Task 2 measures it and picks between three options already scoped: snapshot per frame (keep it simple if it is free), snapshot per tick with per-frame reads of actors only, or a read-only live view. **Do not guess. Measure, record the number in the commit body, then choose.**

### Fact 3: the main thread is legal and currently uncontested (verified, re-tested in Task 8)

Milestone 3 Fact 1 established the host never calls `Atomics.wait`, so `World` + `ScriptColony` on the main thread is sound. What was never established is whether it is *fast* enough, because there was nothing competing for the frame. Task 8 is the first honest measurement, and milestone 3 Decision 1 explicitly deferred the "where does the sim run" question to it.

---

## Conventions for every task

- Renderer source lives in `src/render/`. Page wiring stays in `src/editor/main.ts`. Sim changes are additive and live in `src/sim/`.
- Tests live in `tests/render/` or `tests/sim/`, mirroring the source file name.
- Run `npm run typecheck` before every commit. A commit with type errors is a failed step.
- Run `npm test` before every commit. **164 tests must stay green and unedited.**
- Commit after each task with the message given. Do not batch tasks into one commit.
- Pure functions before Pixi glue, always. If a task's arithmetic is not extractable, say why in the commit body.
- Never add a feature a later task does not ask for. In particular: no camera, no placement UI, no minimap, no sound, no sprite assets.

## Domain vocabulary

Milestones 1–3's vocabulary carries over. New terms:

- **Stage.** The PixiJS `Application` plus its three layer containers. One per page, owned by `src/render/stage.ts`.
- **Geometry.** The pure mapping between tile coordinates and pixels, both ways. Depends only on grid size and pane size.
- **Alpha.** The fraction of a tick elapsed since the last one, in `[0, 1)`. Multiplies nothing but position.
- **Actor.** A bot or a machine — the few entities that move or change often enough to be redrawn every frame.
- **Mark.** A short-lived visual emitted by a world event: the bump when a bot walks into a wall, the spark on an error. Marks live in the renderer and decay in real time; the sim's event that spawned one is consumed immediately and never stored.

---

### Task 1: A rectangle on the page

Proves Fact 1 before anything depends on it. This is the milestone's highest-risk step and it is deliberately first, and deliberately trivial.

**Files:**
- Add: `src/render/stage.ts`, `src/render/geometry.ts`
- Modify: `index.html` (three-column layout), `src/editor/main.ts`, `package.json`
- Test: `tests/render/geometry.test.ts`

**Step 1: Install and draw one rectangle**

```bash
npm install pixi.js@8.20.1
```

In `src/render/stage.ts`, the smallest possible thing: `await app.init({ resizeTo: element, background: "#12140f", antialias: true })`, append `app.canvas`, add one `Graphics` rect, return. Wire it into `main.ts` behind the existing isolation check. Load the page.

**Manual check (blocking):** a rectangle is visible, the console is free of COEP warnings, and `crossOriginIsolated` is still `true`. If the canvas is blank, check WebGL availability before assuming a bundling problem — `app.renderer.type` tells you which backend was chosen. Record the backend in the commit body.

**Step 2: The three-column layout**

`index.html` currently splits editor and side panel. It becomes world, editor, side panel:

```css
grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr) 22rem;
```

`#world` is a positioned block with `overflow: hidden`; Pixi's `resizeTo` handles the rest. The editor pane keeps `min-width: 0` — without it, Monaco refuses to shrink and pushes the canvas off screen. Remove nothing from the side panel yet; the readout dies in Task 7, not here.

**Step 3: Geometry, pure and tested**

`src/render/geometry.ts` owns the only arithmetic that matters:

```ts
export interface Geometry {
  /** Side of one tile, in CSS pixels. */
  size: number;
  /** Pixel offset of tile (0,0), centring the grid in the pane. */
  originX: number;
  originY: number;
}

export function fit(grid: { width: number; height: number }, pane: { width: number; height: number }): Geometry;
export function toPixel(g: Geometry, tile: Vec): { x: number; y: number };
export function toTile(g: Geometry, px: { x: number; y: number }): Vec | null;
```

`fit` takes the smaller of `pane.width / grid.width` and `pane.height / grid.height` so the grid always fits whole, then centres. `toTile` returns `null` outside the grid — Task 6 depends on that, and a clamping version would silently report edge tiles for clicks in the letterbox.

Tests: a square pane gives a square fit; a wide pane centres horizontally with `originY === 0`; `toTile(toPixel(t))` round-trips for every corner tile; a point in the letterbox gives `null`; a degenerate zero-size pane does not produce `NaN` or `Infinity`.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(render): pixi canvas in a three-column page, with tested geometry"
```

---

### Task 2: The field

The tile layer. This is where Fact 2 gets measured.

**Files:**
- Add: `src/render/palette.ts`, `src/render/tiles.ts`
- Modify: `src/render/stage.ts`
- Test: `tests/render/palette.test.ts`

**Step 1: Measure the snapshot (blocking, Fact 2)**

Before writing the layer, in the page console:

```js
const t0 = performance.now();
for (let i = 0; i < 600; i++) session.world.snapshot();
console.log((performance.now() - t0) / 600, "ms per snapshot");
```

Ten frames' worth of budget is 0.16 ms. Decision rule, fixed in advance so the number decides and not the mood:

- **under 0.15 ms** — snapshot per frame. Simplest, matches the design's wording, stop thinking about it.
- **0.15 to 0.5 ms** — snapshot once per tick (the session already knows when a tick happened), and read `world.bots` directly for per-frame actor positions through a `readonly` view type.
- **over 0.5 ms** — as above, and open a note for milestone 5 on a dirty-rect or versioned-tile scheme.

Record the measured number in the commit body either way. It is the first real performance datum this project has.

**Step 2: A palette worth looking at**

`src/render/palette.ts` is pure colour arithmetic, no Pixi import:

```ts
export const TERRAIN: Record<Terrain, { base: number; alt: number }> = {
  grass: { base: 0x2f3a26, alt: 0x35402b },   // checker, ~6% lift
  soil:  { base: 0x4a3a2a, alt: 0x51402f },
};

/** Per Decision 7: one row per item. Today that is one row. */
export const ITEM: Record<Item, { ripe: number; young: number }> = {
  wheat: { ripe: 0x9bbf4a, young: 0x5f7a3a },
};

export const COLOR = { bot: 0xe0c060, botIdle: 0x9a8a50 } as const;

/** 0 = just planted, 3 = mature. Drives both height and colour of the shoot. */
export function cropStage(growth: number): 0 | 1 | 2 | 3;
export function cropColor(item: Item, growth: number): number;
```

The checkerboard lift is what keeps a 13x13 soil field from reading as one brown rectangle — it costs nothing and it is the difference between a grid and a smear. `cropStage` buckets `growth / WHEAT_GROWTH_TICKS` into quarters; `cropColor` lerps `young` to `ripe` continuously, so a field planted in one pass ripens as a visible wave rather than four steps.

`Terrain` and `Item` are both sim union types, so `Record` makes the compiler the thing that notices milestone 5's new items. That is the entire cost of Decision 7 here: a `Record` instead of a constant, and a parameter that has exactly one legal value today.

Tests: `cropStage(0) === 0`; `cropStage(WHEAT_GROWTH_TICKS) === 3`; stage is monotonic across the range; `cropColor` at 0 is `young` and at maturity is `ripe`; both handle `growth` above maturity without overflowing; every `Terrain` and every `Item` has a palette row (a loop over the record, so a new item fails the test rather than rendering invisible).

**Step 3: The tile layer**

`src/render/tiles.ts` draws terrain **once** into a single `Graphics` — terrain never changes in the first playable, and a per-tile `Graphics` object 1024 times over is how a canvas becomes a slideshow. Crops get a pooled `Graphics` per soil tile (169 of them, created once, `visible = false` until planted), updated on tick:

```ts
export function createTileLayer(geometry: Geometry, snapshot: WorldSnapshot): TileLayer;
// layer.updateCrops(snapshot) — called on tick, not on frame
// layer.resize(geometry) — rebuilds terrain, repositions crops
```

Draw a crop as a rounded upright bar, height and colour from `cropStage`/`cropColor`, so an immature tile is unmistakably different from a ripe one at a glance. That distinction is load-bearing: milestone 3's finding 5 says the planter is what makes the farm renewable at all, and a player who cannot see growth cannot see why.

**Keep the crop pool strictly separate from the terrain `Graphics`.** Crops are the first inhabitant of the tick layer, and milestone 5's ground items — flour waiting on a tile, bread moving along a belt — are the second. They update at the same rate and by the same rule (redraw a tile when its contents change), so the pool's shape is the thing being prototyped here, not just its wheat. If updating a crop requires touching the terrain draw, the layer split is wrong.

**Manual check:** the field reads as a field. Soil, grass and wheat are distinguishable at a glance and at a squint. Ripe and unripe wheat are distinguishable at a glance. Resizing the window re-fits without gaps or overlap.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(render): terrain and crops, with growth visible in the field"
```

---

### Task 3: Alpha

The half of the accumulator milestone 3 built and deliberately left unused. Small, pure, fully testable, and Task 4 cannot be smooth without it.

**Files:**
- Modify: `src/bridge/clock.ts`
- Test: `tests/bridge/clock.test.ts` (add to it — the existing cases stay unedited)

**Step 1: Expose the remainder**

`RealtimeClock` already keeps `accumulator` as leftover milliseconds after `ticksDue`. Alpha is that over `tickMs`:

```ts
/** Fraction of a tick elapsed since the last one, in [0, 1). */
get alpha(): number {
  if (this.paused) return 0;
  return Math.min(this.accumulator / this.tickMs, 1);
}
```

Two properties matter and both are behavioural, not cosmetic. **Paused reads zero**, which removes *sub-tick* drift and nothing else — a bot one tick into a two-tick move is genuinely half way between two tiles and a paused renderer should say so; what zero buys is that pausing at a given tick always draws the same frame instead of whatever fraction the wall clock happened to reach. **Catch-up reads zero**, because `ticksDue` already zeroes the accumulator when it clamps; a tab returning from the background resumes from tick boundaries rather than sliding from stale positions.

> Corrected during Task 4. The first draft of this section claimed a paused bot "sits on a tile". It does not, and should not: freezing tick-level progress too would snap a mid-move bot backward onto a tile it has already left. Task 4's manual check is corrected to match.

`DemandClock` gets `alpha = 0` too, so the `Clock` interface stays one type and headless callers are unaffected.

**Step 2: Tests**

With an injected `now`, all deterministic: alpha is 0 immediately after construction; after half a tick's worth of milliseconds it is 0.5; after 1.5 ticks it is 0.5 with one tick due; it never reaches or exceeds 1; `speed = 2` doubles its rate; pausing reads 0 and unpausing does not resume mid-tick; a clamped catch-up leaves it at 0.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(clock): interpolation alpha, zero when paused or catching up"
```

---

### Task 4: Bots that move

The task that makes it feel alive. A bot whose position only updates when a 2-tick move completes reads as teleporting; a bot that slides between tiles reads as walking.

**Files:**
- Add: `src/render/actor-pos.ts`, `src/render/actors.ts`
- Modify: `src/sim/types.ts`, `src/sim/world.ts`, `src/render/stage.ts`
- Test: `tests/render/actor-pos.test.ts`, `tests/sim/snapshot.test.ts` (add cases only)

**Step 1: The sim exposes action progress (additive)**

The renderer cannot interpolate what it cannot see. `Action` gains `total`, set from the same `TICK_COST` lookup that already sets `remaining`:

```ts
export interface Action {
  command: Command;
  remaining: number;
  total: number;      // new
}

export interface ActionSnapshot {
  kind: Command["kind"];
  dir: Direction | null;   // only moves have one
  remaining: number;
  total: number;
}
```

`BotSnapshot` gains `action: ActionSnapshot | null`. `busy` stays exactly as it is — it is in the worker-facing mirror protocol and nothing here touches that. Verified before writing: no test constructs an `Action` literal, and no test asserts an exhaustive `toEqual` on a bot snapshot, so this is green by construction. If it is not, the change is wrong.

**Step 2: The interpolated position, pure**

```ts
export function actorPos(bot: BotSnapshot, alpha: number): { x: number; y: number };
```

Rules, each one earned from something the sim actually does:

- No action, or a non-move action: the bot's own tile. Harvesting does not slide.
- `blockedOn !== null`: the bot's own tile, *whatever the action says*. A bot waiting on an occupied tile has had `remaining` reset to 1 by the retry path, and interpolating that would make it lunge at the tile it cannot enter, once per tick, forever.
- A move in progress: lerp from `pos` toward `pos + DIR[dir]` by `(total - remaining + alpha) / total`, clamped to `[0, 1)`. Never 1 — the sim itself puts the bot on the destination tile the moment the move resolves, and a renderer that also reaches 1 produces a one-frame double-step.
- A move that will be refused (a wall or a machine ahead) still slides. The sim only discovers the refusal when the action resolves, so the renderer cannot know earlier without duplicating collision rules, and duplicated rules drift. The bot slides, then snaps back, and Task 5 marks the bump. That snap-back is *correct feedback*, not an artifact: it is what walking into a wall looks like.

Tests cover every rule above, including the clamp, a `total` of 1, and a blocked bot mid-move.

**Step 3: Actor sprites**

`src/render/actors.ts` keeps one container per bot and per machine, created and destroyed as the snapshot's id set changes — the second bot in milestone 5 and the crate must appear without any special casing here.

- **Bot:** a rounded square, with a notch on the facing edge (last commanded direction, held between moves so an idle bot keeps facing where it went) and small pips for installed modules. Dim (`botIdle`) when it has no action, bright when it does — milestone 3's finding 2 complains that standing still and working still look identical, and this is half the answer.

Machines are a registry, per Decision 7 — `Record<MachineKind, MachineStyle>`, where a style is a fill, a silhouette and an optional overlay:

| Kind | Style | Overlay |
|---|---|---|
| `console` | Blue block, inset panel | Progress arc, `research.progress / RESEARCH_COST[queue[0]]`, empty when nothing is queued |
| `crate` | Brown block, lid seam | Fill level from `total(inventory) / capacity` |

The console's arc is Decision 2's obligation discharged: the research payout becomes visible a milestone before it becomes collectable. The crate is drawn now even though nothing can place one yet, because milestone 5 places it and an undrawn machine is a debugging session.

The registry's real job is milestone 5. A mill and an oven are two more rows — a fill, a silhouette, and an overlay that is *also* a progress arc, because "machine part-way through converting its input" is the same visual question the console already asks. Write the overlay as a shared helper on that assumption; do not write the mill.

Wire the per-frame update into the existing `draw()` loop in `main.ts`: actors every frame with `clock.alpha`, crops only when `snapshot.time` changed.

**Manual check:** run the two-line opening script. The bot slides east smoothly at 1x, still smoothly at 0.5x, and lands on tile centres at 4x. Pause mid-move: it holds still at the tick-level fraction it reached — half way through a two-tick move means half way between two tiles, and it must not jitter. Step once: it advances by exactly one tick's worth.

**Verification note.** The preview pane this project is developed against delivers **zero** `requestAnimationFrame` callbacks despite reporting `visibilityState: "visible"`, so the draw loop is suspended except when a screenshot forces a paint. Smoothness therefore cannot be sampled frame by frame here. What can be checked, and is: drive the sim into a deterministic mid-move state (issue a move, tick once, pause), force a paint, and read the sprite's position back out of the scene graph. Half way through a two-tick move must read exactly `pos + 0.5`.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(render): bots that slide between tiles, machines that show their work"
```

---

### Task 5: Failure is content

Milestone 3's findings 2 and 3 are the same bug wearing two hats: **a bot doing something impossible looks exactly like a bot doing something.** The design has a whole section promising otherwise. This task keeps it.

**Files:**
- Add: `src/render/marks.ts`
- Modify: `src/sim/types.ts`, `src/sim/world.ts`, `src/render/stage.ts`
- Test: `tests/sim/events.test.ts`, `tests/render/marks.test.ts`

**Step 1: The sim emits events (additive)**

`World` gains a drainable event list — not a log, not history, not a replay buffer:

```ts
export type WorldEvent =
  // Bots
  | { kind: "bump"; botId: number; pos: Vec; dir: Direction }       // move refused
  | { kind: "refused"; botId: number; pos: Vec; command: Command["kind"] }  // harvest/plant did nothing
  | { kind: "full"; botId: number; pos: Vec }                        // inventory full
  | { kind: "blocked"; botId: number; pos: Vec; on: BlockedOn }      // waiting on a bot or a radio
  // Machines
  | { kind: "starved"; machineId: number; pos: Vec }                 // wants input, has none
  | { kind: "research"; name: ResearchName };                        // completed

/** Take and clear. The renderer is the only consumer; nothing is retained. */
drainEvents(): WorldEvent[];
```

Emission points are the existing `ok(false)` and `fail(...)` returns — no new branches, one `this.emit(...)` each. `blocked` is emitted on the tick a bot *enters* a blocked state, not every tick it stays there, or a bot waiting on a radio would emit twenty events a second.

`starved` is not speculative Factorio plumbing; it names a silent failure the game has **right now**. `advanceResearch` returns early when the console holds no wheat, so a player who queues the planter and then forgets to deliver sees a queued research that simply never progresses, with no signal anywhere. That is the same species as findings 2 and 3 and it went unnoticed because nothing was drawing the console. It is also, exactly, Factorio's "machine starved for input" — so milestone 5's mill and oven emit this same event, and the design's promised "conveyor jammed, belt turns amber" is its mirror (`blocked` output rather than missing input) and is the only row this union is knowingly missing. Emit it on the same edge rule as `blocked`: on entering the state, not every tick inside it.

Two constraints keep this from becoming a memory leak or a determinism hazard. The list is **capped** (64) and drops oldest on overflow, because nothing guarantees a consumer — a headless test drains never. And `drainEvents` is the only reader, so `snapshot()` is untouched and every determinism test still compares equal.

Tests: walking into the east wall emits exactly one `bump` with the right direction; walking into the console emits `bump`; harvesting bare soil emits `refused`; harvesting with a full inventory emits `full`; two bots contesting one tile emits `blocked` once, not once per tick; a research queued against an empty console emits `starved` once, not once per tick, and stops being starved when wheat arrives; the cap drops oldest and never grows unbounded; a world nobody drains still passes every existing determinism test.

**Step 2: Marks**

`src/render/marks.ts` turns drained events into short-lived visuals that decay in **real** time, not sim time — a mark is feedback to a human, and at 4x speed a tick-timed mark is a flicker:

| Event | Mark |
|---|---|
| `bump` | A short arc on the blocked edge, punched outward, ~400 ms |
| `refused` | A grey dash over the tile, ~400 ms |
| `full` | An amber bar over the bot, ~600 ms |
| `blocked` on `bot` | A red collision diamond between the two, held while blocked |
| `blocked` on `radio` | A radio glyph over the bot, held while blocked |
| `starved` | The machine's overlay arc turns hollow amber, held while starved |
| `research` | A ring expanding from the console, ~900 ms |

The pure part is the decay: `markAlpha(ageMs, lifetimeMs)` easing out, tested at 0, mid, and past end (clamped to 0, never negative).

The design's failure table also wants a spark on a runtime error and a hung icon. Both already exist as session state rather than world events — `ScriptOutcome` carries them — so they are drawn from the session directly, not through the event path. Do not route them through `WorldEvent`; the sim has no idea a script exists and must not learn.

**Manual check — this is the task's real test.** Run milestone 3's exact failing script:

```js
while (true) { bot.harvester.harvest(); bot.move("east"); }
```

Watch it to the east wall. From the canvas alone it must be obvious that the bot is stuck and why. Then run the finding-3 script — `while (bot.pos().x < 17) bot.move("east")` along y=16, straight into the Research Console — and confirm the same. Record in the commit body whether a player could now diagnose both without reading a single line of code. **If they could not, this task is not done.**

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(render): world events and marks, so a stuck bot looks stuck"
```

---

### Task 6: The inspector

A grid of coloured squares answers "what is happening". It does not answer "what is *that*". Hover and click close that gap, and they are also the input plumbing milestone 5's placement UI will reuse — the cheapest possible version of it, built where it can be verified against things that already exist.

**Files:**
- Add: `src/render/inspector.ts`
- Modify: `src/render/stage.ts`, `index.html`
- Test: `tests/render/inspector.test.ts`

**Step 1: Pointer to tile**

`toTile` from Task 1 already does the arithmetic, including the `null` for the letterbox. This step adds only the DOM plumbing: pointer coordinates relative to the canvas bounding rect, and a hover highlight on the tile under the cursor (a thin outline, not a fill — a fill hides the crop you are asking about).

**Step 2: The describe function, pure**

```ts
export function describeTile(snapshot: WorldSnapshot, tile: Vec): string[];
```

Returns display lines, most specific first: bot (id, modules, current action), machine (kind and inventory), crop (item and a growth percentage), terrain. Pure over a snapshot, so it is fully testable: a bot on a crop lists both; an empty grass tile lists one line; an out-of-bounds tile returns `[]`; a mature crop reads 100% and never 103%.

**Step 3: Click to select**

Clicking a bot selects it; the selection ring persists and the side panel's readout follows the selected bot. With one bot this does nothing visible — which is precisely why it is built now rather than in milestone 5, where it would be built in a hurry while also being needed.

Clicking empty space clears the selection. **Do not add placement here.** No right-click menu, no drag, no keyboard shortcuts. That is milestone 5 and it will want this task's `toTile` unchanged.

**Manual check:** hovering every kind of tile shows a correct, readable description. The highlight tracks the cursor without lag and disappears in the letterbox.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat(render): hover to inspect a tile, click to select a bot"
```

---

### Task 7: The readout dies

The four-line text block in `main.ts` was scaffolding for a milestone with no renderer, and it has one now. What it carried that still matters moves onto the canvas or into the panel deliberately, one line at a time.

**Files:**
- Modify: `src/editor/main.ts`, `index.html`, `src/render/stage.ts`
- Add: `src/render/hud.ts`

**Step 1: Account for every line**

| Readout line | Where it goes |
|---|---|
| `tick` | HUD, top-left of the canvas, with speed beside it |
| `pos` | Gone — the bot is visible on the grid, and the inspector says it exactly |
| `wheat` | A capacity bar on the panel, `n / BOT_CAPACITY`, for the selected bot |
| `state` | Gone from text — the bot's own brightness and marks carry it |
| `paused`, speed | HUD, plus a subtle desaturation of the whole stage while paused |

The capacity bar matters more than the number did: milestone 3's snippet book has a "Don't overfill" chip, and `BOT_CAPACITY` is 10, so a bar that visibly fills is the thing that teaches why that chip exists.

**Step 2: Research on the panel**

A single line per queued research: name, and `progress / RESEARCH_COST[name]`. This is the last piece of Decision 2's obligation, and it is also the answer milestone 3's finding 4 wanted — the finding asked for script-readable research state, which is milestone 5's API work, but a player staring at a panel does not need an API. Do not add `colony.research.state()` here.

**Manual check:** run the reference harvest-and-deliver script end to end. From the canvas and panel alone, without the editor, it is clear what the bot is carrying, what it is doing, and how close the planter is. Pausing is unmistakable.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat(render): HUD and capacity bar replace the text readout"
```

---

### Task 8: The frame budget, and where the sim runs

Milestone 3 Decision 1 put the sim on the main thread *provisionally* and named this milestone as the place to answer it with numbers. There are finally numbers to take.

**Files:**
- Modify: `src/render/hud.ts`, possibly `src/sim/world.ts`
- Test: possibly `tests/sim/world.test.ts` (add cases only)

**Step 1: Measure**

Add a perf line to the HUD, behind a `?perf` query flag so it is not in a player's face: rolling means over 120 frames of `colony.pass()` and of draw, plus the frame interval. Take readings in four states, and record all four in the commit body:

1. Idle, no script, 1x.
2. Reference harvest loop, 1x.
3. Reference harvest loop, 4x.
4. Reference harvest loop, 4x, with a full field of planted crops.

**Step 2: Decide, by a rule fixed in advance**

Budget is 16.6 ms. Decision rule:

- **Draw + pass under 8 ms in all four states** — the sim stays on the main thread, and the open question from the design doc closes as *answered*, not deferred. Write that in the commit body and in this document's findings section.
- **Over 8 ms in any state** — identify which half. If it is `pass`, the sim moving to a worker becomes milestone 5's first task, and the reason is recorded here with its number. If it is draw, it is a renderer problem and belongs to this milestone; fix it here.

**Step 3: Crop growth, only if the numbers say so**

`growCrops` walks all 1024 tiles every tick. This was recorded during milestone 1 as a milestone-4 concern, and milestone 3's handoff repeated it. It is also, on paper, about 20,000 trivial operations a second — plausibly free. State 4 above is designed to expose it: a full field is the worst case.

If it shows up, the fix is an index, **not** a `plantedAt` refactor. A `private growing = new Set<number>()` of immature tile indices, added in `doPlant` and at generation, removed at maturity and on harvest, makes the loop proportional to growing crops instead of the map. Deriving growth from a `plantedAt` stamp — the shape recorded earlier — would change `Crop`'s public shape, and three existing tests assign `tile.crop = { item, growth }` directly. Those tests are unedited by Decision 4, so the index is the only version of this optimisation that is allowed, and it is the cheaper one anyway.

The invariant it introduces must be written down where it can be found: **a crop assigned directly to `tile.crop` does not grow.** Only `doPlant` and generation register one. Every test that assigns directly is asserting about an already-mature or deliberately-static crop, so this is sound today — and a comment on the `growing` field is what keeps it sound tomorrow.

If the numbers say it is free, **do not do it**, and record the measurement that says so. An optimisation with no number behind it is a guess with extra steps.

### Results

Measured 2026-09-15 on the dev page, 32x32 world, seed 1. Rolling means over 120 frames.

| State | `pass` | scene update | GPU render | total |
|---|---|---|---|---|
| 1. Idle, no script, 1x | 0.001 ms | 0.040 ms | — | 0.04 ms |
| 2. Harvest loop, 1x | 0.061 ms | 0.483 ms | — | 0.54 ms |
| 3. Harvest loop, 4x | 0.111 ms | 0.458 ms | — | 0.57 ms |
| 4. Harvest loop, 4x, 169 crops | 0.170 ms | 0.652 ms | 0.89 ms mean / 0.41 ms median | **1.71 ms** |

**The sim stays on the main thread.** Worst case is 1.71 ms against an 8 ms
threshold and a 16.6 ms budget — a factor of nine of headroom. The design
document's open question "whether the sim runs on the main thread or its own
worker" is now **answered**, not deferred again.

**Crop growth is not optimised, and that is the finding.** `pass` at 4x with
every soil tile carrying an immature crop is 0.17 ms: `growCrops` walking all
1024 tiles is roughly 20,000 trivial operations a second and is nowhere near a
hot path. This concern was recorded during milestone 1, repeated in milestone
3's handoff, and has now been retired by a measurement rather than by code. It
should stay retired unless the world grows by an order of magnitude.

**One caveat on how these were taken.** The preview pane delivers no
`requestAnimationFrame` callbacks, which suspends Pixi's own ticker as well as
the game loop. `pass` and scene update are therefore measured by driving frames
deliberately, and the GPU render is measured by calling `renderer.render`
directly rather than by observing it happen. The frame *interval* column the
plan originally asked for is not measurable in this environment at all and is
omitted rather than faked.

**Step 4: Commit**

```bash
git add -A
git commit -m "perf(sim): measure the frame budget and answer where the sim runs"
```

---

### Task 9: Play it

Same shape as milestone 3's Task 11. Play the real page against seed 1, write down what is actually wrong, fix nothing.

**Step 1: Play**

Cold-start the page and play for twenty minutes without touching the source. Specifically:

- The opening two-line script. Does the world explain itself before the editor does?
- The naive infinite loop into the east wall. Time how long it takes to notice, by eye alone.
- The delivery run into the Research Console. Same.
- Harvest, deliver ten wheat, watch the planter research complete. Is the payout legible — and is it *obviously* uncollectable, or merely mysteriously so? Milestone 5 needs to know which.
- Queue a research and deliver nothing. The console should read as starved, not as broken. Time how long it takes to notice, by eye alone.
- Pause, step, 0.5x, 4x, and a window resize mid-run.
- Background the tab for thirty seconds and come back. Milestone 3's finding 6 says the world slows to ~8 ticks/sec in the background and the catch-up cap doubles as the background speed limit. With a renderer, does returning look like a jump, a fast-forward, or a freeze? Decide deliberately whether that is the behaviour to keep.

**Step 2: Record findings**

Append a `## Findings from Task 9` section to this document in milestone 3's style: numbered, each with what happened, why it matters, and what it costs. **Record, do not fix.** Carry the same caveat milestone 3 carried — these are mechanical findings from driving the real page, and the two numbers the design actually scores a build on, a beginner's time to first loop and a veteran's boredom threshold, still need human playtesters and are still not measured.

**Step 3: Commit**

```bash
git add docs/plans/2026-09-15-milestone-4-renderer.md
git commit -m "docs: milestone 4 playtest findings"
```

---

## Done criteria for milestone 4

- `npm test` passes, with milestones 1–3's **164 tests unedited**.
- `npm run typecheck` is clean.
- A PixiJS canvas draws terrain, crops, bots and machines from `world.snapshot()`, and **never mutates the world** — the renderer imports no mutating method.
- Bots slide between tiles at every speed, and land on tile centres when paused.
- Walking into a wall, walking into the console, and a research queued against an empty console are all three diagnosable from the canvas alone.
- Machines and items are drawn from tables keyed by `MachineKind` and `Item`, so milestone 5's mill, oven, flour and bread are rows rather than tasks.
- Crop growth is visible; a ripe tile and a young tile are distinguishable at a glance.
- Research progress is visible before it is collectable.
- Hovering any tile describes it; clicking a bot selects it.
- The text readout is gone, with every line it carried accounted for.
- The frame budget is measured in four states, and "where does the sim run" is answered with a number rather than deferred again.

## What milestone 5 will build on this

Milestone 5 is **the hands phase and the first production chain**, together, because they are the same milestone: a chain you cannot place is a chain you cannot play.

### The hands phase, finally

Finding 1 from milestone 3 has now waited two milestones: `placeMachine`, `installModule` and `deployBot` exist on `World` and are reachable from nothing. Milestone 5 owns them, and it inherits exactly what it needs from this one — `toTile` for picking a destination, the machine registry for showing the result, the inspector for confirming it, and a selection model for choosing which bot gets the module. Placement becomes click-a-tile instead of a coordinate form, which is the entire reason this milestone went first.

### Wheat → flour → bread

The project's pitch is a Factorio mashup and the sim currently has **one item, no recipes, and no machine that transforms anything**. That is the largest undesigned thing in the project, and it is now decided: the first chain is wheat → flour → bread.

- **Mill** consumes wheat over N ticks and emits flour. **Oven** consumes flour over N ticks and emits bread.
- **Research costs move to bread.** This is the load-bearing decision. A chain that feeds an optional score is a side quest; a chain the research console eats makes every later unlock depend on throughput, which is what makes it Factorio rather than decoration. Milestone 5 rebalances `RESEARCH_COST` accordingly, and the early planter research stays payable in raw wheat so the first ten minutes are unchanged.
- **Bots are the transport, at first.** Deliberately no conveyors in milestone 5. Hauling wheat to the mill, flour to the oven, bread to the console by hand is precisely the cycle-2 tedium the design's abstraction-rhythm table wants a hauling script to be born from — and milestone 3's finding 5 observed that this pain currently lasts only a few seconds, which is too short to motivate anything. A three-stop chain is what makes it last.
- **Conveyors are milestone 6**, and land as the answer to the pain milestone 5 creates, which is the order the design's table prescribes.

This milestone hands it four things: an item palette keyed by `Item`, a machine registry keyed by `MachineKind`, a tick layer whose crop pool is the prototype for ground items, and a `starved` event the mill and oven emit unchanged.

### Three more things it will want, deliberately not built here

- **`colony.research.state()`** — milestone 3's finding 4. A script still cannot observe research and still has to `bot.wait(15)` on a guess. Task 7 gives the *player* that information; giving the *script* it is an API change, and API changes belong with the milestone that closes the research loop. A chain makes it sharper still: a hauling script needs to ask what the mill is holding.
- **A second script pane.** One bot needs one editor. The chassis research grants a second bot, and the moment it exists the editor needs to know which bot it is editing. This milestone's selection model is the seam that will carry it.
- **Save/load.** A save is seed, scripts and tick count, per the design. Everything needed for it is already JSON-safe; nothing has needed it yet.
