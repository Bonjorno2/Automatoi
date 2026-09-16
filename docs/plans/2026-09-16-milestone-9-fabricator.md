# Milestone 9: The Factory Builds the Factory

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** The design's cycle 4. A player stops writing one file per bot and starts writing a factory that staffs itself: shared code that every bot can call, and a machine that turns a function into a new bot running it. The hands phase this creates is the one the design names — *deciding what a new bot runs* — and the mind phase that answers it is a planner, which is cycle 5 and is entirely player-authored.

Three of milestone 8's findings come first, because two of them are one line each and the third is a gap in the sim that the fleet list exposed.

**Architecture:** One sim flag, two renderer touches, one new machine kind, and one genuinely new thing: the colony can start a bot from inside a running script. That last is bridge work and is the only part of this milestone that is not a variation on something already here.

**Tech Stack:** Unchanged. No new dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — the abstraction rhythm's cycle 4 ("copy-paste a factory block manually" / "blueprint functions that stamp layouts"), the Fabricator and Shared library rows of "Research tree as hardware", and `spawn(script)`. **Milestone 8 reference:** `docs/plans/2026-09-16-milestone-8-legibility.md`, findings 1, 2 and 3.

---

## Decisions already made

1. **`stamp` is not built, and that is the design working rather than a gap.** The design's cycle 4 is "blueprint functions that stamp layouts", and the rule underneath it is that *research hands out primitives and capacity only; every higher-level function is player-authored*. `bot.builder.place` shipped in milestone 6 and is the primitive. A `stamp` in the engine would be the game writing the player's abstraction for them, which is the one thing this design says never to do.

   What a player actually lacks is somewhere to **put** `stamp` once they have written it, so that three bots can call it. That is the shared library, and it is Task 4. The snippet book gains a worked `stamp` so the idea is visible without being built in.

2. **The shared library is a prelude, not `import`.** The design says "`import` between scripts". What ships is one extra source buffer — the library — whose text is compiled into scope ahead of every bot's script, so a function defined there is simply callable. This is a deliberate deviation and the reasoning is recorded rather than hidden.

   `runScript` compiles a player's source with `new Function("bot", "colony", source)`. Real `import` needs real modules, which means building a Blob URL per script and `await import()`ing it — a change that rewrites the worker entry on both platforms, makes every script async, and breaks `line-offset.ts`, which maps a thrown error back to the line the player wrote. The capability the design is asking for is *shared code between bots*; the keyword is how JavaScript usually spells it. A prelude delivers the capability, keeps the error mapping exact, and is simpler to explain to a beginner than a module graph: **write a function in the library, call it from any bot.**

   The price, stated: no namespacing, so a library function and a bot-local one of the same name collide, and the library's own errors land on a line number that needs the same offset treatment player lines already get. Both are Task 4's problem and both are tests.

3. **`spawn` takes a function, not a string.** `colony.fabricator.spawn(() => { ... })` reads as JavaScript, autocompletes, and is checked by the editor's TypeScript. It crosses the worker boundary as `fn.toString()`, which is what makes it possible at all.

   The consequence is the one thing a player must understand and the `.d.ts` must say: **the function is source, not a closure.** A variable from the spawning script is not in scope inside it, because what travels is text. That is a real constraint and it is also exactly how the design already works — every bot is a separate worker with its own globals — so it teaches the model rather than hiding it.

   A string would have avoided the confusion by being obviously text, and would have cost autocomplete, syntax highlighting and every editor affordance inside the most complex thing a player writes. The function wins; the doc comment does the work.

4. **The fabricator is a machine that must be reached, and the new bot appears beside it.** `spawn` is not a free "create bot anywhere": it needs a fabricator placed, researched, with a free tile next to it, and it consumes a chassis from research stock exactly as the build menu's Deploy does. The hands phase is *where the fabricator goes*, which is a layout decision, and the cost is the same chassis the player already pays.

   Without the machine, `spawn` would be a menu item spelled as code. With it, a factory that builds bots is a thing on the map that can be belted to.

5. **A bot that is getting nowhere says so, and it is a count rather than a state.** Milestone 8's finding 3: a bot walled in by belts reads "idle", exactly like one whose script ended, because `blockedOn` models bot-on-bot and radio and not walking into a machine.

   The fix is **not** a third `blockedOn` value. Bot-on-bot and radio are *waiting* — the command has not resolved and the script is suspended. Bumping a machine is not waiting: the move resolves, returns false, and the script runs on. Putting them in one field would mean "blocked" stopped having one meaning.

   So a bot carries `stalled`, the number of consecutive commands that resolved without achieving anything, reset by any that did. A count is honest about what it knows, distinguishes "idle" from "trying and failing" in the panel, and needs no new concept in the renderer.

6. **Nothing here re-tunes the chain.** Milestone 6's finding 8 — the bot has become the mill's servant — is the balance question this milestone's *content* answers rather than its numbers: the answer to one bot standing at a belt is more bots, which is what a fabricator is for. If Task 6's measurement says the answer is wrong, that is a finding for milestone 10 and `config.ts` still does not move here.

7. **Tests may change, and every edit is named below.** The rule is unchanged since milestone 5.

   **Planned edit 1:** none foreseen in `tests/`. Task 1 adds a field to `BotSnapshot`, and `tests/sim/snapshot.test.ts` reads fields off a snapshot rather than asserting its shape — checked, and the same near miss milestone 6 recorded for `dir`. Task 5 adds a `MachineKind`, which `tests/render/palette.test.ts` no longer pins by `Object.keys` since milestone 6 rewrote that assertion. **If either breaks, that is information about this plan, not licence to edit.**

---

## Two facts to verify before building on them

### Fact 1: a spawned bot is a bot like any other (verify in Task 5)

The colony has run one worker per bot since milestone 2, keyed by bot id, and every part of the page — the console panel's generations, the script store, the fleet list, hot reload — assumes a bot's script arrived from the editor. A bot whose script arrived from another script is new.

Before `spawn` is wired to the page, assert in a headless test that a spawned bot: appears in `colony.bots()`, can be read by another script, runs its own worker concurrently, survives its parent finishing, and is stopped by `stopAll`. **If any of those is false, the fabricator is a different feature from the one this plan describes** and the page work should stop until it is written down.

### Fact 2: the prelude does not move the player's error lines (verify in Task 4)

`line-offset.ts` exists because a thrown error's stack line is the line in the *generated function*, not in what the player typed, and milestone 3's finding made that a real bug. Prepending a library moves every bot line down by the length of the library.

Write the test first: a bot script whose third line throws, with a twenty-line library loaded, must report line 3. Then make it pass. An error that points at the wrong line is worse than no line number, because the player trusts it.

---

## Conventions for every task

- Sim in `src/sim/`, renderer in `src/render/`, page in `src/editor/`, worker-facing API in `src/bridge/`.
- `npm run typecheck` and `npm test` before every commit.
- `npm run generate:dts` whenever `src/sim/types.ts` or `src/bridge/api.ts` changes.
- Files in the worker's import graph use explicit `.ts` extensions and import nothing from `src/sim/` at runtime. Milestone 2's rule, still load-bearing.
- Commit after each task with the message given.

## Domain vocabulary

- **The library.** One source buffer, shared by every bot, compiled ahead of each script.
- **Spawn.** Starting a bot from inside a running script, at a fabricator.
- **Stalled.** How many commands in a row a bot has completed without achieving anything.

---

### Task 1: A bot that is getting nowhere says so

Milestone 8's finding 3, and first because it is the one thing that milestone built and could not make honest.

**Files:** modify `src/sim/world.ts`, `src/sim/types.ts`, `src/render/inspector.ts`, `src/render/hud.ts`; test `tests/sim/move.test.ts`, `tests/render/hud.test.ts`; regenerate the `.d.ts`

`Bot` and `BotSnapshot` gain `stalled: number`. Per Decision 5 it is a count, not a `blockedOn` member: any command that resolves having achieved nothing increments it, and any that achieves something resets it to zero. "Achieved nothing" is the command's own answer — a `move` that returned false, a `deposit` or `withdraw` that transferred 0, a `harvest` with nothing to take. A refusal that throws is already an error and is not this.

`describeBotActivity` gains a branch above `idle`: a stalled bot says so and says how long. The fleet list gets it for free, which is the entire point.

Tests: a bot walking into a machine stalls; walking into open ground clears it; the count rises across repeated bumps; a partial deposit of zero stalls and a partial deposit of three does not; a fresh bot is not stalled; the fleet row says "stuck" rather than "idle" for a walled-in bot, and still says "idle" for one that has simply stopped.

```bash
git commit -m "feat(sim): a bot counts the commands that achieved nothing, so the panel can say stuck"
```

---

### Task 2: The ghost remembers which way it was pointing

Milestone 8's finding 1: the ghost starts facing north, so laying a line rightward puts down a row of dead ends before anybody thinks about `R`.

**Files:** modify `src/editor/main.ts`; test — none that is not a screenshot, so keep the change small enough to read

The last facing a player chose survives re-arming the same kind. One module-level variable in `main.ts`, read when a placement is built and written by `rotate`. A player who turns east and lays six belts, then re-picks Conveyor, gets east.

This does **not** try to infer direction from the click sequence, which was the other candidate: guessing from the second click means the first belt of every line is still wrong, and a wrong guess that corrects itself is worse than a default that stays put.

```bash
git commit -m "feat(editor): the ghost keeps the facing you last chose"
```

---

### Task 3: The remove ghost says it will cost something

Milestone 8's finding 2. The cost is carried entirely by the third line of a six-line tooltip, under two lines identical to the harmless case, while the ghost and the banner say nothing.

**Files:** modify `src/render/inspector.ts`; test `tests/render/inspector.test.ts`

The remove ghost takes a third colour for "legal, and it will destroy something" — distinct from legal-and-free and from illegal. The decision the colour encodes is already computed: `removalCost(snapshot, tile) !== null`.

Factor the choice into a pure `ghostColour(mode, reason, costly)` so it is a test rather than a screenshot, which is the same move `describePlacement` made for the wording.

Tests: the three remove cases give three different colours; place mode is unchanged in both of its cases.

```bash
git commit -m "feat(render): the remove ghost changes colour when the click costs something"
```

---

### Task 4: The library

**Files:** add `src/editor/library.ts`; modify `src/bridge/run-script.ts`, `src/bridge/spawn.ts`, `src/bridge/colony.ts`, `src/bridge/line-offset.ts`, `src/editor/main.ts`, `src/editor/script-store.ts`, `index.html`; test `tests/bridge/library.test.ts`, `tests/editor/scripts.test.ts`

**Step 1: Verify Fact 2 first.** The failing test that pins a player's line number against a loaded library, before the prelude exists.

`WorkerInit` gains `library: string`. `runScript` compiles `library + "\n" + source` and `playerLine` subtracts the library's line count as well as its own preamble. The editor gets a second buffer, reachable the way the snippet book is, and `ScriptStore` holds it beside the per-bot sources.

Research: `ResearchName` gains `library`, priced in bread, per the design's "`import` is deliberately late". Until it is researched the buffer does not exist and the prelude is empty, so a beginner's error lines are untouched by a feature they have not bought.

Tests: a function defined in the library is callable from a bot script; a bot script's error reports the player's own line with a library loaded (Fact 2); an error *inside* a library function reports a line in the library and says so; two bots share one library; an empty library changes nothing; a library that throws at load time fails the script with a legible message rather than a silent no-op.

```bash
git commit -m "feat(bridge): a library every bot can call, which is what import was for"
```

---

### Task 5: The fabricator

**Files:** modify `src/sim/types.ts`, `src/sim/config.ts`, `src/sim/world.ts`, `src/bridge/protocol.ts`, `src/bridge/colony.ts`, `src/bridge/api.ts`, `src/render/palette.ts`, `src/render/actors.ts`, `src/render/inspector.ts`, `src/editor/build-menu.ts`, `src/editor/main.ts`; test `tests/sim/fabricator.test.ts`, `tests/bridge/spawn-bot.test.ts`

**Step 1: Verify Fact 1** with the headless test described above, before any page wiring.

`MachineKind` gains `fabricator`; `ResearchName` gains it too, priced in bread. It has no recipe — it converts nothing — and its whole behaviour is a predicate the bridge asks: `canSpawn(): string | null`, answering for a missing fabricator, no spare chassis, or no free tile beside one.

```ts
fabricator?: { spawn(script: () => void): number };
```

On `colony`, not `bot`: per the design's API rules, namespaces name *chassis hardware*, and a fabricator is a machine. It returns the new bot's id so the spawning script can radio it or read it.

The source is `script.toString()`, wrapped so the arrow body executes. Per Decision 3 the `.d.ts` comment must say plainly that the function is source and closes over nothing.

The colony deploys the bot through `world.spawnAt(fabricator)` and starts a worker for it with the same library prelude. A spawned bot's logs go to its own console panel, which already exists per bot.

Tests: spawn with no fabricator gives the sim's reason; with no chassis, the same; a spawned bot appears in `colony.bots()` and runs concurrently (Fact 1); it outlives its parent; `stopAll` stops it; its script's errors are reported against its own lines; two spawns from one fabricator both land.

```bash
git commit -m "feat(bridge): a fabricator, and a script that starts another bot"
```

---

### Task 6: A factory that staffs itself

**Files:** add `tests/bridge/cycle-four.test.ts`; modify `src/editor/snippets.ts`

The milestone's argument as a measurement, in the shape milestone 6 used for belts: one reference script, through the real bridge, that defines a layout function in the library, stamps it with the builder arm, spawns a bot at the fabricator, and has that bot run the loop the layout was built for. Assert bread arrives, and record the tick count against milestone 6's 1181.

Then read it as a designer. If the spawned bot does not beat its own cost, the fabricator is a worse deal than a second script in the editor and the numbers are wrong.

A snippet: `stamp`, written in the library, called from a bot. That is Decision 1's whole point made visible without being built in.

```bash
git commit -m "test(bridge): a script writes a factory, staffs it, and the bread arrives"
```

---

### Task 7: Play it

Same discipline as milestones 3 through 8. Specifically:

- **Does `spawn` teach the closure lesson or just punish it?** Decision 3's known trap: a player will reference an outer variable inside `spawn` and get a reference error at a line they did not write. Do it on purpose and see what the console says.
- Is the library the moment one-file-per-bot stops hurting, or a fifth buffer to keep track of?
- Does a stalled bot in the fleet list send you to the right tile?
- Does the remembered facing fix finding 1, or move the surprise to the second line you lay?
- And the question every milestone since 6 has asked and none has answered: is this the point where a player wants `expand(ironLine, 3)`?

Append `## Findings from Task 7`.

```bash
git commit -m "docs: milestone 9 playtest findings"
```

---

## Findings from Task 7

Recorded, and one of them fixed. Driven on 2026-09-16 against seed 1, with the
same caveat every milestone since 3 has carried: these are mechanical findings
from driving the real page, and the design's two scoring numbers still need human
playtesters. This milestone's own question — whether this is the point where a
player wants `expand(ironLine, 3)` — is squarely in that category and is not
answered below.

Finding 1 is the exception milestone 5 established: a defect rather than a
judgement gets fixed with a test and gets said out loud. It was a feature that
did not work, and it was one this milestone created.

**Finding 2 is a correction of itself.** It was first written up with a cause
that turned out to be invented, and the whole of it — the wrong version, how it
was caught, and what was actually happening — is kept rather than quietly
replaced, because a plausible explanation that survived a commit is the more
useful half.

### 1. A spawned bot's script could die and nobody was told

**Fixed — see below.** Decision 3's trap was walked into on purpose, as Task 7
instructed: a script that refers to an outer variable inside `spawn`.

```js
const where = "east";
colony.fabricator.spawn(() => {
  while (true) { bot.harvester.harvest(); bot.move(where); }
});
bot.log("spawned, and I am fine");
```

The parent was fine. It logged "spawned, and I am fine", settled `done`, and the
status line agreed — all correct, because the parent genuinely succeeded. The
child threw `where is not defined` on its first line and **nothing anywhere said
so.** The fleet list read `bot 4 idle · empty`. The child's console panel was
empty. The status line was green.

The cause: the page wires `onLog` and `onSettle` when *it* starts a script, and
nothing wired them when a *script* started one. `startSpawned` called
`run(botId, source)` with no options, so the error was produced, delivered, and
dropped. The design's own "Failure is content" table promises a runtime error
reaches the bot's console; this was the one path where it did not.

`onSpawned` is now a hook the page fills in, and clicking the child in the fleet
list shows `where is not defined (line 2)` — the child's own line, which is
`blameLine` working through two layers of wrapping.

**What is still true after the fix** is the smaller half: the fleet list says
`idle` for a bot whose script is dead, because the sim has no word for it.
Milestone 8's `stalled` counts commands that achieved nothing, and a script that
never ran a command has a count of zero. A dead bot and a finished bot are the
same bot to the panel.

### 2. A headless colony cannot measure a second bot, and the clock is why

**This finding replaces one that was wrong, and the correction is the useful
part.** The first version of it read "a second bot is worth nothing, and the
console is why", with numbers: 500 ticks against 505 for the same forty wheat.
The numbers were real. The explanation was invented, and checking it is what
found the actual cause.

The claim was that both bots deliver into one Research Console, which takes an
item per tick, so throughput past one bot is bounded by a machine. That is
arithmetically nonsense and one measurement would have shown it: a bot delivers
about ten wheat every hundred and twenty ticks, which is under a tenth of what
the console will accept. The console was never near saturation.

What is actually happening: **a spawned bot is an OS worker thread and costs real
milliseconds to start, while the demand clock advances a simulated tick per pass
as fast as the event loop turns.** Simulated time and wall time are different
clocks, and only one of them waits for a thread. Instrumented, the child's first
log arrives hundreds of simulated ticks after `spawn` returns — by which time the
parent has cleared its entire half of the field.

Measured directly, splitting the harvest by half: in the window after *both* bots
are demonstrably working, the staffed colony picked **north 0, south 41**. The
parent had nothing left. Every version of that benchmark — four of them — was
comparing one working bot against one working bot.

**On the page this does not arise.** The realtime clock ticks at 20Hz, so a
worker that boots in fifty milliseconds is one tick late rather than five
hundred, and the page playtest showed exactly that: spawn a harvest loop and the
fleet list grows a second row already carrying wheat.

So the fabricator's value is neither proved nor disproved here, and the test now
says so instead of asserting a speed-up that is not there. What it does assert is
the part that is real and worth a regression test: the spawned bot clears a half
of the field its parent never touches, from a function written once in the
library.

The lesson is bigger than this milestone. **Every headless measurement in this
project shares a clock that outruns anything with real-world latency**, and the
belt and chain benchmarks are only safe because nothing in them starts a thread.
The next one that does will be wrong in the same way and just as quietly.

### 3. A parent cannot wait for its child

Found while writing that benchmark, and the reason its final version is driven
from outside the game. There is no bot-to-bot "are you done". `colony.bots()`
gives positions and inventories, not whether a script is still running, and the
radio a player would reach for needs a module the fabricator does not fit — it
builds a chassis with a harvester and nothing else, and no script can install
one.

So a script that spawns a helper can start it and can never synchronise with it.
The harness cheats by watching the world from outside, which a player cannot do.

### 4. The library's error attribution earned itself in an hour

Not a fault: a feature working, recorded because it was not obvious it would.
Writing the reference script produced `inventory full (library line 30)` — a real
bug, in shared code, named by file and line. The version of `workBox` that threw
checked whether the bot was full *after* harvesting rather than before.

Fact 2 asked whether the prelude would move the player's line numbers. It does
not, and the first implementation subtracted one line too many — caught by a test
that ran four library lengths rather than one, which is why that test exists in
that shape.

### 5. Nothing tells a player the library exists

The button appears when the research completes, which is right, and the research
is in the menu beforehand, which is right. But the library is the first thing in
this game that is neither a machine to place nor a module to fit, and the only
announcement it gets is a button quietly becoming visible next to "Book". A
player who researched it while looking at the field has no reason to look at the
toolbar afterwards.

---

## Done criteria for milestone 9

- `npm test` and `npm run typecheck` clean, with no test edit that was not named above.
  > **Met on the tests, not on the prediction.** 602 tests, typecheck clean, up
  > from 572. Two test files were edited and Decision 7 named neither.
  > `actor-pos.test.ts` builds a whole `BotSnapshot` by hand and the compiler
  > demanded the new `stalled` field — a fixture, not an assertion.
  > `palette.test.ts` still pinned `Object.keys(MACHINE)`, which Decision 7 said
  > had already been rewritten and had not; it broke for the third consecutive
  > milestone and is retired rather than updated a fourth time.
- Milestone 8's findings 1, 2 and 3 are closed.
  > **Met.** The ghost keeps its facing, the remove ghost turns amber when the
  > click destroys something, and a bot counts the commands that got it nowhere.
- A function written once is callable from every bot, and a player's error still reports the line the player typed.
  > **Met**, and driven on the page rather than only in tests: research the
  > library, write `greet`, close it, and `bot.log(greet('world'))` on bot 1
  > prints "hello world".
- A running script can start another bot at a fabricator, and that bot outlives it.
  > **Met**, twelve tests including all five parts of Fact 1.
- `spawn` refuses through the sim's own reasons, not the bridge's.
  > **Met.** `canSpawn` is the fourth predicate in the family `canPlace` started.
- A headless test shows a script building a factory and staffing it, with the tick count recorded against milestone 6's baseline.
  > **Half met, and the other half is not measurable here.** The test shows a
  > script building a factory and staffing it: the spawned bot clears a half of
  > the field its parent never touches, from a function written once. The tick
  > count against a baseline is **not** meaningful, because the demand clock
  > outruns a worker thread's startup and every version of the comparison timed
  > one working bot against one working bot. Finding 2 has the measurements and
  > the correction.
- `stamp` is **not** in the engine, per Decision 1, and appears only as a snippet.
  > **Met.** It is a chip in the book that says to put it in the Library.
- `config.ts` gains research costs and nothing else, per Decision 6.
  > **Met**, verified by diff: two rows in `RESEARCH_COST`, two in
  > `RESEARCH_ITEM`, and no other line changed.

## What milestone 10 inherits

**Finding 2 leaves a hole in the toolkit rather than in the game.** There is no
way to measure what a second bot is worth, because the only harness this project
has runs a clock that outruns thread startup. Before cycle 5 — planner scripts
that read demand and expand — there should be a way to ask "did that make the
colony faster", and today there is not. A realtime-clocked headless colony, or a
warm-up the harness enforces rather than each test inventing, would give it one.

**Whether the colony actually scales is therefore still an open question**, not a
settled one. It was briefly recorded as settled and it was not.

**Finding 3 is small and blocks a real pattern**: a script can start a helper and
can never synchronise with it. The radio exists; the fabricator cannot fit one.

**Finding 1's residue** — a bot whose script is dead reads "idle" — is the third
time the fleet list has wanted a word the sim does not have.

## What milestone 10 will build on this

Cycle 5, which is the last rung the design describes: planner scripts that read demand and expand. Every primitive it needs will exist — `place`, `spawn`, the library, and `colony.bots()` — so cycle 5 is the first cycle that needs **no engine work at all**, which is either the design being right or the design being untestable, and only a playtest can say which.

The two things the engine still owes it: a non-food material, without which milestone 5's finding 5 — machines are free and unlimited — cannot be fixed and no layout decision has a cost; and the Blackbox, which is the half of the debug hardware that is still genuinely missing now that the fleet view exists.
