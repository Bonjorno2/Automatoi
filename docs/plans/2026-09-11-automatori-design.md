# Automatori: Design Document

Date: 2026-09-11
Status: validated through brainstorming, pre-implementation

## One-line pitch

The Farmer Was Replaced meets Factorio: a browser game where you program a fleet
of bots in real JavaScript, and each layer of automation you write becomes the
building block for the next. A beginner writes a two-line loop. A veteran writes
a planner that expands the factory. Both are editing the same kind of file.

## Decisions made

| Axis | Decision | Why |
|---|---|---|
| Code model | Real language (JavaScript), tiered by hardware, never by syntax | One system, no cliff between beginner and veteran |
| Unit of code | Fleet of programmable bots, each running its own script | Coordination is where the "ordered chaos" lives |
| Progression | Research unlocks hardware modules and capacity, never language features | The API is the tech tree; code is always free |
| Platform | Browser, TypeScript, PixiJS, Monaco editor, Web Workers | Zero install, shareable, VS Code quality editing for free |
| Execution | Blocking sequential scripts (`bot.move()` pauses the script until done) | First program is `while (true) { harvest(); move("east"); }` |
| Inter-bot visibility | Direct read access to other bots' state; radio for behaviour changes | Beginners can peek; coordination still needs messaging |

## The first ten minutes

You crash-land one bot on a tile-grid planet. The editor opens with:

```js
bot.harvester.harvest();
bot.move("east");
```

Press Run. The bot harvests and steps east, then stops because the script ended.
Insight one: wrap it in a loop. Insight two: the bot walks off the field, so
learn `while`, `if`, and `bot.pos()`. Each JavaScript concept is learned because
the farm needed it. No tutorial popups.

Harvested wheat feeds a Research Console. First research unlocks the planter.
Next unlocks the scanner. A beginner now has a real farm loop. A veteran has
already written a serpentine traversal and wants a second bot.

## The abstraction rhythm

The game alternates two phases that repeat at increasing scale:

- Hands phase: in the world, placing things, watching bots. Pain is tedium.
- Mind phase: in the editor, automating the last hands phase. Pain is code length.

Each cycle automates the previous cycle's output:

| Cycle | Hands phase | Mind phase automates it |
|---|---|---|
| 1 | Click tiles to harvest | `harvest()` loop |
| 2 | Place crates, walk to them | Hauling script with `deposit()` |
| 3 | Place conveyors and smelters by hand | `place()` in code, bots lay belts |
| 4 | Copy-paste a factory block manually | Blueprint functions that stamp layouts |
| 5 | Decide which blueprint goes where | Planner scripts that read demand and expand |

By cycle 5, `main.js` never says `move("east")`. It says `expand(ironLine, 3)`.
`expand` is built on `stamp`, on `place`, on `move`. The player wrote every
layer and owns the whole abstraction stack.

Rule that follows: research hands out primitives and capacity only. Every
higher-level function is player-authored. A snippet library exists for
beginners to copy from; veterans ignore it.

## Research tree as hardware

Research never gates the language. It gates hardware. Every research item is a
physical thing that must then be placed or installed, which starts the next
hands phase.

| Unlock | Hardware | Verbs enabled | Hands-phase pain it creates |
|---|---|---|---|
| Planter arm | Bot module | `bot.planter.plant(seed)` | Choosing what to plant where |
| Scanner | Bot module | `bot.scanner.scan(radius)` | Reading scans by eye |
| Storage crate | Machine | `deposit`, `withdraw` | Walking to the crate every trip |
| Second chassis | New bot | `colony.bots()`, per-bot scripts | Two bots colliding |
| Radio | Bot module | `bot.radio.send`, `bot.radio.receive` | Designing a protocol |
| Builder arm | Bot module | `bot.builder.place`, `bot.builder.remove` | Laying belts one tile at a time |
| Conveyor, smelter, sorter | Machines | none, they are dumb | Layout is a spatial puzzle |
| Fabricator | Machine | `spawn(script)` | Deciding what a new bot runs |
| Shared library | Colony upgrade | `import` between scripts | Organising a codebase |

`import` is deliberately late: one file per bot is fine at three bots and
miserable at fifteen. Research costs are denominated in produced goods. No
research costs code, because code is free.

## API shape

One global `bot` object whose members mirror the physical chassis. Gated verbs
live in namespaces named after the hardware.

```js
// Always present
bot.move("east");          // blocks until arrived
bot.pos();                 // { x, y }
bot.inventory();           // { wheat: 3 }, so `bot.inventory().wheat ?? 0`
bot.wait(ticks);
bot.log("hello");          // this bot's console panel
bot.deposit("north", "wheat", 5);  // machine verbs, see below
bot.withdraw("north", "wheat", 5);

// Present only when the module is installed
bot.harvester.harvest();
bot.planter.plant("wheat");
bot.scanner.scan(2);
bot.radio.send("haul", { x: 4, y: 7 });
bot.radio.receive();       // blocks until a message arrives
bot.builder.place("conveyor", "north");
bot.builder.remove();

// Colony-level, not hardware
colony.bots();             // handles with read access: pos(), inventory(), etc.
colony.research.queue("radio");
colony.time();
```

Rules:

- Namespaces are the tutorial. Autocomplete on `bot.` lists what you have.
- **Verbs that operate a machine live on `bot` directly, not in a namespace.**
  A crate is a machine standing on a tile, not a chassis module, so there is no
  hardware to name a namespace after. `deposit` and `withdraw` are therefore
  always visible and fail with the sim's message when no crate is adjacent.
  Namespaces name chassis hardware; machine verbs name what the bot can reach.
- Blocking is per-bot. One bot waiting on `receive()` never stalls another.
- Nothing is hidden from the type file. The full `.d.ts` always ships.
  Uninstalled modules are typed `undefined`, so `bot.scanner?.scan(2)` is
  honest TypeScript. Calling an uninstalled module is a runtime error:
  "Bot 3 has no Scanner module."

  **These two promises pull against each other, and the tie is broken toward
  the error message.** A namespace that were genuinely `undefined` at runtime
  could not produce that message — the call would die in the engine without
  ever reaching the sim, which is the only part that knows which module is
  missing. So module namespaces are optional in the *type* and always present
  at *runtime*. `bot.scanner?.scan(2)` typechecks and reports properly; the
  price is that `if (bot.scanner)` is true whatever the chassis carries, so
  runtime feature detection reads `modules` from a bot view instead.

## Architecture

Three parts, each testable alone.

**Simulation.** Pure TypeScript, no rendering. `World` holds the tile grid,
entities, inventories. `tick()` advances one step: machines process, conveyors
shift, in-progress bot actions count down. Deterministic and seedable. A save
is seed + script files + tick count. Headless tests: run 10,000 ticks, assert
the crate holds 40 wheat.

**Player scripts.** One Web Worker per bot. The worker exposes the API as
globals. A call like `bot.move("east")` writes a command into a
SharedArrayBuffer and blocks on `Atomics.wait`. The sim reads it on the next
tick, executes over N ticks, writes the result, calls `Atomics.notify`. The
script resumes. A per-tick CPU budget terminates workers stuck in loops with no
world calls; the bot shows a "hung" icon.

Constraint: `Atomics.wait` requires COOP/COEP headers on the page.

**Renderer.** PixiJS reading a world snapshot each frame, never mutating.
Rendering as a pure view means the sim can run faster than realtime.

**Editor.** Monaco with the API as a `.d.ts` for autocomplete and hover docs.
Hot-reload on save restarts only that bot's script.

## Failure is content

Every failure has a world-side signal. Only code errors get editor help.
Coordination errors get world feedback only, forcing a hands phase.

| What went wrong | In the world | In the editor |
|---|---|---|
| Runtime error | Bot stops, spark icon, hover shows message | Line highlighted, error in bot console |
| Infinite loop, no world calls | Spinning "hung" icon | Script paused, "Bot 4 hung on line 12" |
| Two bots want one tile | Both wait, red collision marker | Nothing, by design |
| Conveyor jammed, crate full | Items pile up, belt turns amber | Nothing, by design |
| `receive()` blocked forever | Bot idles with radio icon | "waiting for message" |

Debug tools are hardware too. Early: Blackbox module records `bot.log()` and
the last 50 actions with a timeline scrubber. Late: Overseer colony upgrade,
a fleet-wide view of moving/blocked/hung bots with click-to-script.

No crash is fatal. Hung bots reset. Scripts edit while others run.

Note: the full error catalogue will be derived from the playable, post hoc.

## First playable scope

Proves one thing: the blocking-script loop feels good and the cycle 1 to
cycle 2 abstraction jump happens naturally.

In scope:

- 32x32 world, grass and soil only, one item (wheat)
- One bot, second unlocked by research
- Modules: harvester, planter, scanner, storage crate, radio
- Research Console as the only machine
- Monaco with full `.d.ts`, one script per bot, hot-reload
- Bot console panel, spark and hung icons
- Fast-forward and pause

Out of scope: conveyors, builder arm, blueprints, `import`, save/load beyond
localStorage, art beyond coloured squares.

## Testing strategy

1. Sim unit tests (Vitest, headless). Build a world, push commands, tick,
   assert state. Hundreds of them; most game logic lives here.
2. Script harness tests. Run real player scripts against the sim in a Node
   worker using the same SharedArrayBuffer protocol. Assert "reference harvest
   loop fills the crate in under 400 ticks." Doubles as balance and API
   regression testing.
3. Playtests, one beginner and one veteran per build. Beginner: time to first
   loop unaided. Veteran: reach second-bot research before boredom. Those two
   numbers are the build's score.

## Milestone order

1. Sim core with tests
2. Worker protocol (SharedArrayBuffer + Atomics)
3. Monaco wired to the sim
4. PixiJS renderer (coloured squares until the loop is proven)

## Open questions

- Exact tick costs per action (tune in playtests)
- Whether `colony.bots()` read access includes another bot's inventory or only
  position (leaning: both)
- ~~Whether the sim runs on the main thread or its own worker (decide when
  measuring frame budget)~~ **Answered 2026-09-15, milestone 4 Task 8: the main
  thread.** Worst measured frame — harvest loop at 4x with every soil tile
  planted — is 1.71 ms of a 16.6 ms budget, split 0.17 ms sim, 0.65 ms scene
  update, 0.89 ms render. Revisit if the world grows by an order of magnitude.
