# The benchmark harness, and what it says about a second bot

Not a milestone plan. This is the toolkit gap milestone 9 recorded — *"there
should be a way to ask 'did that make the colony faster', and today there is
not"* — built, and then pointed at the question that motivated it.

**Reference:** `docs/plans/2026-09-16-milestone-9-fabricator.md`, finding 2 and
"What milestone 10 inherits".

---

## The fault, measured

Milestone 9 diagnosed it correctly and never put a number on it. The number:

| clock | simulated ticks one worker boot costs |
|---|---|
| `DemandClock` | **1752** |
| realtime 20Hz (the page) | 0 |
| realtime 200Hz | 7 |
| realtime 1000Hz | 36 |

The wall time was ~37ms in every row — it is the same thread boot throughout.
What changes is only how much simulated time the colony burns while waiting for
it, and under the demand clock that is about fourteen harvest rounds. A benchmark
that spawns a bot and then measures the colony is measuring a colony the new bot
has not joined.

## What was built

`tests/bench/harness.ts`, and two things in it.

**The clock.** `measure()` paces the world with `RealtimeClock` at
`BENCH_HZ = 200`, ten times the page's rate. The ratio is the whole decision: at
20Hz a boot rounds to nothing but a 1200-tick benchmark takes a minute of wall
time, and at 1000Hz a boot is a third of a harvest round and starts to be the
thing being measured. 200Hz costs 7 ticks — under 6% of a round — and runs the
scaling benchmark in about six seconds.

**The guard, which matters more.** The harness counts commands *per bot inside
the measured window*, so `everyBotWorked` is false when a benchmark's window did
not actually contain every bot it claims to compare. That is precisely the state
four versions of milestone 9's benchmark were in, and nothing said so. The clock
makes the failure unlikely; the counter makes it loud.

Benchmarks live in `tests/bench/*.bench.ts` and run under their own config with
`npm run bench`. They are **not** part of `npm test`, because they measure wall
time and the main suite starts sixty files' worth of threads —
`cycle-four.test.ts` had already written that down as a hazard, and a
wall-clocked benchmark makes it a correctness problem rather than a nuisance.

### One property worth knowing before writing another benchmark

`colony.run()` drives a loop of its own, paced by `setImmediate`, and the
harness's loop is deliberately slower so it does not starve the worker threads
whose progress is the measurement. So the world advances between two evaluations
of `until`, and **a window boundary overshoots its predicate.** Only the boundary:
the tick accounting is read off `world.time`, not counted by the poller, so the
numbers either side are exact. Under a realtime clock the overshoot is under a
tick anyway.

## The answer

Milestone 9 left this open: *"Whether the colony actually scales is therefore
still an open question, not a settled one."* It is now settled, on seed 1, 30
wheat out of the field, both runs reproducible to within three ticks:

```
alone  : 344 ticks — bot 1: 154 cmds
staffed: 129 ticks — bot 1: 54 cmds, bot 4: 53 cmds
2.67x
```

**A second bot is worth 2.67x, and the work splits almost exactly in half** — 54
commands against 53, from one function written once in the shared library. The
child boots at tick 19 rather than tick 1752.

### The 2.67x is not what it looks like, and the benchmark says so itself

Two bots returning more than 2x should make anybody suspicious. It is not
superlinear parallelism; the benchmark changes **two** things at once, and they
separate cleanly:

- **1.85x is parallelism** — the rate the colony issues commands at all. Under
  2x, which is what two OS threads sharing a machine with the sim should give.
- **1.44x is layout** — how much of that work was useful. The lone bot spends a
  chunk of every lap in `cross()`, walking between halves and harvesting nothing.
  Two bots each own a half and nobody commutes.

Their product reconstructs the observed ratio to two decimal places, which is the
check that the split is a measurement rather than a story fitted to one. Both
factors are asserted, including a ceiling of 2 on the parallelism term — if that
is ever exceeded the harness is counting something wrong.

**The layout half is the more interesting one**, and it is the one cycle 4 is
actually about. The fabricator's value is not only a second pair of hands; it is
that the hands start *where the work is*, because the machine that built them was
placed there. A second bot deployed from the build menu at the console would have
to walk.

### What is deliberately not asserted

A pinned ratio. Milestone 6 pinned the belt's 2.29x because hauling is
deterministic; two OS threads sharing a machine are not, and a benchmark that
pins a number it does not control becomes a test that fails when the machine is
busy. What is pinned is the **direction**, the **even split**, and the
**decomposition closing** — three claims the fabricator actually makes.

## What this still does not give

**A page-rate measurement.** 200Hz is ten times the game's clock, so the
parallelism term is measured under ten times the thread pressure the page
applies. The direction is safe; a precise figure for the page is not, and 20Hz is
the only honest way to get one.

**Anything about more than two bots.** The scenario splits a field in half by
hand. Cycle 5's planner scripts expand a colony without anybody writing a second
box, and the harness can measure that when there is something to measure.

**Milestone 9's finding 3, which is unaffected**: a parent still cannot
synchronise with its child. The benchmark drives from outside the game, which a
player cannot do.
