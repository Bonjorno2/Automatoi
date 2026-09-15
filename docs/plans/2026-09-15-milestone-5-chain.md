# Milestone 5: The Chain You Can Place

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wheat goes into a mill you placed by clicking a tile, flour comes out, a bot carries it to an oven you also placed, and the bread that comes out is what the second bot costs. The research reward becomes collectable for the first time, and the game becomes a mashup rather than a promise of one.

**Architecture:** Two halves that only work together. The **chain** is sim work: items beyond wheat, machines that convert over time, capacity that can jam, research denominated in things you had to make. The **hands phase** is UI work on milestone 4's canvas: click a tile to place, click a bot to fit a module, click a spare chassis into the world. Milestone 4's renderer was built table-first precisely so the mill, the oven, flour and bread are rows rather than tasks.

**Tech Stack:** Unchanged. No new dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — "The abstraction rhythm" (this is cycle 2 becoming real), "Research tree as hardware", "Failure is content". **Milestone 4 reference:** `docs/plans/2026-09-15-milestone-4-renderer.md`, its Decision 7 and its findings 1, 5 and 6, all three of which this milestone closes.

---

## Decisions already made

1. **The chain is wheat → flour → bread**, chosen over an ore branch and over seed multiplication. It stays inside the farm fiction, it needs only two new machines, and both are single-input so nothing here has to solve multi-ingredient recipes yet.

2. **Research costs move to bread, and that is what makes this Factorio.** A chain feeding an optional score is a side quest. The second bot — the thing the veteran playtest is meant to time — is priced in bread, so reaching it *requires* running the chain. The first three researches stay priced in raw wheat, so the opening ten minutes are untouched.

3. **Bots are the transport. No conveyors.** Hauling wheat to the mill, flour to the oven and bread to the console by hand is exactly the cycle-2 tedium the design wants a hauling script to be born from. Milestone 3's finding 5 observed that this pain currently lasts a few seconds; a three-stop chain is what makes it last long enough to motivate anything. Conveyors are milestone 6 and land as the answer to the pain this milestone creates.

4. **Machines have capacity, and a full machine jams.** This is not decoration: it gives the design's "conveyor jammed, crate full" failure row something to be true about, it gives milestone 4's finding 5 a real number to replace its invented `CRATE_DISPLAY_FULL`, and it is the first time in this game that a player can build something that stops working for a reason that is their own layout's fault.

5. **No power, no fuel, no multi-input recipes.** Each is a whole system and none is needed to prove the chain. A recipe is one input stack, one output stack, a duration.

6. **Tests may change, but only where a deliberate rule change makes them wrong, and every such edit is named below before it is made.** Milestone 4's blanket freeze was right for a milestone that was additive by nature. This one changes rules on purpose. The rule that replaces the freeze: an edit is legitimate when the test asserts an economic fact this milestone deliberately changed, and illegitimate when it asserts a mechanic that still holds. If a test about *mechanics* needs editing, the change is wrong.

   **Planned edit 1:** `tests/sim/research.test.ts`'s `fundedWorld` helper stocks the console with wheat, and two of its cases complete `chassis`, which this milestone reprices in bread. The helper will stock every item instead. That test's subject is queue order and grant behaviour, not economics, and making it indifferent to price is what keeps it about its subject.

   **Planned edit 2, added during Task 2 rather than foreseen:** `tests/render/palette.test.ts` asserts that *every* `Item` has a young and a ripe colour. That was true when the only item was a crop and is now false — flour has no ripeness. The palette's crop table is renamed `CROP` and made partial, and a separate `ITEM_COLOR` covers all three items. The test is edited to assert the thing that is now true: every item has a colour, and every *plantable* item has a ripeness.

---

## Two facts to verify before building on them

### Fact 1: machine capacity does not break existing transfers (verify in Task 3)

`doDeposit` currently caps a transfer by what the bot is carrying and nothing else. Adding "and by the room left in the machine" changes a function with existing tests in `tests/sim/transfer.test.ts`. Those tests deposit small amounts into an empty console, so they should be unaffected — but "should be" is why this is a verification step and not a sentence. Run that file first, before and after.

### Fact 2: a new `Item` member does not silently break the renderer (verify in Task 5)

Milestone 4's Decision 7 claims flour and bread are table rows the compiler will demand. Task 5 tests that claim the cheap way: add the union members *first*, run `npm run typecheck`, and confirm the compiler names every table that needs a row. **If it compiles clean, Decision 7 failed** and something is keyed by a loose string or a default rather than by the union.

> **Result, measured in Task 2 (earlier than planned, because adding the union members is the whole experiment).** One error, naming `palette.ITEM` and both missing rows. Decision 7 held.
>
> It also found the decision's limit, which is worth more than the confirmation. The compiler said nothing about `doPlant(item: Item)` accepting flour, because plantability was a bare `WHEAT_GROWTH_TICKS` constant rather than a table — there was nothing keyed by `Item` for it to demand a row of. **A table is only load-bearing where one already exists.** Task 2 turns that constant into `CROP_GROWTH`, which is the table that would have caught it.

---

## Conventions for every task

- Sim work in `src/sim/`, renderer in `src/render/`, page wiring in `src/editor/`.
- `npm run typecheck` and `npm test` before every commit.
- `npm run generate:dts` whenever `src/sim/types.ts` or `src/bridge/api.ts` changes. Its test will tell you; do not wait for it to.
- Commit after each task with the message given.
- Balance numbers are guesses until Task 9 measures them. Put them in `config.ts` where they can be changed in one place, never inline.

## Domain vocabulary

- **Recipe.** One input stack, one output stack, a duration in ticks. A property of a machine *kind*, not of a machine.
- **Conversion.** One run of a recipe by one machine. Starts when the inputs are consumed, not when they arrive.
- **Jam.** A machine that has finished a conversion and cannot store the output. The mirror of starved.
- **Stock.** What research has produced and nobody has installed: spare modules, spare chassis.

---

### Task 1: The research reward becomes visible

Milestone 4's finding 1, and the smallest task here. It goes first because everything else in this milestone hands the player something, and until the panel says what they have, none of it is discoverable.

**Files:** modify `src/render/hud.ts`, `index.html`; test `tests/render/hud.test.ts`

Add `stockLines(snapshot): string[]` beside `researchLines`, listing `spareModules` and `spareChassis`, with an empty list when there is nothing. Render below the research queue, visually distinct — stock is a thing you can *act on*, and in the next tasks it becomes exactly that.

Tests: nothing stocked gives no lines; a completed planter research gives one line naming the module; two spare modules and a chassis give three lines; installing a module removes its line.

```bash
git commit -m "feat(render): research stock on the panel, so a finished research is discoverable"
```

---

### Task 2: Items that are not wheat

**Files:** modify `src/sim/types.ts`, `src/sim/config.ts`, `src/sim/world.ts`; test `tests/sim/items.test.ts`

`Item` becomes `"wheat" | "flour" | "bread"`. One rule follows immediately and it is the only one: **not every item is plantable.** `doPlant` currently takes any `Item`.

```ts
/** Ticks to maturity, per item. An item absent here cannot be planted at all. */
export const CROP_GROWTH: Partial<Record<Item, number>> = { wheat: 30 };
/** Kept as a named export: three existing test files import it. */
export const WHEAT_GROWTH_TICKS = 30;
```

`doPlant` refuses an item with no growth entry, and emits the `refused` event it already emits for every other refusal. `doHarvest` reads maturity from the same table.

Tests: planting flour is refused and costs no inventory; planting wheat is unchanged; a harvested wheat tile still yields wheat; `WHEAT_GROWTH_TICKS` still equals `CROP_GROWTH.wheat`, so the existing suites are asserting the same number they always were.

```bash
git commit -m "feat(sim): flour and bread exist, and only wheat can be planted"
```

---

### Task 3: Machines that convert

The heart of the milestone.

**Files:** modify `src/sim/types.ts`, `src/sim/config.ts`, `src/sim/world.ts`, `src/sim/events.ts`; test `tests/sim/recipes.test.ts`

**Step 1: Verify Fact 1.** Run `tests/sim/transfer.test.ts` and record that it is green before touching anything.

**Step 2: Recipes and capacity in config.**

```ts
export interface Recipe { input: Partial<Record<Item, number>>; output: Partial<Record<Item, number>>; ticks: number; }

export const RECIPE: Partial<Record<MachineKind, Recipe>> = {
  mill: { input: { wheat: 3 }, output: { flour: 1 }, ticks: 20 },
  oven: { input: { flour: 2 }, output: { bread: 1 }, ticks: 30 },
};

/** Items a machine can hold. A machine at capacity refuses deposits and jams. */
export const MACHINE_CAPACITY = 20;
```

One bread is therefore six wheat and seventy ticks of machine time. That is a guess; Task 9 measures whether it is a good one.

**Step 3: The conversion step.** `Machine` gains `progress: number`. A new `advanceMachines()` in `tick()`, before `advanceResearch()`:

- Not converting, inputs present, room for output: consume inputs, `progress = 1`.
- Not converting, inputs absent: `starved`, on the edge only, reusing the event Task 5 of milestone 4 already built and the console already uses.
- Not converting, inputs present but no room for output: `jammed`, on the edge only.
- Converting: `progress++`; at `recipe.ticks`, add outputs and reset.

Room is checked **before** consuming, not after converting. A machine that eats its input and then discovers it cannot store the result has destroyed the input, and a player watching wheat vanish into a full mill would be right to call it a bug.

**Step 4: Deposit respects capacity.** `doDeposit` caps by machine room as well as bot inventory, and `withdraw` is unchanged. Re-run `tests/sim/transfer.test.ts`: still green, or Fact 1 was wrong and the cap is in the wrong place.

Tests: a mill with three wheat produces one flour after exactly twenty ticks; with two wheat it produces nothing and emits `starved` once; a full mill emits `jammed` once, not once per tick, and stops once emptied; inputs are consumed at the start and outputs appear at the end, never both; an oven converts flour to bread; a machine with no recipe (console, crate) is untouched by `advanceMachines`; depositing into a full crate transfers a partial amount and refuses the rest; determinism still holds.

```bash
git commit -m "feat(sim): mills and ovens that convert over time, and jam when full"
```

---

### Task 4: Research priced in what you made

**Files:** modify `src/sim/config.ts`, `src/sim/types.ts`, `src/sim/world.ts`; test `tests/sim/research.test.ts` (**the one planned edit**), `tests/sim/research-cost.test.ts`

`ResearchName` gains `"mill"` and `"oven"`. Cost keeps its existing shape — a count — and gains a sibling naming the item, which is what lets every existing test keep reading `RESEARCH_COST.planter` as the number it always was:

```ts
export const RESEARCH_COST: Record<ResearchName, number> = {
  planter: 10, scanner: 10, crate: 15, mill: 20, oven: 25, chassis: 6, radio: 4,
};
/** What the console eats for each. Absent means wheat. */
export const RESEARCH_ITEM: Partial<Record<ResearchName, Item>> = {
  chassis: "bread", radio: "bread",
};
```

`advanceResearch` consumes `RESEARCH_ITEM[name] ?? "wheat"`. The `starved` event already fires when the console cannot pay; now it can fire because the console is full of wheat and the research wants bread, which is a much more interesting way to be stuck and is exactly the Factorio lesson.

Edit `fundedWorld` in `tests/sim/research.test.ts` to stock every item rather than only wheat, per Decision 6.

Tests (new file): the planter still costs ten wheat; chassis consumes bread and ignores wheat; a console holding only wheat starves a bread research; `grant` for mill and oven unlocks placement and stocks nothing, matching `crate`.

```bash
git commit -m "feat(sim): the second bot is priced in bread, so the chain is load-bearing"
```

---

### Task 5: The renderer grows four rows

**Files:** modify `src/render/palette.ts`, `src/render/actors.ts`, `src/render/marks.ts`, `src/render/inspector.ts`; test `tests/render/palette.test.ts`

**Step 1: Verify Fact 2.** Add the union members, run `npm run typecheck`, and write down every error. Each should be a table demanding a row. If there are none, Decision 7 of milestone 4 did not hold and the gap must be found before anything is drawn.

**Step 2: Fill the rows.** Colours for flour and bread; `MACHINE_STYLE` rows for mill and oven, both using the progress-arc helper the console already uses, driven by `progress / recipe.ticks`. A `jammed` mark, mirroring `starved`: same shape, different colour, because they are opposites and should read as a pair.

Crop colours split from item colours here: flour is never a crop, and a `Record<Item, {young, ripe}>` would force a ripeness for bread.

**Manual check:** a mill mid-conversion, a jammed oven and a starved mill are distinguishable from each other and from a working machine, at the tile size the three-column layout actually gives.

```bash
git commit -m "feat(render): mill, oven, flour and bread as table rows"
```

---

### Task 6: Placing things

The hands phase, finally. Milestone 3's finding 1 has waited three milestones.

**Files:** add `src/editor/build-menu.ts`; modify `src/render/inspector.ts`, `src/editor/main.ts`, `index.html`; test `tests/editor/build-menu.test.ts`

A palette of what research has unlocked and the player has not yet placed. Pick one, and the canvas enters placing mode: the hovered tile shows a ghost, green where `placeMachine` would succeed and red where it would not. Click places. Escape or right-click cancels.

The validity test must call the same predicate the sim uses, not a copy of it. Extract `World.canPlace(kind, pos): string | null` returning the reason it cannot, have `placeMachine` throw that same string, and let the ghost colour and the tooltip both read it. A renderer that decides for itself where a machine fits is the drift Decision 7 exists to prevent, one level up.

Tests (pure): `canPlace` refuses out of bounds, an occupied tile, a bot's tile, an unresearched kind, and a second console; it accepts plain soil and plain grass; the reason string is the one `placeMachine` throws.

**Manual check:** place a crate; place a mill; try to place on the console and see the ghost go red with a reason.

```bash
git commit -m "feat(editor): click a tile to place what research unlocked"
```

---

### Task 7: Fitting modules, and the second bot

**Files:** modify `src/editor/build-menu.ts`, `src/render/hud.ts`, `src/editor/main.ts`; test `tests/sim/install.test.ts`

Stock from Task 1 becomes clickable. A spare module + a selected bot installs it. A spare chassis enters placing mode like a machine, and clicking a free tile deploys the second bot there.

The failure cases are the interesting part and each needs a message rather than a thrown error: no bot selected, the bot already has that module, the tile is occupied.

Tests: installing adds the module and decrements the stock; installing twice fails and decrements nothing; `deployBot` consumes the chassis; a deployed bot starts with a harvester and an id that is not 1.

**Manual check:** research the planter, fit it to bot 1, and watch `bot.planter` start working in a script that previously threw. **This is the moment the research loop closes for the first time in the project's history.**

```bash
git commit -m "feat(editor): fit modules to bots and put the second chassis in the world"
```

---

### Task 8: A script per bot

**Files:** modify `src/editor/session.ts`, `src/editor/main.ts`, `index.html`; test `tests/editor/scripts.test.ts`

The moment a second bot exists, one editor pane is wrong. Selection already exists; this makes it mean something. Each bot owns a source string; selecting a bot swaps the editor's contents; Run and Ctrl+S act on the selected bot only, which milestone 2's per-bot channels already support.

A bot with no script yet gets the opening two-line script, not an empty buffer.

Tests: switching bots preserves each one's edits; running bot 2 leaves bot 1's script running; a new bot's default source is the opening script.

```bash
git commit -m "feat(editor): one script per bot, switched by selection"
```

---

### Task 9: Balance

**Files:** add `tests/bridge/chain.test.ts`; modify `src/sim/config.ts` if the numbers are wrong

A reference script that harvests, mills, bakes and delivers, run headless through the real bridge exactly as `tests/bridge/first-research.test.ts` does for the first research. Assert the second bot is reachable inside a tick budget, and pin that budget.

Then read the number as a designer rather than an engineer. If bread takes so long that the hauling is tedium without a lesson, the recipe is wrong, not the player. Record the measured ticks-to-second-bot in the commit body; it is the number milestone 6's conveyors will be judged against.

```bash
git commit -m "test(bridge): the chain reaches the second bot inside a pinned tick budget"
```

---

### Task 10: Play it

Same discipline as milestones 3 and 4: play, record, fix nothing.

Specifically: does placing feel like a hands phase or like a form? Does the first jam teach anything? Is hauling three stops by hand annoying in the way that makes a player want to write a hauling script, or in the way that makes them stop playing? That last question is the whole milestone and the plan cannot answer it.

Append `## Findings from Task 10` in the style of milestones 3 and 4, with the same caveat about who played it.

```bash
git commit -m "docs: milestone 5 playtest findings"
```

---

## Done criteria for milestone 5

- `npm test` and `npm run typecheck` clean, with **one** named test edit and no others.
- Wheat becomes flour becomes bread, in machines the player placed by clicking.
- A machine that cannot work says which way it is stuck: starved or jammed.
- Research stock is visible, and clicking it installs or places.
- The second bot exists, is priced in bread, and has its own script.
- A headless test drives the whole chain to the second bot inside a pinned budget.
- Milestone 3's finding 1 and milestone 4's findings 1, 5 and 6 are closed.

## What milestone 6 will build on this

Conveyors, as the answer to the hauling pain this milestone deliberately creates. The design's cycle-3 row — "place conveyors and smelters by hand", automated by `place()` in code — needs the builder arm as well, which makes milestone 6 the first time the player's *script* changes the world's layout rather than just moving through it. `colony.research()` for script-observable research (milestone 3's finding 4) belongs there too, since a hauling script that reads demand is the thing that wants it.
