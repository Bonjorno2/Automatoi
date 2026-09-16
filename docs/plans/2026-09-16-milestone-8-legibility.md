# Milestone 8: Saying What Is Wrong

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Clear the findings list. Five of milestone 6's eight findings and one of milestone 7's have been carried forward, re-recorded, and deferred — and every one of them is the same shape: *the game knows something and does not say it.* A belt that can never deliver looks like a belt that is briefly full. A ghost about to delete seven ripe wheat says nothing. A fleet of bots can only be read one hover at a time. None of this is a mechanic that is missing; it is a mechanic that is silent.

**Architecture:** Additive and small. One new pure function in `camera.ts`, one flag reusing the `jammed` machinery milestone 5 built, one direction table derived from the one that exists, one cost line in `inspector.ts`, one list in `hud.ts`, and a test that stops guessing. **No new system, no new entity, no new research, and nothing in `config.ts` moves.**

**Tech Stack:** Unchanged. No new dependencies.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — "Failure is content", whose whole table is a promise that every failure has a world-side signal, and the Overseer row of the debug-hardware paragraph. **Milestone 6 reference:** `docs/plans/2026-09-15-milestone-6-conveyors.md`, findings 2, 3, 4, 5 and 7. **Milestone 7 reference:** `docs/plans/2026-09-16-milestone-7-presentation.md`, finding 1.

---

## Decisions already made

1. **This milestone clears the list rather than starting cycle 4.** The design's next real step is blueprints — `stamp`, the fabricator's `spawn(script)`, and `import` between scripts — and it is deliberately not here.

   Milestone 6 recorded eight findings and fixed none. Milestone 7 fixed two of its own and carried six of milestone 6's forward untouched, while adding four more. A findings list that grows faster than it shrinks stops being a record and becomes a ritual: the honest end state of three more milestones like the last two is a document nobody reads because nothing in it has ever been actioned. **Milestone 4's finding 6 — the fleet view — is the proof.** It has now been deferred four times, twice with an explicit promise, and each deferral was individually reasonable.

   The counter-argument is real and should be written down: cycle 4 is where the game gets *better*, and legibility work is where it gets *less annoying*. If this milestone is boring to build, that is the correct feeling and not a signal that the plan is wrong.

2. **A belt that faces no machine at all, while holding something, is `jammed`. A belt held up by a full neighbour is not.** Milestone 6's finding 3 asked for a belt that can say it is stuck, and the sim already has the concept: the flag exists, the snapshot carries it, `heldMarks` turns it into a mark and `describeTile` prints it. A dead-ended belt is a machine with output it cannot put down, which is what `jammed` has meant since milestone 5.

   The second sentence is the one that matters. A backed-up belt is normal, temporary, and caused by something further down the line that is *itself* already flagged — flagging it too would light up an entire working line the instant a mill got busy, and teach the player that the colour means nothing. The rule is about the **layout** being wrong, not about the belt being full: *nothing ahead of it, ever* versus *no room ahead of it, right now*. One predicate, no timers, no new state, and deterministic.

3. **The camera opens on the field, and that is the answer to milestone 6's finding 5 rather than a per-sprite size floor.** Milestone 7's finding 1 split the old problem in two: a narrow window no longer shrinks the world as you resize into it, but the page still *opens* at the whole-grid fit, so a 900-wide window starts at 8 pixels per tile where a belt's arrow is 2.4 pixels and a cargo pip is 0.9 of a radius.

   The grid is 32x32 and the field is 13x13. Opening on what the player actually has — their field, their machines, their bots — rather than on twenty-six columns of empty grass is worth roughly 2.5x in tile size for free, and it is a better first frame on a large monitor too.

   **A per-sprite floor is therefore not planned, and Task 2 is instructed to measure before adding one.** `MIN_ID_SIZE` exists because a digit on a 4.6-pixel chassis was measured to be a smudge; the equivalent measurement for a belt has never been taken, and taking it after the opening view is fixed may well answer "nothing to do". Milestone 4 retired the crop-growth optimisation by measuring rather than implementing it, and that is the precedent.

4. **Placing a machine over a ripe crop stays legal, and gains a price tag.** Milestone 6's finding 2 — ten belts across the field silently ate seven mature wheat — is a *silence* bug, not a permission bug. Refusing the placement would make the field a no-build zone, which is a layout rule nobody decided on and which `build-menu.test.ts` explicitly pins against ("accepts grass as readily as soil" exists for the opposite reason).

   So the ghost says what the click costs, in the same place and the same shape that milestone 7's `removalCost` says what a removal costs. That function was written last for exactly this pattern and this is its second caller.

   **Bare ground still says nothing extra.** Milestone 6's Task 6 decided that "a crop report nobody asked for, while they are aiming at something, is noise", and that reasoning is still right. What was wrong was treating a ripe crop as bare ground.

5. **The fleet view is free, unresearched, and visible from the first frame — which departs from the design.** The design lists the Overseer under "Debug tools are hardware too", as a colony upgrade.

   Two reasons to build it unlocked. The first is that every fact in it is already on the screen: a player can hover any bot and read its position, its cargo, its modules and what it is doing. A fleet list removes the *hovering*, and gating a summary of facts the player can already obtain by clicking, behind bread, is gating tedium relief rather than capability — which is not what "research gates hardware" is for. The second is plainer: this has been deferred four times, and putting a price on it is a fifth deferral wearing a costume.

   What stays hardware is the **Blackbox** — the last fifty actions with a timeline scrubber — because that is genuinely information the world does not otherwise show. If a later milestone wants an Overseer research, that is what it should sell.

6. **The fleet list and the inspector must not have two opinions about what a bot is doing.** `describeBotActivity` is currently private to `inspector.ts`. It gets exported and called, not reimplemented — a second copy would drift the first time a `blockedOn` value was added, and the two would disagree on the same screen at the same moment. This is Fact 2 below.

7. **Nothing here is balance work, and `config.ts` must not move.** Milestone 6's finding 8 — the belt route is 2.29x the hand-haul and the bot has become the mill's servant — is a balance finding and belongs with cycle 4. Milestone 7's finding 3 — the tread scrolls 5.5x slower than the cargo moves — is a judgement its own Decision 4 already argued through, and a rate nobody claimed. Milestone 7's finding 6 — grain that magnifies into blocks — is explicitly to be left alone until somebody complains. **If a task finds itself editing `config.ts`, it has wandered.**

8. **Tests may change, and every edit is named below before it is made.** The rule carries forward from milestones 5, 6 and 7 unchanged: an edit is legitimate when a test asserts something this milestone deliberately changed, and illegitimate when it asserts a mechanic that still holds.

   **Planned edit 1:** `tests/sim/conveyor.test.ts`, the test named "is never reported as starved or jammed". Its assertions stay green — the belt it builds is empty, and Decision 2 only flags a belt that is *holding* something — but its name and its comment claim a belt is never jammed, which is exactly what Task 3 stops being true. It is narrowed to an empty belt and the loaded dead-end case is added beside it. An assertion that still passes under a rule it denies is a worse liability than one that fails.

   **Planned edit 2:** `tests/bridge/first-research.test.ts`'s script body: `bot.wait(15)` and the three comment lines excusing it become a loop on `colony.research.status()`. That is milestone 6's finding 7, and it is the whole of Task 6.

   **Four near misses were checked and are expected to stay green.** `tests/render/inspector.test.ts` arms over `{ x: 20, y: 20 }` three times, twice asserting an exact two lines, which Task 4 would break if that tile carried a crop — **it does not: measured on seed 1, (20, 20) is bare soil**, which is luck rather than design and is recorded here so the next reader does not re-derive it. Task 4 therefore builds its crop cases on `{ x: 18, y: 18 }`, which is ripe wheat on the same seed. `tests/sim/conveyor.test.ts`'s "belt facing the world's edge keeps its item forever" will now set a flag it does not assert on. `tests/render/marks.test.ts` builds its jam case on a mill. And `tests/render/camera.test.ts` tests `fitView`, which Task 1 leaves alone and adds beside. If any of the four breaks, that is information about this plan being wrong, not licence to edit it.

---

## Two facts to verify before building on them

### Fact 1: what tile size does the game actually open at, and does a belt still need a floor? (verify in Task 2)

Milestone 7's finding 1 measured the opening view at **8 pixels per tile in a 900-wide window**, where a belt's arrow is 2.4 pixels, a tread chevron about 1.3, and a cargo pip 0.9 of a radius. That is the number Task 1 is trying to move.

After Task 1, measure again — the same window widths, the same three shapes — and write the numbers down before deciding anything. **Then ask whether a floor is still needed at all.** `MIN_ID_SIZE = 14` was set by measuring a digit on a 4.6-pixel chassis and finding it a smudge; the honest form of this task is the same measurement for an arrow, and "the measurement says no floor is needed" is a legitimate and cheap outcome that should be recorded rather than worked around.

Do not add a threshold and then measure. The order is the point.

### Fact 2: `describeBotActivity` has exactly one definition (verify in Task 5)

Decision 6. Before the fleet list is written, confirm with `rg "blockedOn" src/` that the mapping from a bot's state to a sentence lives in one place, and that the fleet list calls it rather than restating it. A second copy would be two sentences about one bot, on one screen, at the same moment — which is the specific failure the `MACHINE_LABEL` table was introduced in milestone 4 to prevent, one level up.

If exporting it turns out to need a wider signature than `BotSnapshot`, that is a finding about the fleet list wanting something the inspector does not, and it should be written down rather than solved by copying.

---

## Conventions for every task

- Sim work in `src/sim/`, renderer in `src/render/`, page wiring in `src/editor/`, worker-facing API in `src/bridge/`.
- `npm run typecheck` and `npm test` before every commit.
- `npm run generate:dts` whenever `src/sim/types.ts` or `src/bridge/api.ts` changes. Its test will tell you; do not wait for it to.
- Commit after each task with the message given.
- Pure maths in a module with no Pixi import, tested; Pixi calls kept thin around it. Milestone 7's convention, unchanged.
- Rendering thresholds are measured, not guessed.

## Domain vocabulary

- **Dead end.** A belt holding cargo whose facing points at a tile with no machine on it. A layout mistake.
- **Backed up.** A belt whose target exists and is full. Normal, and deliberately not flagged.
- **The opening view.** What the camera shows on the first frame, before the player has touched the wheel.
- **The fleet.** Every bot, as a list. Not a data structure — the world's own bot order, read from a snapshot.

---

### Task 1: The game opens on the field

Milestone 7's finding 1, and first because Task 2's measurement depends on it.

**Files:** modify `src/render/camera.ts`, `src/editor/main.ts`; test `tests/render/camera.test.ts`

A `frameView(rect, grid, pane)` beside `fitView`: the largest whole tile size at which `rect` fits the pane, and the pan that centres `rect` rather than the grid. Everything it returns goes through `clampView`, so it cannot produce a view the camera would otherwise refuse, and it is capped by `ZOOM.max` so a one-tile world does not open at four hundred pixels per tile.

**The rectangle is derived from the snapshot, not from `FIELD_RADIUS`.** The bounding box of everything the player has — soil tiles, machines, bots — plus a one-tile margin. Reading `FIELD_RADIUS` and the console's position would be a second opinion about where the field is, and it would be wrong the moment a player builds outside it; a bounding box over the snapshot cannot disagree with what is drawn. This is the same discipline `fieldLines` follows and for the same reason.

`main.ts` uses it for the initial view only. **`Home` still goes to `fitView`** — it is "show me everything" and must keep meaning that, which is a property milestone 7's done criteria pinned and this task must not quietly change.

Tests: a rect smaller than the grid opens larger than `fitView` does; a rect equal to the grid gives exactly `fitView`; the result is always clamped and never exceeds `ZOOM.max`; the centre of the rect lands within a pixel of the centre of the pane; a degenerate rect (one tile, or none) falls back to the fit rather than dividing by zero.

**Manual check:** the 900-wide window from milestone 7's finding 1. What is the tile size now, and is a belt's direction readable without touching the wheel?

```bash
git commit -m "feat(render): the camera opens on the field rather than on the grass around it"
```

---

### Task 2: Does a belt still disappear?

Milestone 6's finding 5, which milestone 7 answered with "zoom in" and which Task 1 has just changed the terms of. **This task may correctly conclude that there is nothing to build.**

**Files:** possibly `src/render/palette.ts`, `src/render/actors.ts`; test `tests/render/palette.test.ts`

**Step 1: Verify Fact 1.** Measure the arrow, the tread chevron and the cargo pip at the opening view, at the window widths milestone 7 used. Write the numbers into the commit body whatever they say.

**Step 2, only if the measurement asks for it:** the arrow's geometry becomes a pure function of tile size — `arrowMetrics(size)` returning the tip, back and half-width `drawArrow` uses — with a floor in absolute pixels, clamped so it can never exceed the tile it is drawn in. `cargoPips`' `max` becomes a function of size for the same reason: fewer, larger pips beat four dots that merge.

If the measurement says no floor is needed, commit the measurement and the reasoning with no code change, the way milestone 4 retired the crop-growth optimisation. **A task that produces a number and no diff is a successful task here.**

`MACHINE_STYLE.conveyor.body` is drawn once per sprite and `resize` destroys every sprite, so a size-dependent body is safe — that invariant is described in `actors.ts` and this would be the first thing to lean on it.

```bash
git commit -m "test(render): what a belt is worth in pixels, now that the camera opens on the field"
```

---

### Task 3: A belt that cannot deliver says so

Milestone 6's finding 3. Per Decision 2 this is a few lines of sim and no new concept.

**Files:** modify `src/sim/world.ts`; test `tests/sim/conveyor.test.ts`

In `advanceConveyors`' give phase, the branch that already exists — a belt holding something whose facing points at no machine — sets the flag through the same `flag` helper every other machine uses, so the edge-triggered `jammed` event fires once rather than every fourth tick. A belt that is empty, or whose target exists, clears it.

**Clearing happens inside the step, not after it.** A belt only reconsiders its situation every `CONVEYOR_TICKS`, and a flag that cleared on a tick the belt did not run on would flicker at a quarter of the frame rate.

The renderer needs nothing: `heldMarks` reads `machine.jammed` and `describeTile` prints it, both keyed by machine rather than by kind. **Check that the sentence reads correctly for a belt** — "jammed — no room for the output" is a mill's problem, and a dead-ended belt has room and nowhere to put it. If it reads wrong, the message belongs in a small `Record<MachineKind, string>` beside `MACHINE_LABEL`, which is the shape this codebase already uses for exactly this.

Per Planned edit 1, "is never reported as starved or jammed" is narrowed to the empty belt it actually builds, and the loaded case joins it.

Tests: a belt facing bare ground with cargo is jammed; empty, it is not; facing a full mill it is not jammed (the mill is); facing the world's edge with cargo it is; the flag clears the step after the tile ahead gains a machine; the event fires once rather than per step; milestone 6's Fact 2 — equal arrival ticks whichever end the line was built from — still holds.

**Manual check:** rebuild milestone 6's wrong-facing corner — a line that stops, with the mill beyond it starved. Two marks are now on screen. Which one do you look at first, and does it send you to the right tile?

```bash
git commit -m "feat(sim): a belt with nowhere to put its cargo is jammed, like everything else"
```

---

### Task 4: The ghost says what it is about to cost

Milestone 6's finding 2. Ten belts across the field ate seven mature wheat and the only trace was a counter falling from 119 to 112.

**Files:** modify `src/render/inspector.ts`; test `tests/render/inspector.test.ts`

`describePlacement` gains one case, in the shape milestone 7's `removalCost` established and directly under the verb for the same reason:

```
Place Conveyor (facing north)
  click to place
  destroys ripe wheat
```

A growing crop is named as growing, because the cost is different and the player may well not care. Read the ripeness through the same `CROP_GROWTH` lookup `describeTile` uses, not a second comparison against `WHEAT_GROWTH_TICKS`.

Per Decision 4, bare ground is unchanged and the placement is still legal. Per Planned edit 1's near-miss note, the existing empty-ground tests are **not** edited and the new cases are built on `{ x: 18, y: 18 }`.

Tests: arming over ripe wheat warns; over a growing crop the wording differs; over `GRASS` nothing is added; over a crop on a tile that is refused anyway the refusal still leads, because a placement that will not happen costs nothing. And one that is really about the sim: `placeMachine` on a cropped tile clears it, so the warning and the consequence are pinned together rather than separately.

```bash
git commit -m "feat(render): the ghost names the crop it is about to delete"
```

---

### Task 5: Shift+R, and the fleet

Two small things that share a file and a commit would be wrong to split, because one is three lines.

**Files:** modify `src/sim/world.ts`, `src/editor/main.ts`, `src/render/inspector.ts`, `src/render/hud.ts`, `index.html`; test `tests/sim/world.test.ts`, `tests/render/hud.test.ts`

**First, milestone 6's finding 4: `R` turns one way,** so north to west is three presses. `COUNTER_CLOCKWISE` beside `CLOCKWISE`, **derived from it rather than written out** — a second hand-written table is a second thing to get wrong, and a test asserting they are inverses is cheaper than four rows. Shift+R turns the other way, through `keyTarget` like every other binding since milestone 7's fix. The banner keeps saying `R to turn` and not `R/Shift+R`: it is one line, and the second half is discoverable by holding a key that already does something.

**Then the fleet.** Verify Fact 2 first. A `fleetLines(snapshot)` pure function beside `fieldLines` and `researchLines`, one line per bot, **in the world's own bot order** — which is what `botColor` is indexed by, so the list and the canvas agree by construction rather than by coincidence.

Each line: the bot's number, its colour, what it is doing, and what it is carrying. "What it is doing" is `describeBotActivity`, exported and called.

It goes in the panel's existing `bot` group, which currently holds only the selected bot's cargo bar — a group called "bot" that can only ever describe one is the fleet view's absence, stated in the markup. The selected bot's line is marked, the way the build list marks the armed option.

**Clicking a line selects that bot**, routed through `inspector.onSelect` and not into `selectedBotId` directly — the script store swaps the editor's contents on selection, and bypassing it would show one bot's script while the panel highlighted another. That is the design's "click-to-script", and it is the one thing here that is more than a read-out.

Tests: the two direction tables are inverses for all four directions, and four presses of either returns to the start; Shift+R from north gives west; one bot gives one line; a second appears in deploy order; the line names what the bot is doing for each `blockedOn` value and for idle; a bot carrying nothing says so rather than being blank; the order matches `snapshot.bots`.

**Manual check:** two bots, one running a harvest loop and one deliberately walled in. Can you tell from the panel alone which is which, and which one is stuck?

```bash
git commit -m "feat(render): a fleet list, and a belt that turns both ways"
```

---

### Task 6: The guess comes out of the tree

Milestone 6's finding 7. `colony.research.status()` shipped in milestone 6 specifically so a script would not have to wait a number worked out on paper, and the one test in the tree that waits a number worked out on paper was left alone.

**Files:** modify `tests/bridge/first-research.test.ts`

Per Planned edit 2: `bot.wait(15)` and the comment excusing it become a loop on `colony.research.status()`. The assertions around it do not move — the outcome is still `done`, `planter` is still unlocked, and the tick ceiling is still 400, because this is a balance test and its bar is what it exists to hold.

Worth a task on its own: the measured 172 ticks will change, because a guessed 15-tick wait is almost certainly not exactly the right wait. **Record the new number in the commit body**, and if it moved by more than a little, say why in the same sentence rather than adjusting the ceiling.

This is the only task in the milestone that touches no `src/` file, and that is the point — a removed excuse left its workaround behind.

```bash
git commit -m "test(bridge): the first-research script asks research whether it is done"
```

---

### Task 7: Play it

Same discipline as milestones 3 through 7: play, record, fix nothing — unless what you find is a defect rather than a judgement, in which case fix it with a test and say so, the way milestone 7's findings 2 and 4 were handled.

Specifically, and in this order of interest:

- **Does the player destroy a full crate by accident?** This is the judgement milestone 7's finding-4 fix took on and explicitly could not test, and it is the most likely thing in this codebase to be wrong right now. Remove things quickly, the way somebody dismantling a line does. Did you read the cost line, or did you read it the third time, after it had already cost you something?
- Two marks are now on a stalled line — the jammed belt and the starved mill beyond it. Does the pair send you to the cause or to the symptom?
- Is the fleet list the thing you look at, or is the canvas still faster? A panel nobody reads is a panel that should have been a mark.
- Does the opening view make the first thirty seconds legible, or does it just move the illegibility to a different window size?
- And the question milestones 6 and 7 could not answer and this one still cannot: is laying a line by hand tedious in the way that makes you want to write `layLine(10, "north")`, or tedious in the way that makes you stop?

Append `## Findings from Task 7` in the style of milestones 3 through 7, with the same caveat about who played it — these are mechanical findings from driving the real page, and the design's two scoring numbers still need human playtesters.

```bash
git commit -m "docs: milestone 8 playtest findings"
```

---

## Findings from Task 7

Recorded, not fixed. Driven on 2026-09-16 against seed 1. The same caveat every
milestone since 3 has carried carries forward: these are mechanical findings
from driving the real page, and the design's two scoring numbers — time to first
loop unaided, and time to the second-bot research before boredom — still need
human playtesters. Two of this milestone's own questions are in that category
and are answered below only as far as measurement can reach them.

Nothing here was fixed in place. None of it is a feature that does not work.

### 1. The default facing is north, and a line laid left-to-right is nine dead ends

The single most informative thing in this session, and it was an accident. Arming
the conveyor and laying the natural shape — six tiles rightward, turn, four tiles
down — produced **nine belts, every one of them facing the wrong way**, because
the ghost starts facing north and the first click happens before anybody thinks
about `R`.

The banner said `placing Conveyor (facing north)` the whole time. The ghost drew
a north arrow the whole time. Neither is a lie and neither was read, because the
thing the hand is doing is "drag a line to the right" and the thing the screen is
saying is a compass bearing.

Task 3's flag caught all of it the moment cargo arrived — and that is the second
half of the finding. **Nine belts, nine jam marks.** Decision 2 was careful that a
backed-up line must not light up end to end, and it does not; but a line that is
*wrong* end to end lights up end to end, correctly, and the screen looks exactly
like the thing the decision was avoiding. The information is right and the
presentation does not distinguish "nine problems" from "one problem, nine tiles".

A first facing that defaulted to the last one used, or to the direction of the
previous click, would make the common case free. Neither was built, because this
is a finding and not a fix.

### 2. The removal cost is words, and the ghost says nothing

Milestone 7's finding-4 fix let the player's hands destroy a machine's contents
and rested the whole argument on the cost being under the cursor first. It is —
and it is the third line of six, under two lines that are **identical** to the
harmless case:

    Remove                          Remove
      click to remove                 click to remove
      destroys 16 wheat             Conveyor
    Storage Crate                     facing west
      holding 16 wheat                holding nothing
    soil                            soil

The banner is the same sentence in both cases. The ghost is the same colour in
both cases, because its colour comes from `reason === null` and both are legal.
So every channel a player is actually looking at while dragging a cursor — the
shape under the hand, the colour, the banner — is silent, and the one channel
that speaks is a line of text in the middle of a tooltip.

Whether that is enough is the judgement milestone 7 explicitly could not test and
this session cannot either: I knew what the line said before I read it. What can
be said is that the guard is carried entirely by the weakest channel available.
A ghost that changed colour when the click would destroy something would move it
to the strongest one, and costs nothing that is not already computed.

### 3. A caged bot reads as idle, because the sim has no word for bumping

Task 5's manual check asked whether the panel alone tells you which of two bots
is stuck. It does not. A bot walled in by four belts shows
`move north — 1 of 2 ticks left` while each doomed move is in flight and `idle`
between them, which is exactly what a bot whose script has ended shows.

The fleet list is faithful: `blockedOn` is only ever `"bot"` or `"radio"`, and
walking into a machine sets neither. Milestone 4's `bump` event fires and paints
a fading mark, so the *canvas* says something for about 420 ms and the *panel*
says nothing, ever. This is the one finding here that is a gap in the sim rather
than in the presentation, and it is the design's own "Failure is content" table
promising a world-side signal for a state the world does not model.

### 4. The fleet list is a header and one row for the whole opening

Measured rather than judged: the panel now opens with a `fleet` group containing
exactly one row, `bot 1 idle · empty`, stating three facts the canvas states
better — there is one bot, it is gold, it is doing nothing. It earns its place at
two bots and is furniture at one.

That is not an argument against building it, and the deferral history is the
reason: it was put off four times precisely because at one bot it is never quite
worth it, and the milestone where it is worth it is always the next one. But a
first-run player meets it at its least useful, and a group that appeared at the
second bot would meet them at its most.

### 5. Clicking an occupied tile does nothing, and that is still right

Ten clicks produced nine belts: the tenth was the Research Console's tile, the
ghost was red, and the click did nothing at all — no mark, no status line, no
cancelled placement. Milestone 5 decided that deliberately, so that misclicking
the edge of a crate does not cost a player their whole placement, and laying a
line straight into the console is exactly the case that vindicates it. Recorded
because it looked like a bug for about five seconds while counting.

### 6. The opening view is 40 pixels per tile in a full window

Task 1's number at the size this was driven at, for the record, against
milestone 7's measured 8 at a narrow one. The field fills the pane, the wheat
reads as wheat, and nothing needs the wheel. The narrow-window case is Task 2's
table.

---

## Done criteria for milestone 8

- `npm test` and `npm run typecheck` clean, with the two named test edits and no others.
  > **Met.** 560 tests, typecheck clean, up from 538. Both planned edits were
  > made and nothing else in `tests/` lost an assertion — the `conveyor.test.ts`
  > title that denied Task 3's rule, and the `first-research.test.ts` script
  > body.
- **Milestone 6's findings 2, 3, 4, 5 and 7 are closed, and milestone 7's finding 1 is closed.** Finding 5 may be closed by measurement rather than by code, per Decision 3, and if so the measurement is in the commit.
  > **Met, all six.** Finding 5 closed by measurement with no threshold added,
  > exactly as Decision 3 reserved: the framed opening view is ~2.1x the fit, the
  > arrow clears the six pixels milestone 6 measured and accepted at every pane
  > width of 240 or more, and what shipped is a regression guard rather than a
  > constant. Task 2's commit has the table.
- **Milestone 4's finding 6 is closed in full**, not in half: a player can watch a fleet without hovering it one bot at a time, and can click a bot in that list to edit its script.
  > **Met, and immediately qualified by finding 3.** The list exists, it is in
  > the world's bot order, its colours are `botColor`'s own, and a click selects
  > the bot and swaps the editor. What it cannot do is say a bot is stuck
  > against a wall, because the sim has no such state — so "watch a fleet" is
  > true for what the sim models and false for the case a player most needs it.
  > Recorded rather than fixed, and it is the first thing milestone 9 takes.
- A belt facing nothing is jammed; a belt facing a full machine is not; and the difference is a test.
  > **Met**, and the "full machine" test is worth its own note: the first version
  > used a mill, which eats three wheat the moment it is filled and therefore
  > made room, so the case under test never happened. A crate holds still.
- Arming a placement over ripe wheat says the wheat will be destroyed, and arming over bare ground still says nothing extra.
  > **Met**, driven through the real build menu. The consequence is pinned beside
  > the warning — `placeMachine` clearing the crop is now a test — so the two
  > cannot part company.
- Shift+R turns the other way, and `CLOCKWISE` and `COUNTER_CLOCKWISE` are proved inverses rather than both written out.
  > **Met.** And finding 1 says the more interesting thing about rotation: the
  > problem is less which way `R` turns than that the first belt of every line
  > goes down facing north.
- The game opens on the field, `Home` still shows the whole grid, and the opening tile size is recorded against milestone 7's measured 8 pixels.
  > **Met.** 8 to 19 in the 900-wide window finding 1 measured, 40 in a full one,
  > and `Home` was pressed on the page rather than assumed: 19 back to 8, which
  > is the plain fit to the pixel.
- No test waits a hand-computed number for a research it could ask about.
  > **Met.** 172 ticks became 166 — the guess was six ticks long, which is what a
  > guess is.
- `config.ts` is untouched, per Decision 7. **This is a criterion and not a note:** every remaining finding that would move it is balance work, and a legibility milestone that quietly retuned the game would make its own playtest unreadable.
  > **Met, verified rather than asserted:** `git diff` across the whole milestone
  > touches no line of `src/sim/config.ts`.

## What this deliberately does not do

**Cycle 4** — blueprints, the fabricator, `import` — per Decision 1. **Milestone 6's finding 8**, the bot becoming the mill's servant, which is balance and belongs with cycle 4. **Milestone 7's finding 3**, the tread scrolling slower than the cargo, which its own Decision 4 argued through and which claims no rate. **Milestone 7's finding 6**, grain that magnifies into blocks, which is to be left alone until somebody complains and fixed against a screenshot rather than a paragraph. **Day/night**, still. **A confirmation dialog on removal**, unless Task 7 finds the cost line is not enough — and if it does, the answer is a confirmation on a machine holding a lot, not a retreat to the rule that bricked a world.

## What milestone 9 inherits

**Finding 3 first, and it is sim work rather than panel work.** A bot that walks
into a machine reads as idle, in the panel this milestone built specifically so a
player could tell one bot from another at a glance. `blockedOn` models two ways
of being stuck and there are three. It is the design's own "Failure is content"
table promising a world-side signal for a state the world does not have.

**Finding 1 is the cheapest thing here**: a ghost whose first facing is the last
one used would make the common case free, and nine dead-end belts in a row is
what the current default costs.

**Finding 2 is one colour.** The remove ghost is the same colour whether the
click is free or costs sixteen wheat, and the cost is carried entirely by a line
of text in the middle of a tooltip. Moving it to the ghost costs nothing that is
not already computed.

**Finding 4** — the fleet group is furniture at one bot — is the one to leave
alone unless it annoys somebody. Hiding it until the second bot is easy and
would mean the panel changes shape underneath a new player, which is its own
cost.

## What milestone 9 will build on this

Cycle 4, with an empty findings list behind it and a fleet the player can see.

The design's blueprints are a player-authored `stamp(layout, at)` built on the `place()` milestone 6 shipped, the fabricator's `spawn(script)` so a stamped factory arrives with the bot that runs it, and `import` between scripts — which the design holds back until one file per bot is genuinely miserable, and a fleet laying belt routes is where that starts.

Two things this milestone hands it, both worth deciding deliberately rather than discovering:

**The arm cannot remove a loaded machine and the hands can.** A blueprint script that re-lays a route will meet `conveyor is not empty` constantly, and its only recourse is `bot.withdraw` into the bot's own cargo — a real answer and a tedious one. Whether a stamp should be allowed to do what the player's hands can do is a cycle 4 question.

**And milestone 6's finding 8:** the belt route is 2.29x the hand-haul, and what is left is harvesting and the mill's own rate. A bot that sweeps a row and then stands at a belt is a bot asking for a second bot, which is what makes the fabricator the right next machine rather than a bigger mill.
