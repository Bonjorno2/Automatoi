import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

/**
 * The shared library: one source buffer, compiled ahead of every bot's script.
 *
 * The design calls this "`import` between scripts" and holds it back until one
 * file per bot is genuinely miserable. Decision 2 of the milestone 9 plan says
 * why what ships is a prelude rather than the keyword: real modules mean a Blob
 * URL per script, an async worker entry on both platforms, and the loss of the
 * exact error-line mapping `line-offset.ts` exists for. The capability the
 * design asks for is shared code between bots; the keyword is how JavaScript
 * usually spells it.
 */
async function runWith(
  library: string,
  source: string,
): Promise<{ outcome: Awaited<ReturnType<ScriptColony["run"]>>; logs: string[] }> {
  const world = new World({ seed: 1 });
  const colony = new ScriptColony({ world, hungMs: 60_000, library });
  const logs: string[] = [];
  try {
    const outcome = await colony.run(1, source, { onLog: (m) => void logs.push(m) });
    return { outcome, logs };
  } finally {
    await colony.stopAll();
  }
}

describe("a function written once is callable from every bot", () => {
  it("puts the library in scope", async () => {
    const { outcome, logs } = await runWith(
      `function double(n) { return n * 2; }`,
      `bot.log("got " + double(21));`,
    );
    expect(outcome.status).toBe("done");
    expect(logs).toContain("got 42");
  });

  it("lets the library use the same globals a script does", async () => {
    // The whole point: a library function that drives the bot, which is what
    // `stamp` will be. It is compiled into the same scope, so `bot` and
    // `colony` are simply there.
    const { logs, outcome } = await runWith(
      `function whereAmI() { return bot.pos().x + "," + bot.pos().y; }`,
      `bot.log("at " + whereAmI());`,
    );
    expect(outcome.status).toBe("done");
    expect(logs[0]).toMatch(/^at \d+,\d+$/);
  });

  it("changes nothing when it is empty", async () => {
    const { outcome, logs } = await runWith("", `bot.log("alone");`);
    expect(outcome.status).toBe("done");
    expect(logs).toEqual(["alone"]);
  });

  it("is shared by two bots rather than copied into one", async () => {
    const world = new World({ seed: 1 });
    world.research.spareChassis = 1;
    const second = world.deployBot({ x: 20, y: 20 });
    const colony = new ScriptColony({
      world,
      hungMs: 60_000,
      library: `function who() { return "shared"; }`,
    });
    const logs: string[] = [];
    try {
      await Promise.all([
        colony.run(1, `bot.log("1 says " + who());`, { onLog: (m) => void logs.push(m) }),
        colony.run(second.id, `bot.log("2 says " + who());`, { onLog: (m) => void logs.push(m) }),
      ]);
      expect(logs.sort()).toEqual(["1 says shared", "2 says shared"]);
    } finally {
      await colony.stopAll();
    }
  });
});

/**
 * Fact 2 of the milestone 9 plan, and the reason the prelude is not free.
 *
 * `line-offset.ts` exists because a thrown error's stack line is the line in the
 * generated function, not in what the player typed — milestone 3 found that as a
 * real bug. Prepending a library moves every one of the player's lines down by
 * the length of the library, and an error that points at the wrong line is worse
 * than no line number, because the player trusts it.
 */
describe("the library does not move the player's error lines", () => {
  it("reports the player's own line with a long library loaded", async () => {
    const library = Array.from({ length: 20 }, (_, i) => `// library line ${i + 1}`).join("\n");
    const { outcome } = await runWith(
      library,
      ["bot.log('one');", "bot.log('two');", "throw new Error('boom');"].join("\n"),
    );
    expect(outcome.status).toBe("error");
    expect(outcome.message).toContain("boom");
    expect(outcome.line).toBe(3);
  });

  it("reports the same line whatever length the library is", async () => {
    const source = ["bot.log('one');", "throw new Error('boom');"].join("\n");
    const lines: (number | undefined)[] = [];
    for (const length of [0, 1, 5, 40]) {
      const library = Array.from({ length }, () => "//").join("\n");
      lines.push((await runWith(library, source)).outcome.line);
    }
    expect(lines).toEqual([2, 2, 2, 2]);
  });

  it("reports a line in the library when the library is what threw", async () => {
    // Not the player's line, because the player's line is not where the bug is.
    // The message says which file it means, since the two numbering schemes are
    // otherwise indistinguishable.
    const { outcome } = await runWith(
      ["function boom() {", "  throw new Error('inside');", "}"].join("\n"),
      `boom();`,
    );
    expect(outcome.status).toBe("error");
    expect(outcome.message).toContain("inside");
    expect(outcome.message).toContain("library line 2");
    expect(outcome.line).toBeUndefined();
  });

  it("fails legibly when the library itself will not parse", async () => {
    const { outcome } = await runWith(`function broken( {`, `bot.log("never");`);
    expect(outcome.status).toBe("error");
    expect(outcome.message).toContain("library");
  });
});
