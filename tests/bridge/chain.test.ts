import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { RECIPE, RESEARCH_COST } from "../../src/sim/config";

/**
 * The whole milestone, run as one script: wheat becomes flour becomes bread
 * becomes the second bot.
 *
 * The same shape as `first-research.test.ts` and for the same reason — it is a
 * balance measurement first and an API regression test second. What it pins is
 * the number milestone 6's conveyors will be judged against: how long a
 * competent player spends hauling three stops by hand before the game offers
 * them a way not to.
 *
 * The mill and the oven are placed by the harness rather than by the script,
 * because placing is a hands phase and there is deliberately no `place()` verb
 * for a script to call until the builder arm exists.
 */
const MILL = { x: 18, y: 17 };
const OVEN = { x: 19, y: 17 };
const CONSOLE = { x: 16, y: 16 };

/**
 * Harvest a load, then run the relay: wheat to the mill, flour to the oven,
 * bread to the console. Every leg is the same four moves, which is precisely
 * the repetition the design wants a hauling function to be born from.
 */
const CHAIN = `
colony.research.queue("chassis");

/** Walk via row 18, which is clear of the console, the mill and the oven. */
function goTo(x, y) {
  while (bot.pos().y < 18) if (!bot.move("south")) break;
  while (bot.pos().x > x) if (!bot.move("west")) break;
  while (bot.pos().x < x) if (!bot.move("east")) break;
  while (bot.pos().y > y) if (!bot.move("north")) break;
  while (bot.pos().y < y) if (!bot.move("south")) break;
}

function carrying() {
  const inv = bot.inventory();
  return (inv.wheat ?? 0) + (inv.flour ?? 0) + (inv.bread ?? 0);
}

/**
 * Harvest until full. The capacity guard matters: a bot's ten-item hold is shared
 * across every item, so a leftover flour is one less wheat, and harvesting
 * while full is an error rather than a no-op.
 */
function fill() {
  let goingEast = true;
  while (carrying() < 10) {
    bot.harvester.harvest();
    if (!bot.move(goingEast ? "east" : "west")) {
      if (!bot.move("south")) return false;
      goingEast = !goingEast;
    }
  }
  return true;
}

/** Empty the bot into the console, whatever it happens to be holding. */
function dumpAtConsole() {
  goTo(17, 17);
  while (bot.pos().y > 16) bot.move("north");
  for (const item of ["bread", "flour", "wheat"]) {
    const n = bot.inventory()[item] ?? 0;
    if (n > 0) bot.deposit("west", item, n);
  }
}

let rounds = 0;
let breadMade = 0;
while (rounds < 12 && breadMade < 8) {
  rounds++;
  if (!fill()) { bot.log("field exhausted at tick " + colony.time()); break; }

  // Wheat into the mill.
  goTo(18, 18);
  bot.deposit("north", "wheat", 10);
  bot.wait(70);
  const flour = bot.withdraw("north", "flour", 10);

  if (flour > 0) {
    // Flour into the oven.
    goTo(19, 18);
    bot.deposit("north", "flour", flour);
    bot.wait(70);
    const bread = bot.withdraw("north", "bread", 10);
    if (bread > 0) {
      breadMade += bread;
      bot.log("carried " + bread + " bread home at tick " + colony.time());
    }
  }

  // End every round empty, so the next fill() has a full hold to work with.
  dumpAtConsole();
}
bot.log("finished after " + rounds + " rounds at tick " + colony.time());
`;

describe("the wheat to bread chain", () => {
  it("reaches the second bot by hauling three stops by hand", async () => {
    const world = new World({ seed: 1 });
    world.research.unlocked.add("mill");
    world.research.unlocked.add("oven");
    world.placeMachine("mill", MILL);
    world.placeMachine("oven", OVEN);

    const colony = new ScriptColony({ world, hungMs: 120_000 });
    const logs: string[] = [];
    try {
      const outcome = await colony.run(1, CHAIN, { onLog: (m) => void logs.push(m) });
      expect(outcome.status).toBe("done");

      const snap = world.snapshot();
      // The point of the whole milestone: bread bought a bot.
      expect(snap.research.unlocked).toContain("chassis");
      expect(snap.research.spareChassis).toBe(1);

      // Every stage of the chain actually ran.
      expect(logs.some((l) => l.includes("bread"))).toBe(true);

      // A ceiling rather than an exact figure, in the spirit of the design's
      // "under 400 ticks" bar: the job is to notice when balance moves, not to
      // freeze it. Measured value goes in the commit body.
      expect(world.time).toBeLessThan(9000);
      // Reported so a balance change shows up in CI output, not only in a diff.
      console.log(`chain reached the second bot at tick ${world.time}`);
      for (const line of logs) console.log(`  ${line}`);
    } finally {
      await colony.stopAll();
    }
  }, 120_000);

  it("prices the second bot in bread and nothing else", () => {
    // Guards the decision the milestone turns on. If this ever reads "wheat",
    // the chain has quietly become optional again.
    expect(RESEARCH_COST.chassis).toBeGreaterThan(0);
    const world = new World({ seed: 1 });
    world.machineAt(CONSOLE)!.inventory = { wheat: 1000 };
    world.queueResearch("chassis");
    for (let i = 0; i < 200; i++) world.tick();
    expect(world.research.spareChassis).toBe(0);
  });
});
