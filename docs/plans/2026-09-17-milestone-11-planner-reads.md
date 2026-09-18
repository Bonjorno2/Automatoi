# Milestone 11: The Planner's Reads

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make cycle 5 writable. The cycle five playtest walked the design's last rung the way a player would and hit three walls, and all three are the same shape: **the engine knows something and no script can ask.** This milestone adds the three reads and nothing else.

Milestone 9 predicted cycle 5 would need no engine work. The playtest proved otherwise and named the work for milestone 10; milestone 10 went to teaching and the web instead, which was the right call for a game about to meet strangers and leaves this exactly where it was. The findings are unchanged, verified against the shipped API on 2026-09-17:

- `world.canPlace` has three callers in `src/sim/world.ts` and none of them is a script.
- `spawn(script: () => void)` still takes no argument, so a blueprint cannot be parameterised without `new Function` and a string.
- `MirrorState` still carries `{ time, pos, inventory, modules, busy }`, so a parent cannot tell a working child from a deadlocked one.

**Architecture:** One new host request, one argument, two fields on a struct that already crosses the boundary. No new machine, no new verb, no new module. The sim is not touched at all except to be *asked*.

**Tech Stack:** Unchanged. No new dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — the abstraction rhythm's cycle 5, and the rule under it: *research hands out primitives and capacity only; every higher-level function is player-authored*. **Playtest reference:** `docs/plans/2026-09-16-cycle-five-playtest.md`, findings 2, 4 and 5, which are this milestone's whole scope. **Milestone 9 reference:** `docs/plans/2026-09-16-milestone-9-fabricator.md`, finding 1's residue, which Task 4 closes.

---

## Decisions already made

1. **`colony.canPlace(pos, kind)`, taking an absolute position, and it is not gated on hardware.**

   Position-first and absolute, because that is the question a planner has. `bot.builder.place` is direction-relative and always will be — an arm reaches one tile — but a planner's job is deciding *where to walk before walking there*, and a read that could only answer about the four tiles it is standing next to would answer the question the planner already knows. It pairs with a scan tile by structure: `tiles.filter((t) => colony.canPlace(t, "crate"))` typechecks, because a `ScanTile` has `x` and `y`.

   It lives on `colony` rather than in `bot.builder`, which was the real alternative: the gate machinery exists, and a player earning the arm would meet `place` and `canPlace` in autocomplete together. It loses anyway, on the game's own rule. **Research gates hardware, never knowledge.** An arm is hardware and is gated. Where a crate would fit is public geometry that any bot can see by walking there, and charging a research for the right to *ask* would be the first time this game gated a read.

2. **It answers a boolean, and the reason stays with the throw.**

   `world.canPlace` answers `string | null` — the reason, or null for yes — and that shape is right for its callers, who all want to say why. It is wrong for a script, because `if (colony.canPlace(t, "crate"))` would then be true exactly when it cannot, and this is a game whose job is teaching people JavaScript. A `canX` that returns a truthy string for "no" is a trap, and shipping one to teach a beginner would be indefensible.

   So: boolean. The reason is not lost — `bot.builder.place` still throws the sim's own words, which is where a script that wanted to know finds out. A planner asks `canPlace` to *choose*, and catches `place` to *report*.

3. **`spawn` takes a second argument, serialised as JSON, and it arrives as the function's parameter.**

   ```js
   colony.fabricator.spawn((home) => {
     while (true) workCrate(home.x, home.y);
   }, { x: 4, y: 7 });
   ```

   Milestone 9's Decision 3 chose a function over a string for autocomplete, highlighting and typecheck, and named the closure trap as the price. Cycle 5 is where that price came due: a planner's entire job is producing bots that differ only in their parameters, and the only way through was building the source text by hand and throwing away every affordance the function was chosen for.

   The argument travels in the source, not in the protocol: `api.ts` writes `(${script})(${json});` and the host stays as dumb as it is now. That keeps the whole feature on one side of the boundary and needs no new request kind.

4. **A non-serialisable argument fails in the parent, on the line that called.**

   `JSON.stringify` answers `undefined` for a function and throws for a cycle. Both become a thrown error in the *calling* script with a sentence a player can act on, rather than a child that dies on a line nobody wrote. This is the same lesson as cycle five's finding 1 and milestone 10's oversized scan: a documented call used at a reasonable argument must never kill something silently.

   The argument is **not** type-constrained to JSON in the `.d.ts`. A `Json` alias would have to be inlined into the generated file and would still not catch a closure variable that happens to be JSON-shaped. The runtime message is the honest place for this.

5. **A bot view gains `stalled` and `script`, and `script` speaks the console panel's vocabulary.**

   `busy` means "a command is in flight", which is true of a bot working and equally true of a bot deadlocked against another — the playtest sampled exactly that pair. `stalled` already exists on `Bot` and on `BotSnapshot` since milestone 9 and is simply not carried through the mirror. Whether the *script* is alive exists nowhere a script can reach.

   `script` takes `"idle" | "running" | "done" | "error" | "hung" | "stopped"` — `ScriptStatus` plus the two states a settled verdict cannot express. Those are the exact words `console-panel.ts` already badges, which means the game has one vocabulary for this rather than two. `"idle"` therefore means *no script has run on this bot*, which is what the panel already uses it for.

   Both fields go on `MirrorState`, so `colony.bots()` and the bot's own mirror agree by construction rather than by a second code path.

6. **No new verbs, and no pathfinding.** Every wall in the playtest was a missing *read*. Nothing here lets a script do anything it could not do before; it lets a script find out. `stamp`, `expand` and route-finding stay player-authored, per the design's rule, and the temptation to fix "walk until blocked" while in here is noted and refused.

7. **Tests may change, and every edit is named below.** The rule is unchanged since milestone 5.

   **Planned edit 1:** `MirrorState` gains two fields in Task 3. `tests/bridge/mirror.test.ts` and `tests/bridge/api.test.ts` both read fields off a view rather than asserting its shape — checked. **Planned edit 2:** `tests/bench/cycle-five.bench.ts` is rewritten in Task 5; it is the playtest and rewriting it is the task. **If anything else breaks, that is information about this plan, not licence to edit.**

   > **Planned edit 1 was named against the wrong two files, and the suite said so.** `tests/bridge/host.test.ts` asserts the whole published mirror with `toEqual`, and that is the assertion that broke in Task 3 — the two files named above were checked and were not the ones with a shape in them. The edit is the two new fields added to that literal, which is the assertion doing its job rather than being in the way, and it is recorded here because a test edit nobody wrote down is how a suite stops meaning anything.

---

## One fact to verify before building on it

### Fact 1: the ghost, the arm and the script give the same answer (verify in Task 1)

`world.canPlace` exists so that the red ghost and the refusing click are the same rule rather than two copies of it, and the comment above it says so. This milestone adds a third caller with a different shape — absolute position, boolean answer, no adjacency — and a fourth reader who will trust it: a planner that walks somewhere on its strength.

Before anything is built on it, assert directly that for a spread of tiles — free soil, the console's tile, a bot's tile, out of bounds, an unresearched kind — `colony.canPlace` and an actual `bot.builder.place` agree on every one. **If they can disagree, the read is a second copy of the rule** and this milestone has made the exact drift `canPlace` was written to prevent.

---

## Conventions for every task

- Sim in `src/sim/`, renderer in `src/render/`, page in `src/editor/`, worker-facing API in `src/bridge/`.
- `npm run typecheck` and `npm test` before every commit.
- `npm run generate:dts` whenever `src/sim/types.ts`, `src/bridge/api.ts` or `MirrorState` changes.
- Files in the worker's import graph use explicit `.ts` extensions and import nothing from `src/sim/` at runtime. Milestone 2's rule, still load-bearing.
- Commit after each task with the message given.

## Domain vocabulary

- **A read.** A call that answers from current state, costs no ticks, and never blocks.
- **A planner.** A player-authored script that reads the world and decides what to build and who staffs it. Cycle 5.
- **Script state.** Whether a bot's code is running, and if not, how it stopped.

---

### Task 1: A script can ask where a thing fits

Cycle five's finding 2: a planner picked the centroid of the field, the centroid held the console, and it retried the same refused build 128 times in 6000 ticks because attempting was its only way to ask.

**Files:** modify `src/bridge/protocol.ts`, `src/bridge/colony.ts`, `src/bridge/api.ts`; test `tests/bridge/can-place.test.ts`; regenerate the `.d.ts`

`HostRequest` gains `{ kind: "can-place"; pos: Vec; machine: MachineKind }`. `dispatch` answers it immediately, like `time` and `research-status`: `{ ok: true, value: this.world.canPlace(machine, pos) === null }`. `ColonyApi` gains the method with the JSDoc that says what it costs, what it does not promise — a tile free now can hold a bot by the time you walk there — and shows the `filter` over a scan.

Tests, and Fact 1 is the first of them: the agreement table, driven through a real script for every row. Then: a free soil tile is true; the console's tile is false; a tile under a bot is false; out of bounds is false; a kind nobody has researched is false and becomes true when it is; a thousand calls cost zero ticks; an unknown machine kind is an error the script can catch rather than a crash.

```bash
git commit -m "feat(bridge): a script can ask where a machine fits, instead of finding out by failing"
```

---

### Task 2: A blueprint can be told which one it is

Cycle five's finding 4. `expand(blueprint, n)` has to tell each child which block is its own, and a spawned function closes over nothing.

**Files:** modify `src/bridge/api.ts`; test `tests/bridge/spawn-arg.test.ts`; regenerate the `.d.ts`

`spawn` gains an overload: `spawn(script: () => void): number` and `spawn<T>(script: (arg: T) => void, arg: T): number`. The worker side serialises with `JSON.stringify` and writes the call as `(${script})(${json});`. `U+2028` and `U+2029` are escaped on the way in — they are legal inside a JSON string and have historically not been legal inside a JavaScript one, and this is the one place in the game where JSON becomes source.

Per Decision 4, a value `JSON.stringify` cannot carry throws in the parent: a function or a symbol answers `undefined`, a cycle throws, and both become one sentence naming the second argument.

Tests: a child reads its argument and works where it was told; two children spawned from one loop with different arguments clear different halves of the field; an object with nested arrays and a string full of quotes and newlines survives the crossing intact; a function as the argument throws in the parent, on the calling line, and the parent lives; a circular object does the same; `spawn` with no argument still works exactly as milestone 9 shipped it.

```bash
git commit -m "feat(bridge): a spawned bot can be told which block is its own"
```

---

### Task 3: A parent can see whether its children are alive

Cycle five's finding 5, which is milestone 9's finding 3 seen from the other end: the colony is observable to the renderer and not to a script.

**Files:** modify `src/bridge/protocol.ts`, `src/bridge/colony.ts`, `src/bridge/api.ts`, `scripts/generate-dts.ts`; test `tests/bridge/liveness.test.ts`; regenerate the `.d.ts`

`protocol.ts` gains `export type ScriptState = "idle" | "running" | "done" | "error" | "hung" | "stopped"`, and `colony.ts` redefines `ScriptStatus` as `Exclude<ScriptState, "idle" | "running">` so the two cannot drift. `MirrorState` gains `stalled: number` and `script: ScriptState`.

`Colony.viewOf` fills `stalled` from the sim and `script` from a protected `scriptStateOf(botId)` that answers `"idle"` — a plain `Colony` has no workers and must not pretend otherwise. `ScriptColony` overrides it from a map written in `run` and in `settle`, which is first-call-wins already, so a verdict is recorded once and a hot reload's `"running"` replaces it.

`generate-dts.ts` learns to inline a type alias beside the interfaces it already inlines; without it the generated file references a `ScriptState` that is not in it and Monaco loads a type error.

Tests: a bot whose script threw reads `"error"` in another bot's `colony.bots()` while the reader is still running; a bot in a `while (true)` reads `"running"`; a bot that has never run reads `"idle"`; a stopped one reads `"stopped"`; a walled-in bot's `stalled` rises in a *different* bot's view of it; the reads still cost no ticks; and the generated `.d.ts` typechecks.

```bash
git commit -m "feat(bridge): a script can see whether another bot is working, stuck or dead"
```

---

### Task 4: The fleet list stops calling a dead bot idle

Milestone 9's finding 1 left a residue — *a bot whose script is dead reads "idle"* — and it has now been named three times without being fixed, because the word lives in the bridge and the fleet list reads the sim.

**Files:** modify `src/render/hud.ts`, `src/editor/main.ts`; test `tests/render/hud.test.ts`

`fleetRows` takes the script states as a second argument and prefers them over `describeBotActivity` when they say something the snapshot cannot: a bot that errored, hung or was stopped. `main.ts` owns both the colony and the hud and is the one place that can hand one to the other.

**This task is droppable and the guard is explicit:** if threading script state into the hud needs anything more than passing a map that `main.ts` already has, stop and record it as a finding. A renderer that reaches into the bridge for itself is a worse outcome than a fleet row that stays wrong for one more milestone.

```bash
git commit -m "feat(hud): the fleet list says how a bot's script ended, not that it is idle"
```

---

### Task 5: Play it

The playtest that decides whether the claim cycle five falsified is true now.

**Files:** rewrite `tests/bench/cycle-five.bench.ts`; append findings to this document

Write the four-layer stack again, the way a player would and with the same rule as last time — nothing reaching past the shipped API — and run it with `npm run bench`. `unservedSpot` now filters by `colony.canPlace`; `expand` passes each child its own crate through `spawn`'s argument; `main` asks `colony.bots()` whether the last child is working before building another.

Record what it hits, whatever that is. A defect gets fixed here with a test, per the rule milestone 5 set. A design gap gets written down and left for milestone 12. **The measurement that matters is whether the planner places a second crate and staffs it**, which is the sentence the design has been claiming since 2026-09-11 and has never once done.

```bash
git commit -m "test(bench): cycle five, played again, with the reads it asked for"
```

---

## Findings from Task 5

### 1. The claim is true now, and the difference is not marginal

Cycle 5 ran. `main.js` says `survey()`, `expand(harvestBlock, 1)`, `standAside()` and nothing else, and the colony it produces works. Four consecutive runs, and the spread between them is one tick:

| | 2026-09-16, before the reads | 2026-09-17, with them |
|---|---|---|
| crates placed | 1 | **3** |
| blocks staffed | 0 | **3** |
| wheat cleared | 1 | **25** |
| ticks | 6000, timed out | **249** |
| refusals logged | 129 identical | **none** |

The planner's whole log for a run is three lines, each of them a block going down:

```
expand: block at 20,19
expand: block at 18,12
expand: block at 14,12
```

**Every one of the three walls is gone, and each went for the reason the fix predicted.** `unservedSpot` no longer proposes the tile the console is standing on, because it asks. `expand` hands each child a `{x, y}` and no part of this file builds source text any more. `ailing()` reads `script` and `stalled` off other bots, which is a question `busy` could not answer.

The design has been claiming this sentence since 2026-09-11 and this is the first time anything has done it.

### 2. Finding 3 is avoided by the script, not fixed by the engine

Sampled at the close of **every** run, without exception:

```
bot 1 at 15,16 — action wait,  blockedOn nothing, stalled 1
bot 9 at 15,17 — action move,  blockedOn bot,     stalled 0
```

That is the first playtest's finding 3 exactly: a bot the planner built, waiting on a tile the planner is standing on, with a command that **never resolves while the other bot stays put**. What changed is not the engine. It is that `standAside` keeps the planner walking to a tile off the field, so the block always clears within a few ticks instead of lasting the session.

So the hazard is intact and the fatality is gone. A player who writes a planner that stops moving will rediscover this, and the sim will still have no way to tell them — `stalled` reads 0 for the blocked bot, because nothing resolved, which is the same hole milestone 8's counter had and cycle five's finding 3 recorded. **This belongs to a later milestone and is not a defect introduced here**, so it is written down rather than fixed: a `blockedOn` that eventually gives up, or a move that answers false after waiting, is a design decision about what blocking means and deserves its own plan.

### 3. A script cannot ask which bot it is running on

New, and found by writing the thing rather than by thinking about it. `ailing()` wants "the bots I built, that are not working", and it cannot express the first half: `colony.bots()` hands out ids, and there is no `bot.id`. The planner therefore includes itself in its own health check, and the only workaround is matching a view's `pos` against `bot.pos()`, which is a coincidence rather than an identity.

Nothing in this milestone caused it — `spawn` has returned the child's id since milestone 9, so a parent *can* remember what it built, and a script that keeps a list works. It is a gap in the API's self-awareness, it is one free read to close, and it is not this milestone's scope.

---

## Done criteria for milestone 11

- `colony.canPlace` agrees with `bot.builder.place` on every row of Fact 1's table, driven through a real script.
  > **Met.** Six rows in `tests/bridge/can-place.test.ts`, each asserting the read and an actual `place()` return the same answer: free soil, the console's tile, a tile under a bot, out of bounds, an unresearched kind, a second console.
- A planner parameterises a child through `spawn` with no `new Function` and no string building anywhere in the bench.
  > **Met.** `colony.fabricator.spawn(workBlock, at)`. `new Function` survives in `cycle-five.bench.ts` in exactly one place: the header comment saying what it used to do.
- `colony.bots()` distinguishes a working child from a dead one, and the distinguishing is what `expand` uses to decide.
  > **Half met, and the half that is missing is the interesting one.** The distinction exists and is tested seven ways in `tests/bridge/liveness.test.ts`. `main` reads it and reports on it — but in a run where nothing dies, it never has to *act* on it, so this playtest did not prove the judgement is a good one. A run with a child killed on purpose would, and is a fair thing for milestone 12's playtest to do.
- No new verb, no new machine, no new module, and `src/sim/` gains no capability — only callers.
  > **Met.** `src/sim/` gained one table, `MACHINE_KINDS`, which is a list of what already existed so that a name arriving from a player's script can be checked. No behaviour moved.
- `npm run typecheck`, `npm test` and `npm run build` pass; the committed `.d.ts` matches its generator.
  > **Met.** 803 tests across 74 files, and `tests/editor/dts.test.ts` is what checks the last of those.
- Cycle five's findings 2, 4 and 5 are each either closed with a test or restated here with what is still missing.
  > **Met.** 2, 4 and 5 are closed. 3 is restated above, with the sample that shows it is still there.

## What milestone 12 inherits

**The engine's two named debts are untouched and are both still the right next thing.** A non-food material, without which milestone 5's finding 5 — machines are free and unlimited — cannot be fixed and no layout decision has a cost; and the Blackbox, which is the half of the debug hardware still missing now that the fleet view can tell a dead script from an idle one. This milestone deliberately built neither.

**Two small holes, both one free read wide:** a script cannot ask which bot it is (finding 3 above), and a bot-on-bot block still never resolves and still reports nothing (finding 2 above). The second is a decision about what blocking means, not a bug fix.

**And the question this still has not answered** is the one the design scores on: whether a player *wants* to write `expand(harvestBlock, 1)`. Cycle 5 now works, which is a thing a machine can check. Whether the sentence feels earned needs a human who did not write it, and has needed one since milestone 3.
