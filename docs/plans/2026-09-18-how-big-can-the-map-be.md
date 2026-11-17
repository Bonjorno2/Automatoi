# How big can the map be

Date: 2026-09-18
Status: measurement, run before committing to a milestone

Not a plan. This is the revisit the design document asked for, run before
designing anything, because the feature it is meant to inform — *the map grows
and the factory sprawls* — is worth nothing if the page cannot draw it.

**The question.** The design's last open question, answered 2026-09-15 in
milestone 4: *"the main thread. Worst measured frame — harvest loop at 4x with
every soil tile planted — is 1.71 ms of a 16.6 ms budget, split 0.17 ms sim,
0.65 ms scene update, 0.89 ms render. **Revisit if the world grows by an order of
magnitude.**"* The world is 32x32. An order of magnitude in area is 128x128.

**The method.** Two halves, because they need different rooms.

- `tests/bench/world-size.bench.ts` — the sim's own per-frame work, headless,
  under `npm run bench`. Best-of-seven batches of 200 calls, after a hundred
  warm-up calls. It confirms itself against a number already in the tree:
  `main.ts` records `snapshot()` at 0.0079 ms on 1024 tiles from milestone 4, and
  this harness measures 0.008 ms.
- The page, at `?perf&size=N`, driven by hand. The Browser pane delivers no
  `requestAnimationFrame`, so frames are run on purpose — 160 of them at 14 ms,
  filling the 120-frame window `perf()` averages over. An **idle** world: no
  script running, nothing planted outside the 13x13 field. That isolates the cost
  of *area* from the cost of *content*, which is the variable in question.

`?size=` is the one line of product code this needed and it is kept:
`SessionOptions.size`, read from the query string beside `?perf`. A number typed
into a source file for an afternoon is a number somebody eventually commits.

---

## The numbers

| world | tiles | steady frame | `snapshot()` per frame | zoom rebuild |
|---|---|---|---|---|
| 32x32 | 1,024 | 0.56 ms | 0.015 ms | **1.5 ms** |
| 64x64 | 4,096 | 0.54 ms | 0.129 ms | **10.7 ms** |
| 128x128 | 16,384 | 1.17 ms | 0.691 ms | **52 ms** |
| 256x256 | 65,536 | **8.43 ms** | 3.145 ms | **202 ms** |

Steady frame is `pass + draw`, the same split `?perf` reports. Everything scales
with area rather than with width, which is what it should do and is worth saying
because it means these four rows predict the fifth.

## The verdict

**128x128 works today and needs no performance work at all.** 1.17 ms of a
16.6 ms budget is 7%, against 3.4% at 32x32 — both comfortable, and the headroom
that absorbed a 4x harvest loop in milestone 4 is still there.

**256x256 does not.** 8.43 ms is half the frame budget on an *idle* world, before
a single bot is working or a single tile outside the field is planted. It would
not survive the game's own 4x.

So the map can grow sixteenfold for free, and sixty-fourfold for a milestone's
work. **The design question is not constrained by the engine** — 128x128 puts a
bot 60 tiles from the far corner, which at 2 ticks a tile is a 120-tick walk, or
about one harvest round of pure travelling. That is more than enough distance for
a belt to be worth laying, which is the pressure the whole idea is after.

## The two costs, named

Neither is mysterious and neither is a rewrite.

**1. `snapshot()` allocates a fresh object per tile, every frame.** `draw()` calls
it once per frame, and it does `this.tiles.map((t) => ({ terrain, crop }))` — 1,024
objects a frame today, 65,536 at 256x256. It is the largest single item in the
frame at every size, and the jump from 128 to 256 is worse than linear (4x the
tiles, 7x the draw cost), which is the shape of garbage collection rather than of
work.

It is also the easiest to fix, because **terrain never changes during a game** and
crops change only on a tick. The per-frame copy is re-deriving, sixty times a
second, a thing that changes at most twenty times a second and mostly not at all.

**2. `drawTerrain` redraws every tile on every geometry change.** It is a single
`Graphics`, built once and never touched per frame — that part is right, and it is
why the steady numbers stay small. But it runs two full passes over the whole map
on every wheel notch and every window resize, and nothing culls to what the camera
can see. 52 ms at 128x128 is three dropped frames on a zoom, which is a
perceptible hitch; 202 ms at 256x256 is a freeze.

**This is the one number that would be felt before the frame budget is.** A player
on a 128x128 map meets it every time they scroll the wheel.

## A third thing, found by walking

The camera frames what is *occupied* when the page opens — `frameView(occupiedRect(snap), ...)`
— so a bigger map opens on the farm rather than on a speck, at the same tile size
whatever the world is. That is already right and needs nothing.

What is not right: **the camera does not follow the bot, and on a big map the bot
leaves.** Thirty tiles east of the field, driven here from the console, and it is
simply off screen with nothing on the canvas indicating where it went. On a 32x32
map that cannot really happen; on a 128x128 map it is the first thing that will.
It is a design question rather than a defect — follow, or an edge-of-screen
indicator, or the fleet list becomes how you find a bot — and it belongs to
whichever milestone makes the map big.

## What this means for the milestone

- **Take 128x128.** It is free, it is sixteen times today's area, and it is enough
  distance to make hauling a real problem.
- **Fix the zoom rebuild in the same milestone**, because it is the cost a player
  actually feels, and 52 ms is already over the line. Culling the terrain to the
  camera is the obvious answer and it is contained in one file.
- **Leave `snapshot()` alone for now, and write down why:** at 128x128 it is
  0.69 ms of a 16.6 ms frame. It is the thing to fix if the map ever goes past
  128, and it is not the thing to fix first.
- **Nothing here blocks the design work**, which was the question this was run to
  answer.
