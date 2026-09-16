# Milestone 7: Presentation

**Goal:** The game stops looking like a debug view of a simulation and starts looking like a place. Nothing about what the world *does* changes; everything about how it *reads* does. A player who opens the page should want to watch it before they want to program it.

**Except once, first.** Milestone 6's playtest found a soft-lock — a player who rings their only bot in with belts can never free it, because removal is script-only and the script needs a research the caged bot can no longer pay for. Task 0 fixes that before any of the rest, and it is the one task in this milestone that changes what the game *does*. A polish pass laid over a world that can still be bricked is polish on the wrong thing.

**Architecture:** Additive. Milestone 6 is being built in parallel in the main tree and has already touched every file in `src/render/`, so this milestone adds new modules that existing files opt into in one or two lines, rather than rewriting them. Four new modules — `camera.ts`, `motion.ts`, `effects.ts`, `texture.ts` — and small, named edits to `tiles.ts`, `actors.ts`, `stage.ts` and `main.ts`. Task 0 is the exception and touches `world.ts`, `build-menu.ts`, `inspector.ts` and `main.ts`.

**Tech Stack:** Unchanged. No new dependencies, no asset pipeline, no textures loaded from disk. Everything is drawn with `Graphics` the way everything already is.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md`. Note that the design puts "art beyond coloured squares" **out of scope** for the first playable — that was the right call for proving the loop, and this milestone is the deliberate end of it, not an accident. The loop is proven; six milestones of it exist.

---

## Decisions already made

1. **Motion is the budget, not detail.** The cheapest way to make a static grid look alive is to move it, and the most expensive way is to draw more things in it. A swaying crop costs one `rotation` write against a `Graphics` that already exists; a crop drawn with three stalks and a shadow costs a rebuild of every crop sprite on every stage change, on a field of up to 1024 of them. This milestone therefore spends almost all of its frame budget on transforms and almost none on new geometry.

2. **Animation goes through transforms, never through redraws, wherever a transform will do.** `MachineStyle.body` is drawn once at sprite creation and may only read what cannot change — that rule comes from milestone 6 and is not being relaxed. Anything that animates either lives in a new per-frame layer of its own or rides on `position`, `rotation`, `scale`, `tint` and `alpha` of a sprite that was drawn once. The belt tread is the one thing that genuinely redraws per frame, and it is bounded by the number of belts, which is tens.

3. **Nothing animated may carry information that is not also carried statically.** A player who screenshots the game, or who is looking at the editor when something happens, must lose nothing. The oven's flicker is decoration on top of the progress arc that already says it is working; the harvest burst is decoration on top of the crop disappearing. This is the rule that keeps a polish pass from quietly becoming the only place a fact is stated.

4. **Real time drives decoration; simulated time drives meaning.** `marks.ts` established this in milestone 4 — a mark is feedback to a human and a human's eye does not speed up at 4x. Sway, flicker and tread scroll follow the wall clock for the same reason. The consequence is deliberate and worth stating: at 4x the belts do **not** visually run four times faster. Tread speed says "this is a belt", not "this is how fast the belt is going", and Decision 5 of milestone 6 already settled that items on a belt are a count rather than positions, so there is no rate for the tread to be honest about in the first place.

5. **The camera changes `Geometry` and nothing else.** `geometry.ts` is the one part of the renderer that tests can catch being wrong, and every layer already goes through `toPixel`/`toCentre`/`toTile`. A camera that produces a `Geometry` — a tile size and an origin — therefore works everywhere for free, including the inspector's hit-testing, without a single layer knowing it exists. The alternative, scaling a Pixi container, would put the renderer's idea of where a tile is and the inspector's idea of where a tile is into two different coordinate systems, and they would drift the first time one of them was touched.

6. **Zoom is quantised to whole pixels per tile, like `fit` already is.** The comment in `fit` explains at length why a fractional tile size seams a 1024-tile field and why a fractional origin antialiases every edge into softness. A smooth zoom would reintroduce exactly that. Zoom therefore steps between integer tile sizes. The price is that zooming feels stepped rather than continuous, and that is the same price the game already pays on window resize.

7. **The vignette and the field edge are drawn in screen space, not world space.** They frame the *pane*, not the grid. Panning the camera must not slide the vignette off the corner of the screen.

8. **No day/night cycle.** It is the most obviously "sick"-looking thing available and it is a trap: it changes the contrast of every colour decision recorded in `palette.ts` — the crop `young` green picked for visibility at small tile sizes, the belt body picked to read as floor, the starved/jammed pair picked to read as opposites — and it would do so continuously, so there would be no single lighting condition any of those choices could be verified under. If it is ever built it needs the palette to become a function of light level, which is a milestone, not a task.

9. **Removal by hand is a mode in the build menu, not a new interaction.** Task 0 could have been a key held down, or a right-click on a machine, or a cursor state of its own. It is instead one more `Placement` — the same armed banner, the same ghost, the same `Esc`, the same right-click to cancel — because all of that machinery exists and because Task 7 replaces the coordinate system underneath it. A second way of pointing at a tile would be a second thing for the camera to break, and it would break in the half nobody re-tested. The price is that "Remove" sits in a list of things the player owns, which it is not; it is a tool. The menu says it differently rather than being given a home of its own.

10. **The rule lives in the sim as `canRemove`, and the hands and the arm both ask it.** `canPlace` already carries this discipline with three callers — the ghost that colours itself, the menu's click, and `bot.builder.place` — and milestone 6 wrote the removal rules inline inside `doRemove` instead, where the hands cannot reach them. Task 0 lifts them out. What it must not do is *change* them: the refusals on the console, on a machine holding something, and on a machine part-way through a conversion are what keep this from becoming the milestone where items can be deleted, and a soft-lock is not an argument for deleting items.

    **The residual hole, named rather than hidden:** a cage built of belts that are *carrying* something still cannot be taken apart, because a non-empty machine still refuses. The way out is real and one step longer — a caged bot is adjacent to all four of its walls, and `withdraw` needs no module, so it can empty a belt into itself and then the player's hands can lift the empty belt. Task 9 should try exactly that and say whether a player would ever find it.

11. **The hands remove for free; the arm still pays.** Every other hands-phase action — `placeMachine`, `deployBot`, `installModule` — is instant, because a player's own clicking is not a thing the simulation charges for. `bot.builder.remove` keeps `TICK_COST.remove`, because a script doing it a hundred times is. Two costs for one verb is the asymmetry between a hand and an arm that already exists, not a new one.

---

## Two facts to verify before building on them

### Fact 1: the frame budget can afford this (verify in Task 1, re-measure in Task 8)

Milestone 4 Task 8 measured the worst frame at **1.71 ms** of a 16.6 ms budget — 0.17 ms sim, 0.65 ms scene update, 0.89 ms render — and answered "where does the sim run" with "the main thread" on the strength of it. That answer is load-bearing and this milestone is the first thing since to add per-frame work on the scale of the whole field.

Before the first animated thing is built, record the current number with `?perf` on a fully planted field at 4x. After Task 8, record it again. **If the total clears 8 ms, stop and cut, rather than shipping a game that looks better and stutters.** The `perf` hook and the `?perf` flag already exist in `main.ts`; this milestone does not need to build a measurement, only to use one.

### Fact 2: sway must not make a crop lie about its stage (verify in Task 3)

`cropStage` buckets growth into four heights because "geometry has to change in steps to be noticed at all". A sway that rotates a stalk far enough changes its apparent height, and a stage-2 crop leaning hard could read as a stage-1 crop standing up. Before sway ships, check the extreme: maximum lean at every stage, against an unswayed neighbour of the stage below. If they are confusable, the amplitude is wrong — and amplitude should scale *down* with stage, since a heavy ripe head should sway less than a young shoot, which is both physically right and exactly the direction that fixes the ambiguity.

---

## Conventions for every task

- New render modules in `src/render/`. Pure maths in a module with no Pixi import, tested; Pixi calls kept thin around it.
- `npm run typecheck` and `npm test` before every commit.
- Commit after each task with the message given.
- Timing constants in one exported table per module, never inline, so they can be tuned without reading the drawing code.
- This branch rebases onto `milestone-6-conveyors` when milestone 6 reports done. Prefer new files to edits; where an edit is needed, keep it to the smallest number of lines.

## Domain vocabulary

- **Sway.** Per-crop rotation about its base, driven by wall-clock time and tile position.
- **Tread.** The moving chevrons drawn on a conveyor's surface. Decoration: it does not represent cargo.
- **Burst.** A short-lived particle group spawned from a `WorldEvent`, on the same stream `marks.ts` drains.
- **Fit vs view.** `fit` is the whole grid in the pane, as today. The *view* is what the camera actually shows, which is the fit at a zoom and an offset.

---

### Task 0: The way back out

Milestone 6's finding 1, and first because it is the only thing in this milestone that is not optional. A player who rings their only bot in with belts cannot move it, so cannot harvest, so cannot feed the console, so can never research the builder arm that is the game's only way to take a belt away. The design document promises that no failure is fatal. That one is.

**Files:** modify `src/sim/world.ts`, `src/editor/build-menu.ts`, `src/render/inspector.ts`, `src/editor/main.ts`, `index.html`; test `tests/sim/builder.test.ts`, `tests/editor/build-menu.test.ts`, `tests/render/inspector.test.ts`

**Step 1: One predicate.** Lift the three refusals out of `doRemove` into `canRemove(pos): string | null`, beside `canPlace` and `canDeploy` where the other hands-phase questions live, and add `removeMachine(pos)` as the player-side action that throws what `canRemove` returns — exactly the pair `canPlace`/`placeMachine` already are. `doRemove` keeps its own "no machine to the north" wording, because a direction is what a script asked with and a tile is what a cursor asked with, and it keeps emitting `refused`, which is a bot's signal and not a menu's. The deletion itself — the machine, and its `starved` and `jammed` flags — moves into one private helper both paths call, so the hands cannot leave behind the leak the arm's own test already checks for.

**Step 2: A mode in the menu.** `BuildOption` gains `{ kind: "remove" }`, offered only when the world holds a machine that is not the console. A tool that can do nothing is not an offer, and gating it this way also leaves `buildOptions`' "offers nothing before any research completes" true, which it should be.

**Step 3: A ghost that says take rather than put.** `Placement` gains a mode. In remove mode the ghost draws a cross instead of an arrow, the banner reads `removing — click a machine to take it back, Esc to stop`, and the tooltip's second line says `click to remove`. It needs no new rule for naming what is about to be deleted: milestone 6 already made the tooltip describe an occupied tile as well as the placement, and the only tile removal can act on is occupied.

Green still means the click will work and red still carries the sim's reason, unchanged, because that is a rule the player learned in milestone 5 and the worst possible place to invert it is the one mode that destroys something.

Tests: `canRemove` gives the same reason `removeMachine` throws, for a free tile, the console, a full crate and a working mill; the arm and the hands refuse the same tile for the same reason, which is the anti-drift test this task exists to make possible; a removed machine leaves no `starved` flag behind whichever path removed it; the menu offers Remove only once a removable machine exists; the armed banner and the tooltip say remove rather than place.

**Manual check:** cage a bot in four belts, then take one away with the mouse and walk out. That is the playtest that found this, run backwards.

```bash
git commit -m "feat(editor): take a machine back off the map"
```

---

### Task 1: Measure first, then a ground worth standing on

**Files:** add `src/render/texture.ts`; modify `src/render/tiles.ts`; test `tests/render/texture.test.ts`

**Step 1: Verify Fact 1.** Record the `?perf` numbers on a planted field at 4x, in the commit body.

**Step 2: The ground.** Terrain is currently two shades per type in a checkerboard, which was honest at milestone 4 and is the flattest thing on the screen. Replace the checkerboard with a per-tile shade chosen by a hash of the tile coordinate — deterministic, no RNG, no per-frame cost, drawn into the same single `Graphics` on the same schedule as today.

`texture.ts` holds the hash and the shade selection as pure functions over `(x, y)`. It does not import Pixi.

The soil field also gets an edge: soil tiles adjacent to grass get a slightly darker rim, so the field reads as a worked area with a boundary rather than a brown rectangle. Computed from the snapshot's own tiles, so it cannot disagree with what is drawn.

Tests: the hash is stable for a coordinate and differs between neighbours; every shade it returns is within a bounded distance of its terrain's base colour, so no tile can come out as a bright speck; a tile with no grass neighbour gets no rim.

```bash
git commit -m "feat(render): ground with grain, and a field with an edge"
```

---

### Task 2: Depth

**Files:** add `src/render/texture.ts` additions; modify `src/render/actors.ts`, `src/render/stage.ts`

Two things, both cheap, both drawn once per sprite:

- **Shadows.** A soft dark ellipse under every bot and machine, in a container below the machine container. Bots' shadows move with them, which is one extra `position.set` per bot per frame and nothing else.
- **A vignette**, in screen space per Decision 7, on its own container above everything except the HUD. Drawn once and rebuilt on resize.

The vignette is the single highest ratio of "looks finished" to work in this milestone, and also the easiest to overdo: it should be unnoticeable when looked at directly and obvious when toggled off.

```bash
git commit -m "feat(render): shadows under everything, and a vignette over it"
```

---

### Task 3: The field moves

**Files:** add `src/render/motion.ts`; modify `src/render/tiles.ts`, `src/editor/main.ts`; test `tests/render/motion.test.ts`

**Step 1: Verify Fact 2** before wiring anything.

Wind. `motion.ts` exports `sway(x, y, nowMs, stage)` returning an angle in radians: a sum of two sines at different periods so the field does not pulse as one body, phase-shifted by tile position so the wind crosses the field as a wave, and amplitude scaled down by stage per Fact 2.

`tiles.ts` gains an `animate(nowMs)` that writes `rotation` on the existing pooled crop sprites and touches nothing else. They are already anchored at the bottom-centre of their tile, which is exactly the pivot a stalk rotates about — this is why sway is one line per crop and not a redraw.

`main.ts` calls `tiles.animate(now)` every frame, beside the existing per-tick `tiles.update`.

Tests: sway is bounded by the amplitude for its stage; two adjacent tiles differ at the same instant; the same tile at the same instant is the same value twice (no hidden state); amplitude decreases as stage increases.

**Manual check:** a fully planted field at 1x, watched for ten seconds, reads as wind rather than as jitter.

```bash
git commit -m "feat(render): wind across the field"
```

---

### Task 4: Belts that run

**Files:** add `src/render/animated.ts`; modify `src/render/actors.ts`; test `tests/render/animated.test.ts`

A per-frame layer, between machines and bots, holding one `Graphics` per conveyor. Chevrons drawn along the belt's facing axis, offset by wall-clock time modulo the chevron spacing, so the surface scrolls.

Per Decision 2 this does not touch `MachineStyle.body`, and per Decision 4 it runs at a fixed real-time rate regardless of sim speed. Per Decision 3 it says nothing the arrow does not already say — `drawArrow` stays exactly as it is, one exported function shared with the placement ghost, and the tread is drawn under it.

A belt carrying something scrolls at full contrast; an empty belt scrolls dimmer. That is decoration on top of the cargo pips, not a replacement for them.

The tread offset is a pure function of `(nowMs, size)` in the module, tested; the drawing is not.

Tests: offset wraps within the chevron spacing and never exceeds it; it advances with time; it is identical for the same input twice.

**Manual check:** the four-belt U from milestone 6's Task 5 reads as one running line, and a belt whose neighbour is not a belt does not spill chevrons onto the tile beyond it.

```bash
git commit -m "feat(render): belts that visibly run"
```

---

### Task 5: Machines that are doing something

**Files:** modify `src/render/animated.ts`, `src/render/actors.ts`

The oven glows and flickers while its progress arc is turning; the mill's stones rotate while it is converting. Both are driven off `machine.progress > 0`, which the snapshot already carries, and both stop dead when it is zero — a machine that looks busy while idle is a lie, and per Decision 3 the arc remains the thing that actually says so.

The console's screen gets a slow pulse while research is queued. It is the one machine a player looks at to decide what to do next.

```bash
git commit -m "feat(render): machines that look like they are working"
```

---

### Task 6: Juice

**Files:** add `src/render/effects.ts`; modify `src/editor/main.ts`; test `tests/render/effects.test.ts`

Particles, spawned from the `WorldEvent` stream that `marks.ts` already drains, and decaying in real time for the same reason marks do.

- **Harvest:** a burst of wheat-coloured motes from the tile, drifting up and fading.
- **Placement:** a dust ring where a machine lands.
- **Deposit/withdraw:** a mote travelling between bot and machine, so a hauling loop is visible as flow rather than as two things briefly touching.

`effects.ts` owns a small fixed-capacity particle pool — a hard cap, because the one thing a particle system must never do is turn a fast-forwarded harvest loop into a slideshow. Over the cap, the oldest die early.

The step function — position, velocity, age, alpha — is pure and tested. Pixi only reads its output.

Tests: a particle is retired at the end of its life; the pool never exceeds its cap however many are spawned in one frame; step is deterministic for the same inputs; spawning nothing steps nothing.

**Note:** this task depends on which events milestone 6 leaves on the stream. If `harvest` is not an event today, it is added to `events.ts` as one — which is a sim edit, the only one in this milestone, and it is a signal the design's "failure is content" table already implies should exist.

```bash
git commit -m "feat(render): bursts, dust and motes"
```

---

### Task 7: A camera

**Files:** add `src/render/camera.ts`; modify `src/render/stage.ts`, `src/render/geometry.ts`, `src/editor/main.ts`; test `tests/render/camera.test.ts`

Per Decision 5, a camera is a function from `(fit, zoom, pan, pane, grid)` to a `Geometry`. Every layer already consumes a `Geometry` and every layer already rebuilds when it changes, because milestone 6 wired `connectResize` to exactly that fan-out. A camera is therefore a resize that happens for a different reason.

- Scroll wheel zooms about the cursor, stepping between integer tile sizes per Decision 6.
- Drag with the middle button, or space-drag, pans.
- Panning is clamped so the grid cannot be lost off-screen entirely.
- `Home` resets to the fit, which is today's view and must remain one keystroke away.

The clamping and the zoom-about-a-point arithmetic are the whole risk here, and both are pure functions in `camera.ts` with no Pixi import — the same reason `geometry.ts` is a module of its own.

Tests: zooming about a point keeps that point under the cursor; zoom clamps at both ends; pan clamps keep at least a named fraction of the grid on screen; `Home` reproduces `fit` exactly; a zoom of 1 with no pan is `fit` exactly, so the default path is provably unchanged.

**Manual check:** the inspector's tooltip still names the tile under the cursor at every zoom and pan, which is the thing Decision 5 exists to guarantee and the thing that breaks if it is wrong.

```bash
git commit -m "feat(render): a camera you can zoom and pan"
```

---

### Task 8: The page around the canvas

**Files:** modify `index.html`, `src/render/hud.ts`

**Step 1: Re-measure Fact 1** and record it. This is the gate: if the budget is blown, cut from Tasks 4-6 before doing any of this.

The three-column page is functional and unstyled. Type scale, spacing, a real header, a research panel that reads as progress rather than as a list, buttons that look like controls rather than defaults. The canvas is the thing being framed, so the page should recede.

Nothing here changes what any control does. A restyle that moves a button is a restyle that invalidates the milestone 3, 5 and 6 playtests.

```bash
git commit -m "feat(editor): a page that frames the game"
```

---

### Task 9: Look at it

Same discipline as every milestone since 3: play it, record what you find, fix nothing unless it is a defect.

Specifically:

- **Is it legible at 7 pixels per tile?** Every decision in this milestone was made at a comfortable zoom, and the narrow-pane case is the one that has caught every previous renderer assumption. Milestone 6 left the belt-arrow minimum-size question open for exactly this reason; with a camera in hand, the answer may now be "zoom in", and that is a legitimate answer only if the camera is discoverable.
- **Does anything animated read as a signal it is not?** Decision 3's failure mode: a player waiting for a flickering oven to finish when the flicker meant nothing.
- **Does the wind get annoying after ten minutes?** Decoration is judged over the length of a session, not a screenshot.
- Does the vignette survive being toggled off and on — that is, was it doing anything?
- **Can a bot caged in belts that are carrying something get out?** Decision 10's named hole. The route exists — withdraw the cargo, then lift the empty belt — and the question is whether anything on the screen would lead a player to it, or whether finding 1 has simply been made rarer rather than fixed.

Append `## Findings from Task 9` in the style of milestones 3 through 6.

```bash
git commit -m "docs: milestone 7 playtest findings"
```

---

## Findings from Task 9

Recorded, not fixed. Driven on 2026-09-16 against seed 1. The same caveat every
milestone since 3 has carried carries forward, and it bites harder here than
anywhere: these are mechanical findings from driving the real page, and this is
the milestone whose entire subject is how something *looks*. Two of the plan's
own questions — whether the wind is annoying after ten minutes, and whether the
page now makes someone want to watch it — cannot be answered this way at all.
They need a human who did not write it.

### 1. The camera changed what "the narrow pane" means, and half of it is still true

Every previous renderer assumption has been caught by the narrow-window case, so
this was the first thing checked. The answer is now in two parts.

A narrow window no longer shrinks the world as you resize into it: the camera
keeps the zoom you had, and you simply see less. That is right, and it is new.

But the page still *opens* at the fit, so a player whose window is 900 wide
still starts at **8 pixels per tile**, and at 8 pixels the machine detail is
gone — a belt's arrow is 2.4 pixels, a tread chevron about 1.3, and a cargo pip
is 0.9 of a radius. Milestone 6's finding 5 asked for a minimum size and this
milestone's answer is "zoom in", which the plan called legitimate *only if the
camera is discoverable*. It is: the masthead says "wheel zooms · space-drag pans
· Home resets", and that line is on screen before anything else.

So finding 5 is answered rather than fixed, and the honest form of the answer is
that the first thirty seconds of a small window still show an illegible field.

### 2. The camera's keys stop working the moment a control has focus

Measured: zoom to 20-pixel tiles, click `Run`, press `Home` — nothing happens.
Click the canvas or the page background first and the same key fits the grid.
The guard is `e.target === document.body`, which `inspector.ts` already used for
`R` and `Escape`, so this is a convention being inherited rather than invented.

It is worse for `Space` than for `Home`, because `Space` is how a browser
activates a focused button. A player who clicks `Run` and then holds space to
pan is not failing to pan; they are pressing `Run` again. Nothing on screen
explains why, and "click the canvas first" is not a thing anyone will guess.

### 3. The belt tread is far slower than the belt, at every speed

Decision 4 predicted half of this and the numbers are worse than the half it
predicted. The tread scrolls at 0.9 tiles per second on the wall clock. Cargo
moves one tile every `CONVEYOR_TICKS` ticks at 20 Hz, which is **5 tiles per
second at 1x** and 20 at 4x.

So the chevrons crawl while the pips jump whole tiles past them — a factor of
5.5 at normal speed, not only at 4x. The decision's conclusion survives, because
a mismatch that large cannot be read as a rate by anybody. What it does risk is
the opposite reading: a belt whose tread is visibly slow looks like a slow belt,
and milestone 6's finding 8 already records that players will be staring at
belts wondering why the mill is waiting.

### 4. A loaded cage can be escaped, and only a script can do it

Decision 10 named this hole and Task 9 was told to try it. It is exactly as
named, and the exit is real: three belts and the Research Console around a bot,
every belt carrying wheat, and the remove ghost refuses all four — "conveyor is
not empty" three times and "the Research Console cannot be removed" once. The
bot then withdraws the cargo out of a wall into itself, the belt reports
removable, the player's hands lift it, and the bot walks out.

The whole route was driven end to end and it works. The problem is who can find
it. `withdraw` is a script command with no presence in the UI, and the tooltip
that refuses says *"conveyor is not empty"* — which names the obstacle and not
the remedy. So milestone 6's finding 1 is narrowed rather than closed: a player
can always dismantle an empty cage with the mouse, and a loaded one still needs
a line of code. The tooltip is one sentence away from being the fix.

### 5. The vignette is doing something, and it took switching it off to know

The plan asked. With it off the grass reads flat and the pane's corners come
forward; with it on they recede and the field is the brightest thing on screen.
At the strength this shipped with it is genuinely unnoticeable when looked at
directly, which is the brief — and the first value tried, 0.4 over a 0.4 reach,
read as a dark frame drawn around the canvas.

### 6. Zooming in magnifies the grain into blocks

The ground grain is one shade per tile, chosen by a hash. That is what makes it
free per frame, and it means a tile is a flat square of colour at every zoom. At
the fit it reads as ground. At 72-pixel tiles it reads as 72-pixel squares, and
the field looks tiled in a way it did not before the camera existed.

Nothing is wrong and nothing is lost — it is the honest consequence of a per-tile
value. A second, finer hash inside each tile would answer it, and would cost
build time rather than frame time, which is the same bargain Task 1 made.

### 7. The frame budget was never in danger

Recorded so nobody optimises any of this without a number. The heaviest scene
the game can currently produce — 169 crops swaying, 65 loaded belts scrolling,
a mill and an oven working, and a harvest loop throwing particles, all at 4x —
costs **2.278 ms** of a 16.6 ms budget, against the plan's 8 ms gate.

Task 1's identical scene went from 0.230 ms to 1.050 ms, and nearly all of that
0.8 ms is the wind's per-crop rotation. Belts, particles, shadows and the
vignette together are the other 1.2 ms, and only at 65 belts.

---

## Done criteria for milestone 7

- `npm test` and `npm run typecheck` clean.
  > **Met.** 512 tests, typecheck clean. Five test edits across the milestone,
  > each named in the commit that made it: three in Task 0 (a length assertion
  > that became a filter, and the `mode` field two helpers now require), and in
  > Task 2 `stage.test.ts`'s exact consumer list gaining "overlay". Two more
  > tests were written, failed, and turned out to be asserting the wrong
  > property — the grain's luma ordering in Task 1 and the particles' exactness
  > under frame splits in Task 6. Both are corrected in place with the wrong
  > version described, because the reason they were wrong is the finding.
- **A player can take a machine back off the map with the mouse, and milestone 6's finding 1 is closed** — the cage a playtest built can be dismantled by the player who built it, without a script and without a research.
  > **Narrowed, not closed, and the criterion overstated what Task 0 could
  > deliver.** An *empty* cage comes apart with the mouse, which is the common
  > case and the one the playtest actually hit. A cage whose belts are carrying
  > something does not: removal still refuses a non-empty machine, deliberately,
  > because relaxing that is how items start vanishing. The exit exists and was
  > driven end to end in finding 4, and it needs a line of script. The claim
  > should have read "an empty machine", and it is re-recorded for whichever
  > milestone puts the remedy in the tooltip.
- The measured frame total is recorded, before and after, and is under 8 ms.
  > **Met.** 0.230 ms before, 1.050 ms after on the identical scene, 2.278 ms on
  > the heaviest scene the game can currently produce. Finding 7 has the
  > breakdown. All three taken with the same instrument, which does not include
  > the GPU present — see Task 1's commit for why.
- Crops sway, belts run, working machines look worked, and none of it carries information that is not also carried statically.
  > **Met, and the static half was checked rather than asserted.** Idle machines
  > are pixel-identical across frames and working ones are not; the belt tread
  > moves the brightest pixel on an empty belt by 1.6 luma, so the arrow it is
  > drawn over still carries the facing. Finding 3 is the one place where an
  > animation could be *mis*read, and it is a rate nobody claimed.
- A camera zooms and pans, the inspector still names the right tile at every zoom, and `Home` reproduces the old view exactly.
  > **Met, with one word of the criterion wrong.** `Home` reproduces the old
  > view exactly; *zooming all the way out* reproduces its tile size but not its
  > position, because zooming out about a corner leaves the grid in that corner.
  > That is why `Home` exists rather than being a synonym for zooming out, and
  > it is a test. The inspector was checked on the page at the fit, zoomed in,
  > after panning, and zoomed back out. Finding 2 is a real defect against this
  > criterion's spirit: the key works and cannot always be pressed.
- Nothing in `src/sim/` changed except Task 0's `canRemove` and, possibly, one new event kind for Task 6.
  > **Met, exactly.** `canRemove`/`removeMachine`/`takeMachine` in Task 0, and
  > one `harvest` event in Task 6. Task 6 wanted three effects and only that one
  > needed an event: a placement is a machine id the renderer has not seen, and
  > a transfer is already in the snapshot as a bot's `action`.
- No new dependency, and no asset loaded from disk.
  > **Met.** `package.json` is untouched.

## What this deliberately does not do

**Day/night**, per Decision 8. **Sub-tile item positions on belts**, which milestone 6 Decision 5 settled and which a polish pass has no standing to reopen. **Sprites or a texture atlas** — the moment art comes from files, the game needs an art pipeline, an artist and a licence story, and none of those are a rendering problem. **Sound**, which is a whole milestone and probably a better one than this.

## What milestone 8 inherits

Three small things and one real one, in the order they cost a player something.

**Finding 2 is a defect, not a judgement**, and it is the only thing in this
list that stops a feature working. The camera's keys die whenever a control has
focus, and `Space` does something actively wrong there — it presses the button
again. It was left unfixed only because Task 9's rule is to record rather than
repair, and because the guard it inherits is shared with `R` and `Escape` in
`inspector.ts`, so the fix belongs to all three at once rather than to the
newest caller.

**Finding 4 is one sentence of tooltip.** A cage of loaded belts is escapable and
the refusal says "conveyor is not empty", which names the obstacle and not the
remedy. Saying what to do instead would close milestone 6's finding 1 properly
rather than narrowing it, and it is the cheapest thing in this document.

**Finding 1** leaves the opening view of a small window illegible until the
player uses a camera they have been told about but not yet needed. A first-run
zoom that fits the *field* rather than the grid would answer it.

**Finding 6** — grain that magnifies into blocks — is the one to leave alone
until somebody complains. It is the honest cost of a per-tile value, and the fix
is a second hash at sub-tile resolution, which is Task 1's bargain again and
should be made against a screenshot rather than against a paragraph.

And the thing this milestone did not touch: the design's **Overseer fleet
view**, deferred in milestones 4, 5 and 6 and deferred again here. This
milestone gave the player a camera, which makes watching a fleet *possible* and
makes not having a fleet view more obvious, not less.
