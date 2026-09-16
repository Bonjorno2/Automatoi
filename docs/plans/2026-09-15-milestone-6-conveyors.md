# Milestone 6: The Belt, and the Arm That Lays It

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The three-stop haul milestone 5 measured at roughly 2700 ticks stops being a bot's job. Wheat goes onto a belt, flour comes out of the mill onto another belt, bread arrives at the console, and none of it involves a bot walking. Then the builder arm makes the belt itself something a *script* lays, which is the first time in this project that player code changes the world's layout rather than moving through it.

**Architecture:** Three layers, in this order. The **belt** is sim work: a machine kind that faces a direction, holds a little, and hands what it holds to the tile in front of it on a fixed cadence. The **hands phase** is milestone 5's build menu with a rotation and a fix for the armed-mode confusion its own playtest found. The **arm** is bridge work: `bot.builder.place` and `bot.builder.remove`, plus the research status a script has been unable to read since milestone 3.

**Tech Stack:** Unchanged. No new dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — the abstraction rhythm's cycle 3 ("place conveyors and smelters by hand" / "`place()` in code, bots lay belts"), "Research tree as hardware", and the "Conveyor jammed, crate full" row of "Failure is content". **Milestone 5 reference:** `docs/plans/2026-09-15-milestone-5-chain.md`, whose findings 2, 3 and 6 this milestone closes and whose finding 5 it deliberately does not.

---

## Decisions already made

1. **A conveyor is a machine kind, not a new kind of entity.** It goes in `world.machines` beside the mill and the crate, and it gains one field: a facing. The alternative — a separate `belts` collection — would need its own copy of every rule that is already keyed by "there is a machine on this tile": movement blocking, `deposit`/`withdraw` adjacency, `canPlace`, the snapshot, the inspector. Those copies would drift. The price of this decision is that belts inherit rules nobody chose for them, which is why Fact 1 below walks every one of those rules before a belt is built.

2. **Belts block bots, because every machine does.** A belt line across the field is a wall, and a player who rings themselves in has built a cage. This is kept rather than special-cased for three reasons: it is what makes layout a spatial puzzle with a cost rather than a decoration; walking into one is already legible, because milestone 4's `bump` event and mark fire for any machine; and the builder arm's `remove` is an escape hatch that arrives in the same milestone. **It is also the most likely thing in this plan to be wrong**, and Task 10 is instructed to look for it specifically: a bot that has fenced itself out of the field is a failure whose cause is a hundred ticks behind the symptom.

3. **The belt takes from behind and gives ahead. There are no inserters.** Factorio's answer to "how does a furnace get onto a belt" is a separate entity; ours is that the belt reaches. A conveyor gives one item to the tile it faces, and takes one item from the machine directly behind it. Two entities instead of three, one spatial fact (the facing) instead of two, and the whole chain becomes buildable out of one part.

4. **A belt takes what a machine makes, and never what it holds.** A belt behind a mill may take flour and may never take the mill's wheat, because wheat is the mill's input. A machine with no recipe makes nothing, so a belt behind a crate or behind the Research Console takes nothing at all. Without this rule the two nastiest emergent bugs in the design both appear on day one: a belt that quietly drains a mill's feedstock, and a belt that empties the console of the bread it was about to spend on research. One sentence, one predicate, and both are gone.

5. **Items on a belt are a count, not positions.** A conveyor holds up to `CAPACITY.conveyor` of an item in an ordinary `Inventory`, exactly as a crate does. Sub-tile item positions would buy a nicer animation and cost a second representation of where everything is, plus every test becoming about geometry. What is lost is the sight of an item sliding along; what replaces it is a pip per item on the tile, which is enough to see a belt is moving and enough to see one that has backed up.

6. **Every belt steps at the same instant, and the step is computed from the world as it was before the step.** The classic belt bug is an item crossing five tiles in one tick because the loop happened to visit the belts downstream-first. Two phases over a pre-step copy make travel time a property of the line's length rather than of the order the player placed it in, which is Fact 2 below and the only thing in this milestone worth calling an algorithm.

7. **Milestone 5's finding 5 — machines are free and unlimited — is deliberately not fixed here, and this is a change of mind worth recording.** A build cost needs something to be denominated in, and every item in this game is food. Belts priced in bread would mean a player choosing between a conveyor and a second bot on a scale where the units are identical, which teaches nothing about layout. The honest prerequisite is a non-food material, which is a whole branch and belongs with the ore line. What this milestone *does* add is a time cost: `bot.builder.place` takes ticks, so a hundred-tile belt run costs a script real simulated time. That is a cost, but it is not the cost finding 5 is about, and calling it one would be dishonest.

8. **`colony.research.status()` is a free read, and answers milestone 3's finding 4.** A script has been able to queue research since milestone 2 and unable to ask about it ever since, which is why `tests/bridge/first-research.test.ts` waits on a hand-computed guess. A hauling script that decides what to make next is exactly the thing that needs to read it, and this is the milestone where such a script becomes writable.

9. **Tests may change, and every edit is named below before it is made.** Milestone 5's rule carries forward unchanged: an edit is legitimate when a test asserts something this milestone deliberately changed, and illegitimate when it asserts a mechanic that still holds.

   **Planned edit 1:** `tests/render/palette.test.ts` asserts `Object.keys(MACHINE).sort()` is exactly `["console", "crate", "mill", "oven"]` and `Object.keys(MODULE).sort()` is exactly the four current modules. Both gain a member. Milestone 5 already recorded that these assertions break every time a union grows and catch nothing the `Record` type does not catch at compile time; they survive because they check the values are usable colours, which a type cannot.

   **No other edit is foreseen.** Three near misses were checked while writing this and are expected to stay green: `tests/editor/build-menu.test.ts` never unlocks a conveyor, so the new `PLACEABLE` row does not appear in it; `tests/sim/snapshot.test.ts` reads fields off a machine snapshot rather than asserting its shape, so the new `dir` field does not break it; and `tests/render/inspector.test.ts` builds its jam case on a mill, whose capacity this milestone leaves at 16. If any of the three does break, that is information about this plan being wrong, not licence to edit it.

---

## Two facts to verify before building on them

### Fact 1: a belt inherits every rule already keyed by "machine" (verify in Task 3)

Decision 1 buys reuse and pays for it by inheritance. Before adding the union member, list every place in `src/` that asks whether a tile holds a machine or branches on `MachineKind`, and write down the answer a conveyor needs from each. The list as it stands:

| Site | What a belt needs |
|---|---|
| `doMove` in `world.ts` | Blocks the bot. Wanted, per Decision 2. |
| `doDeposit` / `doWithdraw` | Work on a belt like any machine. Wanted: this is how a bot loads one. |
| `advanceMachines` | Skips it. A belt has no recipe, so this is already true. |
| `canPlace` / `tileBlocked` | Unchanged — one console, researched kinds only, empty tile. |
| `World.console()` | Finds the console by kind. Unaffected. |
| `MACHINE_LABEL` in `inspector.ts` | A row, demanded by the compiler. |
| The crate's fill bar in `actors.ts` | Reads `MACHINE_CAPACITY` directly. **Wrong once capacity is per kind**, and the reason Task 3 introduces `CAPACITY`. |
| `snapshot()` | Carries the new `dir` outward. |

Verify the list is complete with `rg "machineAt|MachineKind|machines\." src/` before Task 3's first line, and record anything the table missed. A site found afterwards is a rule nobody chose.

### Fact 2: a belt line's travel time does not depend on the order it was built (verify in Task 4)

Build the same five-tile line twice — once placing the belts from the loading end forward, once from the delivering end backward — and assert an item takes the same number of ticks to arrive. The two worlds differ only in machine ids, so if the arrival ticks differ, the step is reading state it has already modified and Decision 6 is not implemented. **This test is the algorithm's whole proof and should be written before the step that satisfies it.**

---

## Conventions for every task

- Sim work in `src/sim/`, renderer in `src/render/`, page wiring in `src/editor/`, worker-facing API in `src/bridge/`.
- `npm run typecheck` and `npm test` before every commit.
- `npm run generate:dts` whenever `src/sim/types.ts` or `src/bridge/api.ts` changes. Its test will tell you; do not wait for it to.
- Commit after each task with the message given.
- Balance numbers are guesses until Task 9 measures them. Put them in `config.ts`, never inline.

## Domain vocabulary

- **Facing.** The direction a conveyor hands items to. Fixed when it is placed; changing it means removing and placing again.
- **Behind.** The tile opposite a conveyor's facing. Where it takes from.
- **Step.** One belt movement, every `CONVEYOR_TICKS` ticks, for every belt in the world at once.
- **Line.** Belts arranged so each faces the next. Not a data structure — it is only ever a pattern in where things were placed.

---

### Task 1: The field says how much is left

Milestone 5's finding 3, and first because everything else in this milestone makes the cliff arrive sooner. Belts do not grow wheat; they only spend it faster.

**Files:** modify `src/render/hud.ts`, `index.html`; test `tests/render/hud.test.ts`

A line on the side panel counting standing wheat — mature crops in the world, which is what a player can actually go and harvest. Nothing else changes: this is a read-out, not a fix. The fix is the planter and a script that replants, and the design is right that running out is what teaches that. A finite resource with no read-out is not a lesson, it is a surprise.

Count from the snapshot's tiles, so it cannot disagree with what is drawn.

Tests: a fresh world reports the seed's wild wheat; harvesting one decrements it; a planted-but-unripe tile is not counted; a fully harvested field reads zero rather than vanishing.

```bash
git commit -m "feat(render): the panel counts the wheat still standing in the field"
```

---

### Task 2: Telling two bots apart

Milestone 4's finding 6, re-recorded as milestone 5's finding 6, deferred twice. This is not the design's Overseer and does not pretend to be — it is the cheap half, and deferring the cheap half a third time while adding a system that makes the world busier is not defensible.

**Files:** modify `src/render/palette.ts`, `src/render/actors.ts`; test `tests/render/palette.test.ts`

A small table of bot body colours, indexed by bot id, and the id drawn on the chassis. The selection ring stays as it is — it answers "which one am I editing", not "which one is that".

The sprite key in `syncBots` already includes everything the body is drawn from; add whatever this introduces to it, or a bot will keep its first colour forever.

Tests: two bots get two colours; a third does not collide with either; the table wraps rather than running out for a fleet larger than it.

```bash
git commit -m "feat(render): bots carry a colour and a number, so two of them are two things"
```

---

### Task 3: Conveyors exist, and hold a little

**Files:** modify `src/sim/types.ts`, `src/sim/config.ts`, `src/sim/world.ts`, `src/render/inspector.ts`, `src/render/actors.ts`; test `tests/sim/conveyor.test.ts`

**Step 1: Verify Fact 1.** Walk the table above, run the `rg`, and write down anything it missed before writing code.

**Step 2: The kind, the facing and the capacity.**

```ts
/** A machine kind absent from this table has no facing and ignores the one passed. */
export const FACES: Partial<Record<MachineKind, true>> = { conveyor: true };

/** Items of each type a machine holds. Absent means MACHINE_CAPACITY. */
export const CAPACITY: Partial<Record<MachineKind, number>> = { conveyor: 4 };

/** Ticks between belt steps. A guess; Task 9 measures it. */
export const CONVEYOR_TICKS = 4;
```

`Machine` gains `dir: Direction | null`, `MachineSnapshot` carries it, and `placeMachine(kind, pos, facing?)` sets it only for a kind in `FACES`. `RESEARCH_COST` and `RESEARCH_ITEM` gain `conveyor`, priced in bread: a belt is a thing the chain buys, and pricing it in wheat would let a player skip the chain to automate the chain.

Every reader of `MACHINE_CAPACITY` moves to a `capacityOf(kind)` helper — `hasRoomFor`, `doDeposit`, and the crate fill bar in `actors.ts` that Fact 1 flagged. `MACHINE_CAPACITY` stays exported as the default, the way `WHEAT_GROWTH_TICKS` survived `CROP_GROWTH`.

Nothing moves yet. A belt placed in this task is a four-item crate with an arrow.

Tests: a placed belt records its facing; a crate ignores a facing and stores null; a belt accepts four wheat and refuses the fifth while a crate takes sixteen; `deposit` onto a full belt transfers a partial amount, matching existing machine behaviour; the console and mill capacities are unchanged.

```bash
git commit -m "feat(sim): conveyors are machines that face a direction and hold four"
```

---

### Task 4: Belts move

The heart of the milestone.

**Files:** modify `src/sim/world.ts`; test `tests/sim/conveyor.test.ts`

**Step 1: Write Fact 2's test first.** The same line built in both orders, asserting equal arrival ticks. It should fail for the right reason before the step exists at all.

**Step 2: The step.** `advanceConveyors()` in `tick()`, after `advanceMachines()` so a machine's fresh output waits one step before being taken — either order is deterministic, and this one keeps "produced" and "collected" from happening in the same tick where a player cannot see them as two events. It runs only when `time % CONVEYOR_TICKS === 0`, so every belt in the world steps together.

Two phases, both reading a copy of the inventories taken before either runs:

- **Give.** Every conveyor holding something offers one item to the tile it faces. The target may be another conveyor with room, or any machine with room. A belt facing an empty tile, a bot, the world's edge, or a full neighbour simply keeps its item. **Nothing is ever destroyed** — an item on a belt that goes nowhere stays on the belt, and a test says so.
- **Take.** Every conveyor with room takes one item from the machine behind it, restricted to that machine's recipe outputs, per Decision 4.

Gives are applied in machine-id order against a running ledger of remaining room, so two belts feeding one target cannot both fit into the last slot and the loser is decided the same way every run. Belts facing each other pass an item back and forth forever; that is legible, harmless, and left alone.

Tests: an item crosses a five-tile line in exactly five steps; the same line built backwards behaves identically (Fact 2); a saturated line drains from the front, one tile per step; a belt facing a full mill holds its cargo; a belt behind a mill takes flour and never wheat; a belt behind a crate or a console takes nothing; a belt facing the world's edge keeps its item forever; two belts merging into one never exceed its capacity; `world.tick()` remains deterministic across two identical worlds.

```bash
git commit -m "feat(sim): belts step together and carry one tile at a time"
```

---

### Task 5: Belts on the canvas

**Files:** modify `src/render/palette.ts`, `src/render/actors.ts`, `src/render/inspector.ts`; test `tests/render/palette.test.ts`, `tests/render/inspector.test.ts`

A `MACHINE_STYLE` row for the conveyor: a flat plate with an arrow in its facing, drawn in the sprite's `body`, which is safe because a facing never changes after placement — if rotation in place is ever added, that cache must key on `dir`, and this sentence is the warning. The cargo goes in the `overlay`, whose key already includes the machine's item total, as pips coloured by `ITEM_COLOR`.

Belts must read as *under* everything: they are floor, and the machine container already draws below bots.

`describeTile` gains the facing — "Conveyor — facing south" — because Decision 3 makes a belt's direction the only thing a player can get wrong about it, and a belt pointed into a mill instead of away from it looks identical to one that works.

**Manual check:** the four-belt U it takes to get flour from the mill's south face to the oven's south face is readable as a route at the tile size the three-column layout gives, and a backed-up belt is distinguishable from an empty one.

```bash
git commit -m "feat(render): belts, their arrows, and the cargo on them"
```

---

### Task 6: Placing a belt, and knowing that you are placing

Milestone 5's finding 2, in the task that makes it worse — belts are the first thing a player places twenty of, and the first thing whose placement has a second parameter.

**Files:** modify `src/editor/build-menu.ts`, `src/render/inspector.ts`, `src/editor/main.ts`, `index.html`; test `tests/editor/build-menu.test.ts`, `tests/render/inspector.test.ts`

`PLACEABLE` gains a conveyor row. `Placement` gains a rotation: `R` cycles the facing, the ghost draws the arrow it would place, and the label says which way it points. Staying armed after a click is kept — that is what makes laying a line bearable — and the two halves of finding 2 are fixed instead:

- The status line says what is armed and how to stop: `placing Conveyor (facing north) — R to turn, Esc to stop`. The armed state currently exists only in the tooltip's wording, which is why "armed" and "inspecting" were indistinguishable.
- While armed over an occupied tile, the tooltip shows the placement line *and* what is already there, rather than replacing one with the other. Hovering the mill you just placed should tell you about the mill.

Compose those lines in a pure function beside `describeTile` so the second point is a test rather than a screenshot.

Tests: a fully unlocked world offers the conveyor in research order; rotation cycles four ways and returns; the armed tooltip over a mill names both the placement and the mill; the armed tooltip over empty ground is unchanged.

**Manual check:** lay an L of six belts without re-picking, turning the corner with `R`.

```bash
git commit -m "feat(editor): lay belts by hand, turn them with R, and see what is under the ghost"
```

---

### Task 7: The builder arm

**Files:** modify `src/sim/types.ts`, `src/sim/config.ts`, `src/sim/world.ts`; test `tests/sim/builder.test.ts`

`ModuleName` gains `"builder"`; `ResearchName` gains `"builder"`, priced in bread and granting a spare module like the planter. Two commands, both with a tick cost, both operating on an adjacent tile the way `deposit` does:

```ts
| { kind: "place"; machine: MachineKind; dir: Direction; facing?: Direction }
| { kind: "remove"; dir: Direction }
```

`facing` defaults to `dir`, which makes the natural loop — place a belt north, move north, repeat — lay a line that points the way the bot is walking.

`doPlace` calls `canPlace`, the same predicate the ghost and the menu already call. There must not be a second copy of where a machine fits; this is the rule Decision 7 of the milestone 4 plan exists to enforce, and the builder arm is its third caller.

`doRemove` refuses a machine that is holding anything, and refuses the console. Refusing a non-empty machine is what keeps this milestone from being the one where items can be deleted — there is no ground to spill onto, and silently destroying a full crate is the worst thing in this plan that could be written by accident.

Tests: placing puts a machine on the named tile with the default facing; an explicit facing overrides it; placing where `canPlace` refuses returns the sim's own reason and builds nothing; placing without the module fails with the module message `issue` already produces; removing an empty belt clears the tile and lets a bot walk there; removing a mill holding flour is refused; removing the console is refused; a removed machine leaves no sprite behind, which the renderer already handles by destroying unseen sprites.

```bash
git commit -m "feat(sim): the builder arm places and removes machines"
```

---

### Task 8: The API a builder script needs

**Files:** modify `src/bridge/api.ts`, `src/bridge/protocol.ts`, `src/bridge/colony.ts`, `src/editor/snippets.ts`; regenerate `src/editor/generated/player-api.d.ts`; test `tests/bridge/api.test.ts`, `tests/bridge/free-reads.test.ts`, `tests/editor/snippets.test.ts`

```ts
builder?: {
  place(machine: MachineKind, dir: Direction, facing?: Direction): boolean;
  remove(dir: Direction): boolean;
};
```

Optional in the type and present at runtime, per the asymmetry `api.ts` already documents at length. Do not reinvent that argument; it is settled.

`colony.research.status()` returns `{ unlocked, queue, progress, cost }` — `cost` included so a script can compute a fraction without importing `config.ts`, which it cannot. It goes in as a new `HostRequest` member rather than as a shape change to the existing `{ kind: "research"; name }`, which keeps every current bridge test untouched. Like `colony.time()`, it answers immediately and costs no ticks.

Add a snippet: laying a belt line with the builder arm, which the snippet test compiles against the shipped `.d.ts` and runs.

Tests: `place` and `remove` reach the sim and return its answers; calling them without the module gives the design's "Bot 1 has no Builder module"; `status()` reports a queued research's progress and does not advance time; the regenerated `.d.ts` matches what the generator produces.

```bash
git commit -m "feat(bridge): bot.builder, and a research status a script can read"
```

---

### Task 9: Does the belt earn its keep?

**Files:** add `tests/bridge/belts.test.ts`; modify `src/sim/config.ts` if the numbers are wrong

The milestone's entire argument, stated as a measurement: **automation must beat the hand-haul it replaces.** Milestone 5 pinned the baseline at about tick 2700 for six bread carried by one bot walking four stops. A script that lays a belt route and then only harvests and loads should reach the same six bread in materially less time, and if it does not, then belts are a worse version of what the player already had and the numbers in `config.ts` are wrong — not the player, and not the plan.

One reference script through the real bridge, exactly as `chain.test.ts` and `first-research.test.ts` do it: research the conveyor and the builder, fit the arm, lay the route, then loop on harvest-and-load. Assert a ceiling well under the hand-hauled figure, and record both numbers in the commit body.

Then read it as a designer. `CONVEYOR_TICKS = 4` is a belt moving at a quarter of a bot's walking speed and never resting or walking back; the ratio that matters is throughput over a full round, not speed over a tile. If a belt route is barely better, raise the cadence. If it is so much better that harvesting becomes the only thing left, that is not a problem — that is cycle 4 asking to exist.

```bash
git commit -m "test(bridge): the belt route beats the hand-hauled baseline by a pinned margin"
```

---

### Task 10: Play it

Same discipline as milestones 3, 4 and 5: play, record, fix nothing — unless what you find is a defect rather than a judgement, in which case fix it with a test and say so, the way milestone 5's finding 1 was handled.

Specifically, and in this order of interest:

- **Does a player fence themselves in?** Decision 2 is the most likely wrong thing here. Lay a route the natural way and see whether the bot can still reach the field, and whether the failure — if it happens — is comprehensible at the moment it happens or only afterwards.
- Does a belt pointed the wrong way announce itself, or does the player stand watching a mill that never fills?
- Is laying a line by hand tedious in the way that makes you want to write `layLine(10, "north")`, or tedious in the way that makes you stop? That is the same question milestone 5 asked about hauling, one level up, and it is the one this plan cannot answer.
- Does `colony.research.status()` change what a script looks like, or did it just remove a `wait`?

Append `## Findings from Task 10` in the style of milestones 3, 4 and 5, with the same caveat about who played it.

```bash
git commit -m "docs: milestone 6 playtest findings"
```

---

## Done criteria for milestone 6

- `npm test` and `npm run typecheck` clean, with the named edits to `tests/render/palette.test.ts` and no others.
- A belt carries an item one tile per step, and a five-tile line takes five steps whichever end it was built from.
- A belt takes flour from a mill and never takes its wheat, and never takes anything from a crate or the console.
- Wheat loaded onto a belt becomes bread in the console with no bot walking between the machines.
- `bot.builder.place` and `bot.builder.remove` work from a player script, and refuse through the same `canPlace` the ghost uses.
- `colony.research.status()` answers without costing a tick.
- A headless test shows a belt route beating milestone 5's hand-hauled baseline by a pinned margin.
- Milestone 5's findings 2, 3 and 6 are closed. Finding 5 is explicitly **not**, per Decision 7, and finding 4 — a machine holds 16 and a bot carries 10 — is left alone as measured-and-accepted.

## What milestone 7 will build on this

Two threads, and they meet.

The design's cycle 4 is blueprints: a player-authored `stamp(layout, at)` built on the `place()` this milestone ships, and the fabricator's `spawn(script)` so a stamped factory can come with the bot that runs it. That needs `import` between scripts, which the design deliberately holds back until one file per bot is genuinely miserable — and a fleet laying belt routes is where that starts.

The other thread is the ore branch, which is what finding 5 has been waiting for: a non-food material gives placement a price, and a price is what turns "where does the belt go" from a puzzle with free pieces into one with a budget. The Overseer fleet view belongs to whichever of those two arrives first, since both of them mean more bots doing more things in more places than one selection ring can explain.
