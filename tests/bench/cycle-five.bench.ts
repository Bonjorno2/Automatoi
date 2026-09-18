import { World } from "../../src/sim/world";
import { measure, describeResult } from "./harness.ts";

/**
 * **Cycle 5, played again, with the reads it asked for.**
 *
 * The design's claim: *"By cycle 5, `main.js` never says `move("east")`. It says
 * `expand(ironLine, 3)`. `expand` is built on `stamp`, on `place`, on `move`. The
 * player wrote every layer and owns the whole abstraction stack."*
 *
 * The first run of this playtest, on 2026-09-16, said the claim was false: the
 * stack hit three walls before it placed a second crate, and all three were the
 * same shape — the engine knew something and no script could ask. Milestone 11
 * added the three reads. This is the same stack with them, written the way a
 * player would and reaching past nothing:
 *
 * - `unservedSpot` asks `colony.canPlace` instead of walking somewhere and
 *   failing, which is finding 2.
 * - `expand` hands each child its own crate through `spawn`'s second argument,
 *   instead of building source text with `new Function`, which is finding 4.
 * - `main` asks `colony.bots()` whether anything it built has died or is getting
 *   nowhere, which is finding 5.
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

/** Where the planner can see the field, and where it keeps out of the way. */
const VANTAGE = { x: 18, y: 16 };
const HOME = { x: 24, y: 16 };

function survey() { return goTo(VANTAGE.x, VANTAGE.y); }

/**
 * Off the field, where nothing we build ever needs to walk.
 *
 * Finding 3 was the planner standing on a tile it never left while a bot it had
 * built waited on that tile for the rest of the session. A bot-on-bot block
 * never resolves, so the answer is not to be there — which is a thing a script
 * can decide, and exactly the kind of thing the design says the player writes.
 */
function standAside() { return goTo(HOME.x, HOME.y); }

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

function look(radius) { return bot.scanner.scan(Math.min(radius, 6)); }

function standingNear(radius) {
  return look(radius).filter((t) => t.crop !== null).length;
}

/**
 * Somewhere worth serving that will actually take a crate.
 *
 * **This is the line finding 2 was about.** The first run picked the centroid of
 * the crops it could see, and the centre of a field is where the console and the
 * bots are — so the centroid was occupied, \`place\` threw, and \`main\` asked the
 * same question again forty ticks later, 128 times. The tile is now chosen from
 * the ones the colony says are buildable, which costs no ticks and no walking.
 */
function unservedSpot(radius) {
  const tiles = look(radius);
  const crops = tiles.filter((t) => t.crop !== null && t.machine === null);
  if (crops.length < 8) return null;

  // Keep blocks apart, so a second crate is a second block rather than a
  // neighbour of the first.
  const taken = tiles.filter((t) => t.machine !== null);
  const clear = (t) =>
    taken.every((m) => Math.max(Math.abs(m.x - t.x), Math.abs(m.y - t.y)) > 3);

  const usable = tiles.filter((t) => clear(t) && colony.canPlace(t, "crate"));
  if (usable.length === 0) return null;

  // The one with the most standing wheat around it: demand, read rather than
  // guessed at.
  let best = null, bestScore = -1;
  for (const t of usable) {
    const score = crops.filter(
      (c) => Math.max(Math.abs(c.x - t.x), Math.abs(c.y - t.y)) <= 3,
    ).length;
    if (score > bestScore) { bestScore = score; best = { x: t.x, y: t.y }; }
  }
  return bestScore >= 8 ? best : null;
}

// ---------------------------------------------------------------- layer 4
// expand(). Built on stamp, on place, on move — and on spawn, which is the
// cycle-4 primitive that makes a block come with the hands to work it.

const harvestBlock = [{ dx: 0, dy: 0, machine: "crate" }];

/** What a staffed block's bot does all day, told which block is its own. */
function workBlock(home) {
  while (true) workCrate(home.x, home.y);
}

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

function expand(blueprint, n) {
  let built = 0;
  for (let i = 0; i < n; i++) {
    const at = unservedSpot(6);
    if (!at) { bot.log("expand: nothing left to serve"); break; }
    if (!stamp(blueprint, at)) { bot.log("expand: stamp failed at " + at.x + "," + at.y); break; }
    try {
      // Finding 4: the child is handed its own crate, rather than having the
      // numbers baked into a string that no editor can check.
      colony.fabricator.spawn(workBlock, at);
    } catch (e) {
      bot.log("expand: spawn refused: " + e.message);
      break;
    }
    bot.log("expand: block at " + at.x + "," + at.y);
    built++;
  }
  return built;
}

/**
 * Finding 5: which of the bots I built are not working.
 *
 * \`busy\` could never answer this — it is true of a bot doing its job and true
 * of a bot deadlocked against another, which is the pair the first run sampled
 * and could not tell apart.
 */
function ailing() {
  return colony.bots().filter(
    (b) => b.script === "error" || b.script === "hung" || b.stalled > 5,
  );
}
`;

/**
 * What the design says `main.js` looks like by cycle 5.
 *
 * No `move`, no `place`, no coordinates. Look at the field, expand into it,
 * keep out of the way, and notice when something we built has stopped working.
 * This is the sentence the whole abstraction rhythm is building towards.
 */
const MAIN = `
colony.research.queue("mill");
while (true) {
  survey();
  if (standingNear(6) > 20) expand(harvestBlock, 1);
  standAside();
  for (const b of ailing()) bot.log("block bot " + b.id + " is " + b.script + " (stalled " + b.stalled + ")");
  bot.wait(40);
}
`;

const standing = (w: World): number => w.snapshot().tiles.filter((t) => t.crop !== null).length;
const crates = (w: World): number =>
  [...w.machines.values()].filter((m) => m.kind === "crate").length;

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
  it("places blocks, staffs them, and clears the field it planned for", async () => {
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
        return crates(w) >= 2 && before - standing(w) >= 25;
      },
      timeoutMs: 60_000,
    });

    for (const [id, state] of live) console.log(`  bot ${id} ${state}`);

    console.log(describeResult("planner", result));
    console.log(`  bots at the end: ${result.bots.length}`);
    console.log(`  crates placed:   ${crates(world)}`);
    console.log(`  wheat harvested: ${before - standing(world)}`);
    // Unique lines with a count, because a livelocked planner says the same
    // thing thousands of times and the interesting line is never the first one.
    const tally = new Map<string, number>();
    for (const l of result.logs) tally.set(l, (tally.get(l) ?? 0) + 1);
    for (const [line, n] of tally) console.log(`  ${n}x  ${line}`);

    // The sentence the design has been claiming since 2026-09-11 and had never
    // once done: a second block, placed and staffed by a script.
    expect(crates(world), "crates the planner placed").toBeGreaterThanOrEqual(2);
    expect(result.bots.length, "bots in the colony").toBeGreaterThanOrEqual(3);
    expect(result.reachedTarget, "the field the planner planned for was cleared").toBe(true);
  }, 180_000);
});
