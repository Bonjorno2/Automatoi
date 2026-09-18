import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { measure } from "../bench/harness.ts";

/**
 * `spawn`'s second argument: cycle five's finding 4.
 *
 * `expand(blueprint, n)` has to tell each child which block is its own, and a
 * spawned function is source and closes over nothing. The only way through was
 * building the source text by hand —
 *
 * ```js
 * colony.fabricator.spawn(new Function("while (true) workCrate(" + cx + "," + cy + ");"));
 * ```
 *
 * — which works, and throws away every reason milestone 9 chose a function over
 * a string: no autocomplete, no highlighting, no typecheck, inside the most
 * complex thing a player writes.
 */

function fabricated(chassis = 1): World {
  const world = new World({ seed: 1 });
  world.research.unlocked.add("fabricator");
  world.research.spareChassis = chassis;
  world.placeMachine("fabricator", { x: 20, y: 20 });
  return world;
}

/**
 * The ids the children get.
 *
 * Bots and machines share one counter, so a world built by `fabricated` has
 * spent 1 on the bot, 2 on the console and 3 on the fabricator before anything
 * is spawned.
 */
const CHILD = 4;
const SECOND_CHILD = 5;

/** Bot 1's script, kept alive so the colony outlives the children it builds. */
const PARENT_LIVES = `while (true) bot.wait(10);`;

/**
 * Nothing died.
 *
 * Not `toEqual([])`: the harness stops every bot when the window closes and logs
 * each verdict that is not "done", so a healthy run still ends with lines saying
 * "stopped".
 */
const failures = (logs: string[]): string[] =>
  logs.filter((l) => l.includes("error") || l.includes("hung"));

describe("a spawned bot can be told which block is its own", () => {
  it("hands the argument to the function as its parameter", async () => {
    // The child walks where it was told, which is a thing only an argument that
    // actually arrived could make it do.
    const world = fabricated();
    const result = await measure({
      world,
      script: [
        `colony.fabricator.spawn((job) => {`,
        `  for (let i = 0; i < job.steps; i++) bot.move(job.dir);`,
        `}, { dir: "north", steps: 2 });`,
        PARENT_LIVES,
      ].join("\n"),
      until: (w) => w.bots.get(CHILD)?.pos.y === 17,
      timeoutMs: 30_000,
    });
    expect(failures(result.logs), result.logs.join("\n")).toEqual([]);
    expect(result.reachedTarget).toBe(true);
    expect(world.getBot(CHILD).pos).toEqual({ x: 20, y: 17 });
  }, 60_000);

  it("gives two children built by one loop two different jobs", async () => {
    // The shape `expand(ironLine, 3)` needs: one function, written once, and
    // children that differ only in their parameters.
    const world = fabricated(2);
    const result = await measure({
      world,
      script: [
        `const work = (job) => {`,
        `  for (let i = 0; i < job.steps; i++) bot.move(job.dir);`,
        `};`,
        `const jobs = [{ dir: "north", steps: 2 }, { dir: "south", steps: 3 }];`,
        `for (const job of jobs) colony.fabricator.spawn(work, job);`,
        PARENT_LIVES,
      ].join("\n"),
      until: (w) => w.bots.get(CHILD)?.pos.y === 17 && w.bots.get(SECOND_CHILD)?.pos.y === 24,
      timeoutMs: 30_000,
    });
    expect(failures(result.logs), result.logs.join("\n")).toEqual([]);
    expect(result.reachedTarget).toBe(true);
    // Spawned north of the fabricator and south of it, then two steps and three.
    expect(world.getBot(CHILD).pos).toEqual({ x: 20, y: 17 });
    expect(world.getBot(SECOND_CHILD).pos).toEqual({ x: 20, y: 24 });
  }, 60_000);

  it("carries anything JSON carries, intact", async () => {
    /**
     * U+2028 is the one character JSON allows inside a string that JavaScript
     * source has not always allowed inside a literal, and this argument becomes
     * source. Written as an escape rather than typed, so that this file is not
     * itself a test of whoever opens it next.
     */
    const LINE_SEPARATOR = String.fromCharCode(0x2028);
    const payload = {
      home: { x: 4, y: 7 },
      rows: [[1, 2], [3, 4]],
      note: `she said "east", then\na backslash \\ and ${LINE_SEPARATOR} a separator`,
      deep: { a: { b: { c: null } } },
      flag: false,
    };
    const world = fabricated();
    const result = await measure({
      world,
      script: [
        `colony.fabricator.spawn((arg) => {`,
        `  bot.log(JSON.stringify(arg));`,
        `  bot.move("north");`,
        `  while (true) bot.wait(10);`,
        `}, ${JSON.stringify(payload)});`,
        PARENT_LIVES,
      ].join("\n"),
      // The move is the signal that the log has already happened.
      until: (w) => w.bots.get(CHILD)?.pos.y === 18,
      timeoutMs: 30_000,
    });
    expect(result.reachedTarget, result.logs.join("\n")).toBe(true);
    expect(result.logs).toContain(`bot ${CHILD}: ${JSON.stringify(payload)}`);
  }, 60_000);

  it("still spawns with no argument at all, as milestone 9 shipped it", async () => {
    const world = fabricated();
    const colony = new ScriptColony({ world, hungMs: 60_000 });
    try {
      const outcome = await colony.run(1, `
        const id = colony.fabricator.spawn(() => { bot.wait(1); });
        bot.log("spawned " + id);
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual([`spawned ${CHILD}`]);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);
});

/**
 * Decision 4: a value JSON cannot carry fails in the *parent*, on the line that
 * called, and costs nothing.
 *
 * The alternative is a child that dies on a line nobody wrote, which is cycle
 * five's finding 1 and milestone 10's oversized scan wearing a third hat.
 */
describe("an argument that cannot cross says so before anything is built", () => {
  it("refuses a function, on the calling line, and spends no chassis", async () => {
    const world = fabricated();
    const colony = new ScriptColony({ world, hungMs: 60_000 });
    try {
      const outcome = await colony.run(1, [
        `const job = () => "east";`,
        `colony.fabricator.spawn((j) => { bot.move(j()); }, job);`,
      ].join("\n"));
      expect(outcome.status).toBe("error");
      expect(outcome.line).toBe(2);
      expect(outcome.message).toContain("function");
      expect(world.bots.size).toBe(1);
      expect(world.research.spareChassis).toBe(1);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("refuses a cycle, and the parent can catch it and carry on", async () => {
    const world = fabricated();
    const colony = new ScriptColony({ world, hungMs: 60_000 });
    try {
      const outcome = await colony.run(1, `
        const loop = { name: "self" };
        loop.me = loop;
        try {
          colony.fabricator.spawn((a) => { bot.log(a.name); }, loop);
          bot.log("no error");
        } catch (err) {
          bot.log("caught");
        }
        bot.log("still alive");
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual(["caught", "still alive"]);
      expect(world.bots.size).toBe(1);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);

  it("treats a missing argument and an undefined one the same way", async () => {
    // `f(undefined)` and `f()` are the same call in JavaScript, and a parameter
    // nobody passed is what the child sees either way. Refusing the second would
    // be the game being stricter than the language it teaches.
    const world = fabricated();
    const colony = new ScriptColony({ world, hungMs: 60_000 });
    try {
      const outcome = await colony.run(
        1,
        `colony.fabricator.spawn((a) => { bot.wait(1); }, undefined);`,
      );
      expect(outcome.status).toBe("done");
      expect(world.bots.size).toBe(2);
    } finally {
      await colony.stopAll();
    }
  }, 30_000);
});
