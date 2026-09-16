import { World } from "../../src/sim/world";
import { measure, describeResult } from "./harness.ts";

/**
 * **Cycle 5, played rather than argued about.**
 *
 * The design's claim: *"By cycle 5, `main.js` never says `move("east")`. It says
 * `expand(ironLine, 3)`. `expand` is built on `stamp`, on `place`, on `move`. The
 * player wrote every layer and owns the whole abstraction stack."* Milestone 9
 * added that cycle 5 is the first cycle needing **no engine work at all**, which
 * is "either the design being right or the design being untestable, and only a
 * playtest can say which".
 *
 * This is that playtest. The library below is written the way a player would
 * write it — four layers, each built on the one under it, nothing reaching past
 * the shipped API — and `MAIN` is what the design says `main.js` should look
 * like by now. Whatever breaks is the finding.
 *
 * There is no iron, so the thing being expanded is a harvest block: a crate with
 * a bot assigned to fill it. That is the same shape as `ironLine` with the only
 * material this game has.
 */

const LIBRARY = `
// ---------------------------------------------------------------- layer 1
// Movement. Built on bot.move, which is the primitive research handed over.

function goTo(x, y) {
  let guard = 0;
  while ((bot.pos().x !== x || bot.pos().y !== y) && guard++ < 200) {
    if (bot.pos().y !== y) { if (bot.move(bot.pos().y > y ? "north" : "south")) continue; }
    if (bot.pos().x !== x) { if (bot.move(bot.pos().x > x ? "west" : "east")) continue; }
    return false; // boxed in
  }
  return bot.pos().x === x && bot.pos().y === y;
}

// ---------------------------------------------------------------- layer 2
// Blueprints. A blueprint is data: offsets from an origin, and what goes there.
// stamp() is the cycle-4 abstraction the design says the player writes.

function stamp(blueprint, at) {
  for (const part of blueprint) {
    const tx = at.x + part.dx, ty = at.y + part.dy;
    // Stand south of the target and build north into it.
    if (!goTo(tx, ty + 1)) return false;
    try {
      bot.builder.place(part.machine, "north", part.facing);
    } catch (e) {
      bot.log("stamp refused at " + tx + "," + ty + ": " + e.message);
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------- layer 3
// Demand. What the colony is short of, read from the world.

function standingNear(radius) {
  const tiles = bot.scanner.scan(Math.min(radius, 6));
  return tiles.filter((t) => t.crop !== null).length;
}

/** Somewhere with crops and no machine yet. Returns null when the field is served. */
function unservedSpot(radius) {
  const tiles = bot.scanner.scan(Math.min(radius, 6));
  const crops = tiles.filter((t) => t.crop !== null && t.machine === null);
  if (crops.length < 8) return null;
  // The middle of the densest thing we can see, roughly.
  let sx = 0, sy = 0;
  for (const t of crops) { sx += t.x; sy += t.y; }
  return { x: Math.round(sx / crops.length), y: Math.round(sy / crops.length) };
}

// ---------------------------------------------------------------- layer 4
// expand(). Built on stamp, on place, on move — and on spawn, which is the
// cycle-4 primitive that makes a block come with the hands to work it.

const harvestBlock = [{ dx: 0, dy: 0, machine: "crate" }];

function expand(blueprint, n) {
  let built = 0;
  for (let i = 0; i < n; i++) {
    const at = unservedSpot(6);
    if (!at) { bot.log("expand: nothing left to serve"); break; }
    if (!stamp(blueprint, at)) { bot.log("expand: stamp failed"); break; }
    // Staff it. The child is told where its crate is by having the numbers
    // baked into its source, because a spawned function is text and closes
    // over nothing.
    const cx = at.x, cy = at.y;
    const source = "while (true) { workCrate(" + cx + ", " + cy + "); }";
    try {
      colony.fabricator.spawn(new Function(source));
    } catch (e) {
      bot.log("expand: spawn refused: " + e.message);
      break;
    }
    built++;
  }
  return built;
}

/** What a staffed block's bot does all day. Deliberately in the library. */
function workCrate(cx, cy) {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      if ((bot.inventory().wheat ?? 0) >= 10) {
        if (goTo(cx, cy + 1)) bot.deposit("north", "wheat", bot.inventory().wheat ?? 0);
      }
      if (goTo(cx + dx, cy + dy)) bot.harvester.harvest();
    }
  }
  if (goTo(cx, cy + 1)) bot.deposit("north", "wheat", bot.inventory().wheat ?? 0);
}
`;

/**
 * What the design says `main.js` looks like by cycle 5.
 *
 * No `move`, no `place`, no coordinates. One read of demand and one call to
 * expand, in a loop. This is the sentence the whole abstraction rhythm is
 * building towards.
 */
const MAIN = `
colony.research.queue("mill");
while (true) {
  if (standingNear(6) > 20) expand(harvestBlock, 1);
  bot.wait(40);
}
`;

const standing = (w: World): number => w.snapshot().tiles.filter((t) => t.crop !== null).length;

function plannerWorld(): World {
  const world = new World({ seed: 1 });
  // A colony that has got this far: everything cycle 5 rests on is researched,
  // and the planner bot carries the hardware those researches handed over.
  for (const r of ["crate", "scanner", "builder", "fabricator", "library"] as const) {
    world.research.unlocked.add(r);
  }
  world.research.spareChassis = 4;
  world.placeMachine("fabricator", { x: 16, y: 20 });
  const planner = world.getBot(1);
  planner.modules.add("scanner");
  planner.modules.add("builder");
  return world;
}

describe("cycle 5: a planner that reads demand and expands", () => {
  it("runs the design's main.js and reports what actually happened", async () => {
    const world = plannerWorld();
    const before = standing(world);
    const live = new Map<number, string>();

    const result = await measure({
      world,
      script: MAIN,
      library: LIBRARY,
      // `until` runs every pass, so it doubles as a sampler. State read after
      // `measure` returns is useless: `stopAll` resets `action` and `blockedOn`
      // on the way out, so every bot looks serenely idle whatever killed it.
      until: (w) => {
        for (const b of w.bots.values()) {
          live.set(b.id, `at ${b.pos.x},${b.pos.y} — action ${b.action?.command.kind ?? "none"}` +
            `, blockedOn ${b.blockedOn ?? "nothing"}, stalled ${b.stalled}`);
        }
        return before - standing(w) >= 25;
      },
      timeoutMs: 30_000,
    });

    for (const [id, state] of live) console.log(`  bot ${id} ${state}`);

    console.log(describeResult("planner", result));
    console.log(`  bots at the end: ${result.bots.length}`);
    console.log(`  crates placed:   ${[...world.machines.values()].filter((m) => m.kind === "crate").length}`);
    console.log(`  wheat harvested: ${before - standing(world)}`);
    // Unique lines with a count, because a livelocked planner says the same
    // thing thousands of times and the interesting line is never the first one.
    const tally = new Map<string, number>();
    for (const l of result.logs) tally.set(l, (tally.get(l) ?? 0) + 1);
    for (const [line, n] of tally) console.log(`  ${n}x  ${line}`);

    // What cycle 5's machinery can do today: the stack compiles, a blueprint is
    // stamped by a script, and the block comes with a bot. That much is real.
    expect(result.bots.length).toBeGreaterThan(1);
    expect([...world.machines.values()].filter((m) => m.kind === "crate").length)
      .toBeGreaterThanOrEqual(1);

    // And what it cannot: this run **times out by design**, and that is the
    // finding rather than a flaky test. The planner retries one occupied tile
    // forever and its own child deadlocks on a tile the planner never leaves.
    // When findings 2 and 3 are fixed, this expectation should be inverted to
    // `toBe(true)` — it is written this way so that fixing them fails here and
    // forces the file to be updated rather than quietly passing.
    expect(result.reachedTarget).toBe(false);
  }, 180_000);
});
