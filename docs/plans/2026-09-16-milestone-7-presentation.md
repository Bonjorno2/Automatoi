# Milestone 7: Presentation

**Goal:** The game stops looking like a debug view of a simulation and starts looking like a place. Nothing about what the world *does* changes; everything about how it *reads* does. A player who opens the page should want to watch it before they want to program it.

**Architecture:** Additive. Milestone 6 is being built in parallel in the main tree and has already touched every file in `src/render/`, so this milestone adds new modules that existing files opt into in one or two lines, rather than rewriting them. Four new modules — `camera.ts`, `motion.ts`, `effects.ts`, `texture.ts` — and small, named edits to `tiles.ts`, `actors.ts`, `stage.ts` and `main.ts`.

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

Append `## Findings from Task 9` in the style of milestones 3 through 6.

```bash
git commit -m "docs: milestone 7 playtest findings"
```

---

## Done criteria for milestone 7

- `npm test` and `npm run typecheck` clean.
- The measured frame total is recorded, before and after, and is under 8 ms.
- Crops sway, belts run, working machines look worked, and none of it carries information that is not also carried statically.
- A camera zooms and pans, the inspector still names the right tile at every zoom, and `Home` reproduces the old view exactly.
- Nothing in `src/sim/` changed except, possibly, one new event kind for Task 6.
- No new dependency, and no asset loaded from disk.

## What this deliberately does not do

**Day/night**, per Decision 8. **Sub-tile item positions on belts**, which milestone 6 Decision 5 settled and which a polish pass has no standing to reopen. **Sprites or a texture atlas** — the moment art comes from files, the game needs an art pipeline, an artist and a licence story, and none of those are a rendering problem. **Sound**, which is a whole milestone and probably a better one than this.
