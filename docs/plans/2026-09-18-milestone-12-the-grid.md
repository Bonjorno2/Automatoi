# Milestone 12: The Grid

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Machines stop being free. A colony generates power from what it grows, carries it on runs of tuned lattice, and every machine on the map now depends on something the player has to build, route and keep working. The hands phase this creates is *where the power goes*, which is a spatial problem; the mind phase that answers it is a script that surveys the grid and keeps it healthy.

This is milestone 5's finding 5 — *machines are free and unlimited, so no layout decision has a cost* — which has been open since 2026-09-15 and named in every milestone since.

**Architecture:** One new machine kind that produces, one new placeable that carries, one number on every machine that consumes, and one new bot verb. The sim gains a per-run solve that is a min and a sum, deliberately not a circuit solver.

**Tech Stack:** Unchanged. No new dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — "research hands out primitives and capacity only", "failure is content", and the abstraction rhythm. **Survey:** `docs/plans/2026-09-18-how-other-games-do-power.md`, shape D, which is what this builds. **Measurement:** `docs/plans/2026-09-18-how-big-can-the-map-be.md`, which is milestone 13's, not this one's.

---

## Decisions already made

1. **Capacity per run, charged by load — not loss over distance.** The survey's finding: Factorio, Satisfactory and Mindustry all pool the network and charge nothing for distance, and Wube rejected distance loss twice in public. Oxygen Not Included is the only one of the four that models carrying capacity, and even there **the limit is on load, not on length**.

   A run therefore delivers what it carries whatever its length. What length costs is written into Decision 4, and it is not watts.

2. **A run's capacity is the minimum of its tiles, and a tile's capacity is the square of its tune.**

   ```
   capacity(tune) = tune²
   ```

   The minimum rather than the average, because that makes a run's weakest tile the thing that matters — which is a *findable* fault. A script that walks a run looking for the tile holding it back is a good thing to write, and an averaged run has no such thing in it.

   The square rather than a multiple, because a linear capacity makes the tune a units conversion and not a decision. Squared, plus Decision 4's drift, means widening a run is a real trade rather than a free upgrade.

3. **Bots never need power, and that is a safety rule rather than a balance one.** The design says no crash is fatal. If a blackout could stop the bots, a colony that browns out its own generators has no way back — the one state in this game from which a player cannot recover by writing better code. So: machines draw, bots do not, ever.

   This is also what keeps Mindustry's death spiral out. Its generators need power to make their own fuel, and a brownout there can feed itself until a sector is lost. Here the fuel is harvested by bots, which always run.

4. **A tuned tile drifts, and that is how distance costs something.** A tile loses tune over time at a rate that rises with how wide it is tuned. Nothing about the *run* is special-cased: a long run simply has more tiles, so more of it needs re-tuning per unit time. **Distance costs attention, and it costs it emergently rather than by a rule that says so.**

   Attention is the right currency for this game specifically, because attention is the thing a script takes off your hands. A grid that needs maintenance is a grid worth automating, and it gets harder exactly as the map grows — which is what milestone 13 is for.

5. **Over-capacity slows, it does not destroy.** ONI damages an overloaded wire. That is legible and it is also a punishment the player cannot undo without rebuilding, which sits badly beside "no crash is fatal" for something that can happen by adding one machine.

   So an over-drawn run behaves like Factorio's network: everything on **that run** slows in proportion. Local rather than global, because the run is the unit — which is the whole reason topology exists here.

6. **The fuel is wheat, burned raw.** The colony already grows one thing; a generator that eats it closes a loop the game has had since milestone 1 and needs no new material at all. Bread was the other candidate — it would give the mill and oven a purpose beyond research — and it loses because it puts two powered machines between the field and the power, which is Decision 3's spiral through a side door.

   The non-food material stays unbuilt and stays milestone 13's business, where a reason to cross a big map is the point of it.

7. **The formula is given, and only in its forward form.** The codebook hands over `capacity = tune²` at the moment a run first browns out — the suggester already raises a rung when something the player *did* calls for one, and a machine starved by a thin run is exactly that moment.

   What is **not** given is the inverse. A builder's real question is "how wide does this need to be", which is `Math.ceil(Math.sqrt(load))`, and rearranging it is the first piece of work the player does with it. One line, so it is not a wall; theirs, so it is not a handout.

8. **Numbers in the codebook come from `config.ts` through the existing substitution.** `api.ts` already writes `%ticks.move%` and the generator fills it, with a comment saying hover text quoting a tuned number is hover text that lies. A formula printed for the player is that hazard with the volume up: tune the constants later and a chip the game *gave* somebody silently becomes wrong, with nothing to make them doubt it.

9. **No circuit solver, ever.** A run is a connected set of lattice tiles. Its capacity is a minimum, its load is a sum, and its satisfaction is one division. Branching, direction of flow and merge behaviour are explicitly not modelled. Wube's rejection of transmission loss was partly that doing it properly is a max-flow problem; this milestone does not go near one.

10. **Tests may change, and every edit is named below.** The rule is unchanged since milestone 5.

    **Planned edit 1:** `MachineSnapshot` gains a field in Task 3. `tests/render/hud.test.ts` and `tests/sim/snapshot.test.ts` read fields off a snapshot rather than asserting shape — **checked against the file this time**, which milestone 11's Decision 7 got wrong by checking the wrong two. `tests/bridge/host.test.ts` asserts the whole *mirror* and is not affected; nothing asserts a whole machine. **Planned edit 2:** several sim tests place machines and assert they work; a machine that now needs power may stop working in them. Task 2 therefore makes unpowered the *default* only for kinds that consume, and the fixtures that break are information about Decision 5, not licence.

---

## Two facts to verify before building on them

### Fact 1: a run is cheap to solve every tick (verify in Task 2)

Every machine's rate now depends on its run's satisfaction, which means the grid is solved on the tick path rather than the frame path. The claim is that a min and a sum over connected components is nothing — but "nothing" is a measurement, and this project has a bench harness for exactly this.

Before anything is built on it, measure a grid of 500 lattice tiles and 50 consumers on a 32x32 map and compare `world.tick()` against today's 0.0021 ms. **If solving the grid costs more than the rest of the tick put together**, the representation is wrong — cache per run and dirty on change — and that is a decision to make before eight tasks are written against the naive one.

### Fact 2: the codebook can be raised by a world event rather than a script event (verify in Task 7)

Milestone 10's suggester watches four moments, and they are all things the *player's code* did: a script that ended twice, a bot stuck on a wall, an inventory that filled, a piece of hardware that landed. A machine browning out is none of those — it is a thing the **world** did, possibly while the player was looking somewhere else.

Check that `suggester.world(snap)` can carry it before writing the rung, and if it cannot, that is a finding about the suggester and the rung waits. A formula handed over at the wrong moment is worse than one the player finds in the book on their own.

---

## Conventions for every task

- Sim in `src/sim/`, renderer in `src/render/`, page in `src/editor/`, worker-facing API in `src/bridge/`.
- `npm run typecheck` and `npm test` before every commit.
- `npm run generate:dts` whenever `src/sim/types.ts`, `src/bridge/api.ts` or `MirrorState` changes.
- Files in the worker's import graph use explicit `.ts` extensions and import nothing from `src/sim/` at runtime. Milestone 2's rule, still load-bearing.
- Commit after each task with the message given.

## Domain vocabulary

- **Lattice.** The placeable that carries power. Tuned, not typed.
- **Tune.** A number on a lattice tile. Its square is what that tile can carry.
- **Run.** A connected group of lattice tiles, and the unit everything here is measured over.
- **Draw.** What a machine wants per tick. **Load** is the sum of a run's draws.
- **Satisfaction.** Capacity over load, capped at 1. What a machine's rate is multiplied by.
- **Drift.** Tune lost over time, per tile, faster the wider it is tuned.

---

### Task 1: A run is a thing the sim can find

**Files:** modify `src/sim/types.ts`, `src/sim/world.ts`; test `tests/sim/grid.test.ts`

`MachineKind` gains `lattice` and `generator`. A lattice machine carries `tune: number`. `World` gains a way to walk the lattice tiles connected to a position and answer with the run they form — capacity as the minimum of `tune²`, load as the sum of the draws of every consumer adjacent to the run, and satisfaction as the one divided by the other, capped at 1.

Tests: one tile alone is a run; two adjacent tiles are one run; a diagonal is two runs; the weakest tile sets capacity; a consumer adjacent to a run is on it and one a tile away is not; a run with no consumers has satisfaction 1 rather than a division by zero.

```bash
git commit -m "feat(sim): power runs, which are a minimum and a sum and deliberately not a solver"
```

---

### Task 2: Machines run at the speed their run allows

**Files:** modify `src/sim/world.ts`, `src/sim/config.ts`; test `tests/sim/power.test.ts`, and **Fact 1's measurement in `tests/bench/grid-size.bench.ts`**

`config.ts` gains a draw per machine kind. A machine's conversion advances by its run's satisfaction rather than by 1, so a half-fed mill takes twice as long and a starved one does not move. Per Decision 3 no bot verb consults power, ever.

Fact 1 is measured here, before the rest of the milestone is written against this representation.

Tests: a mill on a fed run converts at its old rate, and every existing timing test still passes; the same mill at half satisfaction takes twice as long; at zero it does not start; a generator burning wheat raises capacity; **a bot harvests, deposits and builds exactly as fast on a dead grid as on a live one.**

```bash
git commit -m "feat(sim): a machine runs at the speed its run can feed it"
```

---

### Task 3: The canvas says which runs are struggling

**Files:** modify `src/sim/types.ts`, `src/render/actors.ts`, `src/render/animated.ts`, `src/render/inspector.ts`; test `tests/render/hud.test.ts`

`MachineSnapshot` gains satisfaction. A machine under 1 draws the way a jammed one already does — the amber the belt uses — and the inspector names the run and its numbers. Per the design's "failure is content", a brownout that can only be found by reading a number is not good enough, and every game in the survey has a world-side signal for exactly this.

```bash
git commit -m "feat(render): a starved machine looks starved, and the tooltip says by how much"
```

---

### Task 4: A bot can lay lattice and tune it

**Files:** modify `src/sim/world.ts`, `src/bridge/protocol.ts`, `src/bridge/colony.ts`, `src/bridge/api.ts`; test `tests/bridge/tune.test.ts`; regenerate the `.d.ts`

`bot.builder.tune(dir, value)` — a command with a tick cost, because it is an arm doing something to a tile. It refuses through the sim's own reasons: no lattice there, a value out of range.

Tests: tuning raises what a run carries; the arm refuses a non-lattice tile with the sim's words; tuning costs its ticks; a tune survives a save; the `.d.ts` carries the formula's constants from `config.ts`.

```bash
git commit -m "feat(bridge): the arm can tune a lattice tile, which is what decides what it carries"
```

---

### Task 5: A script can read the grid

**Files:** modify `src/bridge/protocol.ts`, `src/bridge/colony.ts`, `src/bridge/api.ts`; test `tests/bridge/grid-reads.test.ts`; regenerate the `.d.ts`

Milestone 11's lesson, applied before the playtest rather than after it: **the engine knows something and no script can ask.** A planner needs the run at a position — capacity, load, satisfaction, and the tune of the tile holding it back. A free read, like every other.

`ScanTile` gains `tune`, so a bot can survey lattice at a distance the way it surveys crops.

Tests: the read matches what the sim computes; it costs no ticks; it names the weakest tile; a position with no lattice answers null rather than throwing.

```bash
git commit -m "feat(bridge): a script can ask what a run carries and what is holding it back"
```

---

### Task 6: Tune drifts, so a grid needs keeping

**Files:** modify `src/sim/world.ts`, `src/sim/config.ts`; test `tests/sim/drift.test.ts`

Per Decision 4: every lattice tile loses tune over time, faster the wider it is tuned. Nothing is special-cased for length — a long run has more tiles and therefore more to keep.

Tests: a tile drifts; a wider tile drifts faster; a run's capacity falls as its weakest tile drifts; a re-tuned tile recovers; **drift alone never takes a run to zero**, because a grid that dies while the player is reading the editor is a punishment rather than a chore.

```bash
git commit -m "feat(sim): a tuned tile drifts, so distance costs attention rather than watts"
```

---

### Task 7: The book hands over the formula, at the brownout

**Files:** modify `src/editor/suggestions.ts`, `src/editor/codebook.ts`, `scripts/generate-dts.ts`; test `tests/editor/suggestions.test.ts`

Fact 2 is verified first. Then a rung: the forward formula, `capacity = tune²`, with its constants substituted per Decision 8, raised the first time a machine is starved. The rung above it is the one the player writes — the inverse — and per Decision 7 the book does not write it for them.

```bash
git commit -m "feat(codebook): the game hands over the formula the moment a machine goes hungry"
```

---

### Task 8: Play it

**Files:** `tests/bench/grid.bench.ts`; append findings to this document

A script that lays a run from a generator to a mill, tunes it for the load, and keeps it tuned as it drifts — written the way a player would, reaching past nothing. Then the same script with a second mill hung off the run it already built, which is the moment the formula stops being a one-off calculation and starts being a loop.

**The measurement that matters is whether a player would write `keepGridHealthy()` and mean it.** Record whatever it hits.

```bash
git commit -m "test(bench): the grid, played, and what it cost to keep it up"
```

---

## Done criteria for milestone 12

- A machine's rate depends on a run it is attached to, and milestone 5's finding 5 is closed: a machine is no longer free.
- A bot can build and tune a grid from a script, and read back what it built.
- A starved machine is visible on the canvas without opening anything.
- Drift makes a grid need keeping, and the cost of a long run is the number of tiles in it rather than a rule that says distance is expensive.
- The codebook gives the forward formula and not the inverse, and its constants come from `config.ts`.
- No circuit solver, no power on bots, and `npm run bench` says Fact 1 held.
- `npm run typecheck`, `npm test` and `npm run build` pass.

## What milestone 13 inherits

The world getting big, which is what this was all for: 128x128 (measured free), terrain culling for the 52 ms zoom hitch, a camera that does not lose the bot, and something worth crossing the map to reach. The grid built here is what has to stretch to it, and the drift built here is what makes stretching cost something.
