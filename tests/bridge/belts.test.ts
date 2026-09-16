import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { CONVEYOR_TICKS, RESEARCH_COST } from "../../src/sim/config";

/**
 * The milestone's whole argument, stated as a measurement: **automation must
 * beat the hand-haul it replaces.**
 *
 * Milestone 5 pinned the baseline at about tick 2700 for six bread carried by
 * one bot walking a four-stop loop, and recorded that as the number this
 * milestone's conveyors would be judged against. Here the same six bread buy the
 * same second bot, except that the bot lays a belt route with the builder arm
 * and then only harvests and loads. If that is not materially faster, belts are
 * a worse version of what the player already had and the numbers in config.ts
 * are wrong — not the player, and not the plan.
 *
 * The route the script builds, with the mill and oven placed by the harness the
 * way `chain.test.ts` places them:
 *
 *     wheat   (17,17)E -> mill(18,17)
 *     flour   mill -> (19,17)E -> oven(20,17)
 *     bread   oven -> (21,17)E -> (22,17)N -> (22,16)W -> ... -> (17,16)W -> console(16,16)
 *
 * Every belt that takes from a machine faces *away* from it, which is the thing
 * a player has to learn and the thing this script is a worked example of.
 */
const MILL = { x: 18, y: 17 };
const OVEN = { x: 20, y: 17 };

/**
 * Milestone 5's measured figure for the same six bread, carried by one bot
 * walking a four-stop loop, recorded in the body of commit e63fe61.
 */
const HAND_HAULED_BASELINE = 2700;

const BELTS = `
colony.research.queue("chassis");

/**
 * Lay the route. Row 16 is placed from row 15 and row 17 from row 18, because
 * the mill and the oven stand on row 17 and a bot cannot walk through them.
 */
function layRoute() {
  bot.move("north");
  for (let x = 17; x <= 22; x++) {
    if (x > 17) bot.move("east");
    bot.builder.place("conveyor", "south", "west");
  }
  // Round the end of the finished line, which is now a wall, to reach row 18.
  bot.move("east");
  bot.move("south"); bot.move("south"); bot.move("south");
  bot.move("west");
  bot.builder.place("conveyor", "north", "north");
  bot.move("west");
  bot.builder.place("conveyor", "north", "east");
  bot.move("west"); bot.move("west");
  bot.builder.place("conveyor", "north", "east");
  bot.move("west"); bot.move("west");
  bot.builder.place("conveyor", "north", "east");
}

let goingEast = true;
function carrying() { return bot.inventory().wheat ?? 0; }

function dropARow() {
  // The soil ends at row 22. Walking the grass below it is not harvesting, and
  // counting it as hauling would flatter the belt and the hand-haul equally.
  if (bot.pos().y >= 22) return false;
  if (!bot.move("south")) return false;
  goingEast = !goingEast;
  return true;
}

/** Sweep the field south of the route until full. */
function sweep() {
  while (carrying() < 10) {
    bot.harvester.harvest();
    const p = bot.pos();
    if (goingEast && p.x >= 22) { if (!dropARow()) return false; continue; }
    if (!goingEast && p.x <= 10) { if (!dropARow()) return false; continue; }
    if (!bot.move(goingEast ? "east" : "west")) { if (!dropARow()) return false; }
  }
  return true;
}

/** Row 18 and below is clear: everything this script built is on 16 and 17. */
function goTo(x, y) {
  while (bot.pos().y < 18) bot.move("south");
  while (bot.pos().x > x) bot.move("west");
  while (bot.pos().x < x) bot.move("east");
  while (bot.pos().y > y) bot.move("north");
  while (bot.pos().y < y) bot.move("south");
}

/**
 * Empty onto the belt. It holds four, and the mill eats slower than the belt
 * delivers, so a full load goes on in several goes with waits between — which
 * is the bot being the mill's servant, and is the honest shape of this phase.
 */
function unload() {
  let waits = 0;
  while (carrying() > 0 && waits < 400) {
    if (bot.deposit("north", "wheat", carrying()) === 0) { bot.wait(${CONVEYOR_TICKS}); waits++; }
  }
}

layRoute();
bot.log("route laid at tick " + colony.time());

let rounds = 0;
while (rounds < 20) {
  rounds++;
  if (!sweep()) {
    bot.log("field exhausted at tick " + colony.time());
    // The route is still carrying what was already loaded, so waiting on the
    // research is the honest end rather than declaring failure at the moment
    // the bot runs out of things to pick up.
    let waits = 0;
    while (!colony.research.status().unlocked.includes("chassis") && waits < 300) {
      bot.wait(10);
      waits++;
    }
    bot.log("chain drained at tick " + colony.time());
    break;
  }
  goTo(17, 18);
  unload();
  // The read milestone 3's finding 4 asked for. Before it, this loop had to
  // guess at a wait and hope.
  const research = colony.research.status();
  if (research.unlocked.includes("chassis")) {
    bot.log("second bot paid for at tick " + colony.time() + " after " + rounds + " rounds");
    break;
  }
}
`;

describe("a belt route against the hand-hauled baseline", () => {
  it("pays for the second bot in a fraction of milestone 5's hauling", async () => {
    const world = new World({ seed: 1 });
    for (const r of ["mill", "oven", "conveyor", "builder"] as const) {
      world.research.unlocked.add(r);
    }
    world.placeMachine("mill", MILL);
    world.placeMachine("oven", OVEN);
    world.getBot(1).modules.add("builder");

    const colony = new ScriptColony({ world, hungMs: 120_000 });
    const logs: string[] = [];
    try {
      const outcome = await colony.run(1, BELTS, { onLog: (m) => void logs.push(m) });
      expect(outcome.status).toBe("done");

      const snap = world.snapshot();
      expect(snap.research.unlocked).toContain("chassis");
      expect(snap.research.spareChassis).toBe(1);

      // Two assertions doing different jobs. The first is the milestone's
      // argument: a belt route must be *materially* faster than the hand-haul
      // it replaces, not a rounding error better. The second is a ceiling in
      // the spirit of the design's "under 400 ticks" bar — close enough to the
      // measured 1181 to notice when balance moves, loose enough not to break
      // over a tick of recipe tuning.
      expect(world.time).toBeLessThan(HAND_HAULED_BASELINE * 0.6);
      expect(world.time).toBeLessThan(1600);

      console.log(`belt route paid for the second bot at tick ${world.time}`);
      console.log(`  milestone 5's hand-hauled baseline was ${HAND_HAULED_BASELINE}`);
      console.log(`  speed-up ${(HAND_HAULED_BASELINE / world.time).toFixed(2)}x`);
      for (const line of logs) console.log(`  ${line}`);
    } finally {
      await colony.stopAll();
    }
  }, 120_000);

  it("keeps the second bot priced in bread, so the route is load-bearing", () => {
    // The guard milestone 5 put on its own measurement, carried forward: if the
    // chassis ever costs wheat again, the whole chain becomes optional and this
    // test would pass while measuring nothing.
    expect(RESEARCH_COST.chassis).toBeGreaterThan(0);
    const world = new World({ seed: 1 });
    world.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 1000 };
    world.queueResearch("chassis");
    for (let i = 0; i < 200; i++) world.tick();
    expect(world.research.spareChassis).toBe(0);
  });
});
