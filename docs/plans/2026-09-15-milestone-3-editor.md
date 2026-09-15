# Milestone 3: Monaco Wired to the Sim

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A player opens a page, sees the two-line opening script in Monaco with working autocomplete, presses Run, and watches the bot harvest and step east at a speed a human can follow — logs streaming into a per-bot console, errors landing on the right line, and Ctrl+S restarting only that bot's script.

**Architecture:** The milestone-2 bridge is reused unchanged in substance. What changes is where it runs and what drives it. The `World` and the `ScriptColony` live on the browser's main thread; each bot's script still lives in its own worker, still blocks on `Atomics.wait`. Two seams get introduced: a **worker seam** so the same host code spawns `node:worker_threads` under Vitest and web `Worker` in the page, and a **clock seam** so the same host ticks on demand under Vitest and at a fixed rate in the page. Monaco is a view over a script string; Run is `colony.run(botId, source)` and hot reload is `stop` then `run`, which milestone 2's Task 10 already made safe.

**Tech Stack:** Adds Vite 5 (dev server and bundler) and `monaco-editor`. TypeScript 5 strict ESM and Vitest 2 as before. **No renderer** — milestone 3's world view is a text readout. PixiJS arrives in milestone 4.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md`, sections "API shape", "Architecture", "Failure is content" and "First playable scope". **Milestone 2 reference:** `docs/plans/2026-09-11-milestone-2-worker-bridge.md`, especially "The import rule, which is load-bearing", which still governs every file in the worker's import graph.

---

## Decisions already made

These were settled before this plan was written. Do not relitigate them mid-task.

1. **The sim runs on the main thread.** The design doc lists this as an open question. It is resolved *provisionally* for this milestone, because there is no renderer yet and therefore no frame budget to measure. Milestone 4 revisits it with numbers. This is safe today for a reason verified below: the host never calls `Atomics.wait`.
2. **Real-time pacing is in scope; interpolation is not.** The accumulator has two jobs — pacing ticks against a wall clock, and handing a renderer an interpolation alpha. Only the first is meaningful without a renderer, and it is what makes Run feel like a game rather than a batch job. Pause, step and speed control come with it; all three are named in the design's first-playable scope.
3. **Milestone 2's 117 tests must stay green and unedited.** Both new seams are introduced by *adding* an implementation behind an interface whose default is the existing behaviour. If a milestone-2 test needs editing to pass, the seam is wrong — fix the seam, not the test.
4. **Manual verification enters the project here.** Every milestone so far was headless. A page cannot be fully asserted in Vitest, so tasks that touch the DOM carry an explicit **Manual check** block. Perform it and record the result in the commit body if anything surprised you.
5. **One script per bot, held in memory.** Persistence is `localStorage` at most, and only in Task 10. Save/load beyond that is out of first-playable scope.

---

## Three facts this plan depends on

The first is verified. The second and third are **explicitly not yet verified** and each has a task step that verifies it before anything is built on top.

### Fact 1: a main-thread host is legal (verified)

`Atomics.wait` throws on a browser's main thread. The host never calls it — `host.ts` uses only `Atomics.load`, `Atomics.store` and `Atomics.notify`, all of which are legal anywhere. Only `api.ts`, which runs exclusively inside a worker, calls `Atomics.wait`. So a main-thread `World` + `ScriptColony` is sound as written.

### Fact 2: cross-origin isolation (verify in Task 1)

`SharedArrayBuffer` is only constructible in a page serving:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Task 1 asserts `crossOriginIsolated === true` in the real page before any bridge code is loaded into it. **If this is not true, nothing else in this milestone can work**, and the failure mode is a confusing `SharedArrayBuffer is not defined` deep inside worker startup rather than a clean error at the top.

### Fact 3: `.d.ts` generation (verify in Task 4)

The design requires the editor's type file to be *generated* from `BotApi` and `ColonyApi`, not hand-maintained beside them. The intended mechanism is `tsc --emitDeclarationOnly`. Whether that produces a file Monaco can consume as a single self-contained module — given `api.ts` imports types from `src/sim/types.ts` — is **unverified**. Task 4 Step 1 checks it empirically and picks the fallback if not. Do not build the editor wiring on an assumption here.

---

## Conventions for every task

- Editor and page source lives in `src/editor/`. Bridge changes stay in `src/bridge/`. **`src/sim/` remains unmodified.**
- Tests live in `tests/editor/` or `tests/bridge/`, mirroring the source file name.
- Run `npm run typecheck` before every commit. A commit with type errors is a failed step.
- Commit after each task with the message given. Do not batch tasks into one commit.
- Every test that spawns a worker takes an explicit timeout and terminates its worker in a `finally`, exactly as in milestone 2.
- Never add a feature a later task does not ask for. In particular: no renderer, no tile canvas, no sprites.

## Domain vocabulary

Milestone 2's vocabulary — channel, frame, mirror, seqlock, in flight — carries over unchanged. New terms:

- **Clock.** The policy object deciding whether `world.tick()` happens on a given pass of the drive loop. `DemandClock` ticks iff a command is counting down; `RealtimeClock` ticks on a wall-clock accumulator.
- **Worker seam.** The `spawnWorker` function that hides `node:worker_threads` from `host.ts`.
- **Source line offset.** The integer difference between a line number in a stack trace from `new Function(...)` and the line the player sees in Monaco. Measured, never guessed — see Task 9.

---

### Task 1: A cross-origin-isolated page

Proves Fact 2 before anything depends on it. This is the milestone's highest-risk step and it is deliberately first.

**Files:**
- Add: `vite.config.ts`, `index.html`, `src/editor/main.ts`
- Modify: `package.json` (add `vite`, add `dev` and `build` scripts)
- Test: `tests/editor/isolation.test.ts`

**Step 1: Vite config with the headers**

```ts
import { defineConfig } from "vite";

const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
```

Note both `server` and `preview`. Forgetting `preview` produces a build that works in dev and dies in preview, which is a miserable thing to debug later.

**Step 2: A page that reports isolation**

`index.html` loads `src/editor/main.ts` as a module. `main.ts` writes into a `#status` element:

```ts
const ok = crossOriginIsolated && typeof SharedArrayBuffer === "function";
document.querySelector("#status")!.textContent =
  ok ? "cross-origin isolated" : "NOT ISOLATED — SharedArrayBuffer unavailable";
```

**Step 3: Assert the headers in a test**

The header contract is assertable headlessly by booting the dev server in-process and fetching it:

```ts
import { createServer } from "vite";

it("dev server sends cross-origin isolation headers", async () => {
  const server = await createServer({ configFile: "vite.config.ts" });
  try {
    await server.listen(0);
    const port = server.config.server.port ?? server.httpServer!.address().port;
    const res = await fetch(`http://localhost:${port}/`);
    expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
  } finally {
    await server.close();
  }
}, 30_000);
```

**Manual check:** `npm run dev`, open the page, confirm it reads "cross-origin isolated". If it does not, stop — every later task is blocked, and the cause is the header config, not the code.

**Step 4: Commit**

```bash
git add vite.config.ts index.html src/editor/main.ts tests/editor/isolation.test.ts package.json package-lock.json
git commit -m "chore(editor): vite dev server with cross-origin isolation"
```

---

### Task 2: The worker seam

`host.ts` imports `Worker` from `node:worker_threads`, which does not exist in a browser. The Node and web worker APIs differ in three ways that all have to be hidden: construction (`workerData` vs `postMessage`), message subscription (`.on("message")` vs `.onmessage`), and termination (returns a promise vs returns void).

**Files:**
- Add: `src/bridge/spawn.node.ts`, `src/bridge/spawn.web.ts`, `src/bridge/spawn.ts`
- Modify: `src/bridge/host.ts`, `src/bridge/worker-entry.ts`
- Test: `tests/bridge/spawn.test.ts`

**Step 1: The interface**

```ts
export interface WorkerHandle {
  onMessage(fn: (m: unknown) => void): void;
  onError(fn: (message: string) => void): void;
  terminate(): Promise<void>;
}

export type SpawnWorker = (init: {
  sab: SharedArrayBuffer;
  botId: number;
  source: string;
}) => WorkerHandle;
```

`host.ts` takes a `spawnWorker` in `ColonyOptions`, defaulting to the Node implementation so **every existing test constructs `ScriptColony` exactly as before**. That default is what keeps milestone 2's tests unedited.

**Step 2: `worker-entry.ts` must stop importing `node:worker_threads`**

It currently reads `workerData` at module scope. The web worker has no `workerData`; it receives an init message. Restructure so the entry waits for its init payload from whichever transport it has, then runs. Keep the import rule from milestone 2 in force: this file is in the worker's import graph, so **every runtime import it makes needs an explicit `.ts` extension and must not reach into `src/sim/`**.

**Step 3: Prove both paths agree**

The Node path is covered by the existing suite. Add one test asserting the seam itself: a `ScriptColony` given a hand-written fake `spawnWorker` runs a script and settles, proving nothing in `host.ts` reaches past the interface.

**Step 4: Full suite**

Run `npm test`. Expected: **117 passed**, unchanged. If any milestone-2 test needed an edit, revert it and fix the default instead.

**Step 5: Commit**

```bash
git add src/bridge/ tests/bridge/spawn.test.ts
git commit -m "feat(bridge): worker seam so the host runs in Node and the browser"
```

---

### Task 3: Reconcile the API surface with the design

Three divergences between `api.ts` and the design doc, all small, all of which become permanent the moment Task 4 generates types from them. Settle them here, before that.

**Files:**
- Modify: `src/bridge/api.ts`, and `src/bridge/host.ts` only if `BotView` shifts with it
- Test: `tests/bridge/api.test.ts`

**Step 1: Modules become optional**

The design promises:

> Uninstalled modules are typed `undefined`, so `bot.scanner?.scan(2)` is honest TypeScript.

`BotApi` currently declares `harvester`, `planter`, `scanner` and `radio` as required. Make them optional (`scanner?: { ... }`) and have `makeApi` attach a namespace only when the bot's mirror reports that module installed. The mirror already carries `modules` — see `viewOf` in `host.ts` — so this needs no new protocol.

**The runtime error must survive.** `world.ts` line 140 produces `Bot 3 has no Scanner module`, matching the design's wording exactly. A bot that gains a module mid-script must gain the namespace too; decide and document whether namespaces are resolved per-call or snapshotted at script start, and write the test that pins whichever you chose.

**Step 2: `inventory()` shape**

Design says `[{ item, count }]`; code returns `Record<string, number | undefined>`. **Recommendation: keep the record and amend the design doc**, because `inv.wheat ?? 0` is a better beginner experience than a `.find()`. Whichever way you go, the losing side gets updated so the two agree — this is the one place in this milestone where editing the design doc is correct.

**Step 3: `deposit` / `withdraw`**

These sit ungated on `bot` while the design lists them under the storage-crate unlock, so autocomplete offers them before a crate exists. A crate is a machine, not a chassis module, so there is no hardware namespace to hang them on. **Recommendation: leave the code as is and add a sentence to the design doc** noting that machine-operating verbs live on `bot` directly and fail at runtime with the sim's own message when no crate is adjacent. Confirm that failure message is decent; if it is not, that is a sim finding to record, not to fix here.

**Step 4: Commit**

```bash
git add src/bridge/api.ts tests/bridge/api.test.ts docs/plans/2026-09-11-automatori-design.md
git commit -m "feat(bridge): optional module namespaces, matching the design's typing promise"
```

---

### Task 4: Generate the player-facing `.d.ts`

**Files:**
- Add: `scripts/generate-dts.ts`, `src/editor/generated/player-api.d.ts`
- Modify: `package.json` (a `generate:dts` script)
- Test: `tests/editor/dts.test.ts`

**Step 1: Verify Fact 3 before building on it**

Run `tsc --emitDeclarationOnly` over `api.ts` and look at what comes out. The question is whether the result is self-contained enough for Monaco, given the type imports from `src/sim/types.ts`. Three outcomes, in order of preference:

1. Emitted declarations for `types.ts` and `api.ts` concatenate into one file cleanly → use that.
2. They need import rewriting → do the rewrite in `generate-dts.ts`, mechanically.
3. Emission is unusable → fall back to hand-authoring the `.d.ts` **plus a type-level conformance test** that fails compilation when it drifts from `BotApi`. Generation is preferred, but a hand-written file with a compile-time drift guard honours the design's actual intent.

Record which outcome you got in the commit body.

**Step 2: Wrap it as globals**

Player scripts see `bot` and `colony` as globals, not imports, so the shipped file ends with:

```ts
declare const bot: BotApi;
declare const colony: ColonyApi;
```

**Step 3: A staleness test**

Regenerate into a temp file and assert it is byte-identical to the committed one. This fails the moment someone edits `api.ts` without regenerating, which is exactly when the editor would start lying about the API.

**Step 4: Commit**

```bash
git add scripts/generate-dts.ts src/editor/generated/ tests/editor/dts.test.ts package.json
git commit -m "feat(editor): generate the player API type file from BotApi"
```

---

### Task 5: Streaming logs and scripts that never end

Two assumptions in `run()` hold headlessly and break in a UI, both visible at `host.ts:186-217`. `logs` is a local array returned only when the script settles, so a live console panel would see nothing until the end. And `run()` awaits settlement, but the game's premise is `while (true) { ... }` — a script that never settles at all.

**Files:**
- Modify: `src/bridge/host.ts`
- Test: `tests/bridge/streaming.test.ts`

**Step 1: Callbacks, not a return value**

Add `onLog` and `onSettle` to the options `run` accepts. Keep the returned promise exactly as it is so every milestone-2 test still reads the same way — a forever-script simply never resolves it, which is correct and no longer a problem now that nothing has to await it to see output.

**Step 2: The test that matters**

A script that logs, waits, logs again, and loops forever. Assert the first log arrives **before** the second is produced — i.e. that logs are observed mid-run, not batched. Then `stop()` it and assert a `stopped` settle. Give it a real timeout and terminate in `finally`.

**Step 3: Full suite**

Run `npm test`. Milestone 2's tests must be untouched and green.

**Step 4: Commit**

```bash
git add src/bridge/host.ts tests/bridge/streaming.test.ts
git commit -m "feat(bridge): stream logs and support scripts that never terminate"
```

---

### Task 6: The clock seam

Today `drive()` ticks iff `anyInFlight()`. A game ticks whether or not anyone asked, so crops grow and research advances while every bot idles. Both behaviours have to coexist: the demand-driven one is what makes milestone 2's tick-for-tick assertions deterministic, and deleting it would break the balance tests that are the project's whole regression story.

**Files:**
- Add: `src/bridge/clock.ts`
- Modify: `src/bridge/host.ts`
- Test: `tests/bridge/clock.test.ts`

**Step 1: The interface**

```ts
export interface Clock {
  /** How many ticks to run on this pass. */
  ticksDue(anyInFlight: boolean): number;
}
```

`DemandClock` returns `anyInFlight ? 1 : 0` — precisely today's behaviour, and the default, so milestone 2's tests are unaffected.

`RealtimeClock` accumulates wall-clock time, returns however many whole ticks are due, and **caps catch-up at 8 steps** so a backgrounded tab does not return and simulate ten minutes in one frame. It carries `paused`, `step()` and a speed multiplier. No interpolation alpha — that is milestone 4's, and adding it now would be a feature no task asked for.

**Step 2: Test the clock as a pure object**

Inject a fake `now()` rather than sleeping. Assert: 20 Hz over 1000ms yields 20 ticks; a 5000ms stall yields 8, not 100; paused yields 0 however much time passes; `step()` yields exactly 1 while paused; speed 4 yields four times the ticks.

**Step 3: Full suite**

`npm test`, 117 + new, all green, no milestone-2 edits.

**Step 4: Commit**

```bash
git add src/bridge/clock.ts src/bridge/host.ts tests/bridge/clock.test.ts
git commit -m "feat(bridge): pluggable clock with real-time pacing, pause and step"
```

---

### Task 7: Monaco, mounted

**Files:**
- Add: `src/editor/editor.ts`
- Modify: `index.html`, `src/editor/main.ts`, `package.json`

**Step 1: Mount with the generated types**

Load the `.d.ts` from Task 4 as a raw string (Vite's `?raw` import) and register it via `monaco.languages.typescript.javascriptDefaults.addExtraLib`. The language is **JavaScript, not TypeScript** — the design is explicit that players write real JavaScript — but the extra lib still drives autocomplete and hover docs.

**Step 2: The opening script is the design's opening script**

Seed the buffer with exactly what the design doc promises a new player sees:

```js
bot.harvester.harvest();
bot.move("east");
```

**Manual check — this is the one that tests the design, not the code:** type `bot.` and confirm the completion list shows the installed modules. Confirm `bot.scanner` is flagged as possibly-undefined, which is Task 3's promise made visible. Confirm hovering `move` shows its signature. If autocomplete is empty the extra lib did not register, and no amount of later work will hide that.

**Step 3: Commit**

```bash
git add src/editor/ index.html package.json package-lock.json
git commit -m "feat(editor): Monaco with the player API loaded for autocomplete"
```

---

### Task 8: Run, Stop, and hot reload

**Files:**
- Add: `src/editor/session.ts`
- Modify: `src/editor/main.ts`

**Step 1: Wire the buttons**

A `GameSession` owns the `World`, a `ScriptColony` built with `spawnWorker: spawnWeb` and a `RealtimeClock`, and a `requestAnimationFrame` loop that feeds elapsed time to the clock and drives the host. Run is `colony.run(botId, source)`. Stop is `colony.stop(botId)`. Pause, step and a speed selector drive the clock directly.

**Step 2: Hot reload is stop-then-run**

Ctrl+S restarts only the edited bot. Milestone 2's Task 10 already guarantees this is safe — `resetChannel` abandons the in-flight command and leaves the channel clean — so this is wiring, not new mechanism.

**Manual check:** Run the opening script. The bot should harvest, step east, and stop, at a speed you can watch. Then hold Ctrl+S repeatedly while it runs — restarting mid-command is exactly the case Task 10 was written for, and if the channel corrupts it will show here as a bot that never moves again.

**Step 3: Commit**

```bash
git add src/editor/
git commit -m "feat(editor): run, stop and hot-reload a bot's script from the page"
```

---

### Task 9: The console panel, and errors on the right line

The design's rule is that runtime errors get a highlighted line and a console entry, while coordination failures get world feedback only. Only the first half is buildable without a renderer.

**Files:**
- Add: `src/editor/console-panel.ts`
- Modify: `src/editor/session.ts`
- Test: `tests/editor/line-offset.test.ts`

**Step 1: Measure the source line offset — do not guess it**

`worker-entry.ts` builds the script with `new Function("bot", "colony", '"use strict";\n' + source)`. That prefix, plus the wrapper `new Function` synthesises around the body, means **a stack trace's line number is not the player's line number.** The offset is engine-defined.

Write a test that throws from a known line of a known script, reads the line out of the stack, and asserts the offset. Derive the constant from that test. If Node and the browser disagree, the offset belongs next to the code that builds the function, not in the editor.

**Step 2: The panel**

One panel per bot, fed by Task 5's `onLog`. Render settle status too: `done`, `error` with its message, `hung` with the watchdog's, `stopped`. The design's error table asks for a spark icon on error and a spinner on hung — a text badge satisfies it until there is something to draw on.

**Step 3: Highlight the line**

On `error`, set a Monaco marker at the mapped line. Errors from the sim — `Bot 3 has no Scanner module` — arrive as thrown errors from `call()`, so their stack points at the player's call site and maps the same way.

**Manual check:** run a script with a deliberate `bot.nope()`. Confirm the marker lands on the right line. Then run `while(true){}` with no world call and confirm the watchdog reports hung rather than freezing the tab.

**Step 4: Commit**

```bash
git add src/editor/ tests/editor/line-offset.test.ts
git commit -m "feat(editor): per-bot console panel with errors mapped to source lines"
```

---

### Task 10: The snippet book

Added mid-milestone, on 2026-09-15. Not new scope: the design doc already
promises it in "The abstraction rhythm" — *"A snippet library exists for
beginners to copy from; veterans ignore it."* This gives that line a shape.

It is built **before** the playtest rather than after, so Task 11 can test
whether the book actually helps rather than guessing at its contents once the
only playtest is spent.

Keep it distinct from the *other* don't-repeat-yourself mechanism. `import`
between scripts arrives with the Shared Library colony upgrade, is deliberately
late, and is out of first-playable scope. The book copies **text**; it does not
share a **module**. If it starts grow­ing toward a module system, stop.

**Files:**
- Add: `src/editor/snippets.ts`, `src/editor/snippet-book.ts`
- Modify: `index.html`, `src/editor/main.ts`
- Test: `tests/editor/snippets.test.ts`

**Step 1: Seed it from the design's own progression**

Chips come from the patterns the design doc already names as cycle 1 and cycle
2: the harvest loop, the bounds check that teaches `if` and `bot.pos()`,
serpentine traversal, harvest-and-replant, hauling to a crate. Do not invent a
curriculum — these are the ones the design says a player reaches for.

**Step 2: Every chip must be code that actually runs**

A snippet library that ships broken examples is worse than none. The test
compiles every chip against the generated `.d.ts` from Task 4, and runs the
ungated ones against a real world through the bridge. A chip that needs a
module the starting chassis lacks is labelled with what it needs, which doubles
as a preview of the research tree.

**Step 3: Clicking inserts at the cursor**

Not a clipboard write: insertion needs no permission prompt, works the same in
every browser, and puts the code where the player is already looking.

**Step 4: Commit**

```bash
git add src/editor/ index.html tests/editor/snippets.test.ts
git commit -m "feat(editor): snippet book of copy-paste code chips"
```

---

### Task 11: The first ten minutes, played

Not a coding task. The milestone's actual claim is that the blocking-script loop feels good, and only playing it tests that.

**Step 1: Play the design's opening**

Follow the design doc's "first ten minutes" literally. Press Run on the two-line script. Wrap it in `while (true)`. Watch the bot walk off the field. Add the `bot.pos()` guard. Harvest enough wheat to queue a research.

**Step 2: Record what you find**

Append a "Findings" section to this file. Tick costs that feel wrong, a tick rate that is too slow or too fast to watch, autocomplete that misleads, an error message that does not explain itself. **Do not fix them in this milestone** — record them. The design doc is explicit that the error catalogue gets derived from the playable, post hoc, and that tick costs get tuned in playtests.

**Step 3: Commit**

```bash
git add docs/plans/2026-09-15-milestone-3-editor.md
git commit -m "docs: milestone 3 playtest findings"
```

---

## Done criteria for milestone 3

- `npm test` passes, with milestone 1 and 2's 117 tests **unedited**.
- `npm run typecheck` is clean.
- `src/sim/` is unmodified.
- The page is cross-origin isolated and a real script drives a bot from Monaco.
- Logs stream mid-run; a `while (true)` script runs indefinitely without freezing the page.
- The world ticks at a watchable fixed rate, with working pause, step and speed.
- An uncaught error highlights the correct line; a no-world-call loop reports hung.
- Ctrl+S restarts one bot's script without disturbing another's.
- The generated `.d.ts` matches `BotApi`, enforced by a test.

## What milestone 4 will build on this

PixiJS replaces the text readout, reading a snapshot per frame and never mutating — `world.snapshot()` already exists and is JSON-safe. `RealtimeClock` grows the interpolation alpha it deliberately does not have yet, which is the second half of the accumulator this milestone only half-built.

Two things deliberately deferred:

- **Where the sim runs.** Decision 1 puts it on the main thread provisionally. Milestone 4 is the first time there is a frame budget to measure, and therefore the first time the question can be answered rather than guessed.
- **Crop growth cost.** Every tick currently mutates every planted tile. With a renderer drawing them this becomes the obvious hot path, and the fix is to derive growth from a `plantedAt` stamp instead of mutating. Recorded during milestone 1 as a milestone-4 concern; it is still that.
