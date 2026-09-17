# The opening, handed over one line at a time

Answers the two findings the first playtest left open: a beginner had no path
from "my loop works" to "something got researched", and the loop arrived on the
second Run, which skipped the hands phase entirely.

## The argument

The design's abstraction rhythm: *"Hands phase: in the world, placing things,
watching bots. Pain is tedium. Mind phase: in the editor, automating the last
hands phase."* A loop handed over before there is any tedium is a **trick**. The
player has not felt the thing the loop relieves, so the relief is somebody else's.

So the opening is now the hands phase, in the editor: move, collect, move,
collect, until the player's own fingers are bored — and *then* the loop. Eight
rungs, each a complete script, each one line at a time, all copy-pastable.

| | Step | Adds |
|---|---|---|
| 1 | Move | `bot.move` |
| 2 | Collect | `harvest` |
| 3 | Again, and again | *nothing — three of them in a row* |
| 4 | Turn at the end of a row | *nothing — and a row down* |
| 5 | Go home and hand it over | `while`, `bot.pos`, `deposit` |
| 6 | Only when you are full | `if`, `inventory` |
| 7 | Ask for something | `research.queue` |
| 8 | Now do all of it, forever | *nothing — the idea* |

## Decisions

1. **Two rungs teach no primitive, and that is the point.** `practice: true` is a
   marked field, not an inference, so a rung that introduces nothing by accident
   still fails the test. Steps 3 and 4 exist to be boring.

2. **Two loops, in the right order.** The walk home is a loop that **stops**,
   which is an easier idea than one that does not, and it stops at a number the
   player can see and click on the map. `while (true)` is the finale, and it is
   the only step whose lesson is an idea rather than a verb.

3. **It advances when you run a step, not when you take one.** It watches the
   primitives, so a player who reads the step and types their own version
   advances just the same. A practice rung asks only that you run *something*,
   which is the whole of its requirement.

4. **The opening owns the floor until it is finished.** Every other rule is a
   reaction to something going wrong, and a beginner being walked through their
   first script does not need to be told their script ended — it is supposed to
   end. Refusing step one ends the whole introduction: somebody who does not want
   to be taught should not be asked eight times.

5. **Alt-click any tile to drop its address in at the cursor.** A modifier rather
   than a mode, available the whole game rather than only while the opening asks
   — by cycle five a planner is full of coordinates and typing them off a
   screenshot is tedium nobody planned. Plain left-click still selects a bot and
   places a machine.

6. **The editor opens empty.** It used to hold the design's `harvest(); move();`,
   which meant the game had already done the only two things its first two steps
   were about to teach.

## Four defects, all found by playing

Every one of these was invisible in the code and obvious within two minutes of
running the thing.

### The first harvest found nothing

`WILD_WHEAT_CHANCE` is 0.7, so six seeds in twenty start the bot on bare soil —
and seed 1, the one the game ships, is one of them. **Every new player's first
`harvest()` did nothing** and the fleet read `idle · empty`, while the design says
"the bot harvests and steps east". World generation now guarantees a crop under
the starting bot. A 70% chance of the opening working is not an opening.

### Queueing a research twice killed the script

`colony.research.queue("planter")` threw `planter already queued`, so a script
with a queue at the top — which is exactly what step 7 teaches — **died on line 1
the second time the player pressed Run**. Pressing Run twice is the most likely
single action in this game.

Same shape as cycle five's finding 1: a documented call, used at a perfectly
reasonable argument, killing the script. Asking for a thing you already asked for
is the definition of idempotent. An unknown name still throws, because that one
really is a typo.

### Taking a step ended the introduction

Accepting a chip and refusing it went through the same `onRetire`, which was
right for the reactive rules and catastrophic here: **taking step one retired the
whole opening.** They are now two different acts — `take` and `retire` — because
an opening step is advanced by running it, not by accepting it.

### "Walk west until blocked" only worked from one side

The prettiest idea in the design and the one that broke. The Console is solid, so
`while (bot.move("west")) {}` stops beside it — but only if the bot is *east* of
it. The serpentine sweeps west past the Console's column on the rows below it, so
from there the same line walked **away** from home to the world's edge and
deposited into nothing: `no machine to the west`, bot at x=0.

The honest version is a walk per axis to the tile below the Console, then one
step north. Four lines instead of two, and it is where the clicked address earns
its place — `17,17` is a number the player can alt-click rather than read off a
screenshot.

Also found this way: the finale walked east into the world's edge and then
straight down it forever — `stuck — 722 commands got nowhere`, research frozen at
7/10 — because its turn dropped a row without reversing direction. The one chip a
player is most likely to leave running and least likely to read.

## Played, start to finish

A fresh save, clicking only Run and the offered chip:

| Step | Wheat | Research |
|---|---|---|
| 1 Move | empty | — |
| 2 Collect | 1 | — |
| 3 Again, and again | 3 | — |
| 4 Turn at the end of a row | 7 | — |
| 5 Go home and hand it over | **empty** — it deposited | — |
| 6 Only when you are full | 1 | — |
| 7 Ask for something | 1 | **planter 7/10** |
| 8 Now do all of it, forever | — | running |

411 ticks to the end of the opening. Thirty-five seconds later the build menu
reads **`Fit planter`** — the design's *"first research unlocks the planter"*,
reached by a player who has only ever clicked Run and one chip.

And the moment the opening finishes, the reactive rules take over: the codebook's
next line is *"The planter has arrived. This is what it does."*

Alt-click verified: cursor after `const home = `, alt-click the Console, buffer
reads `const home = 16, 16` and the status line says `picked 16, 16`.

755 tests pass; `tsc --noEmit` clean; no console errors.

## Known, and left alone

**The finale still runs out of field.** It serpentines south past the soil onto
grass and eventually harvests nothing, which is the same "busy and achieving
nothing" the first playtest recorded as finding 3. It now happens *after* the
planter has arrived, which is the point at which the design intends replanting to
become the answer — so it is no longer a dead end, but nothing yet says so.

**Step 5 is four lines where the design hoped for two.** That is the real cost of
having no pathfinding, and it is stated here rather than hidden: "walk until
blocked" reads beautifully and only works downhill.
