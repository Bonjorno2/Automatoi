import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { SOURCE_LINE_OFFSET, playerLine } from "../../src/bridge/line-offset.ts";

describe("source line offset", () => {
  it("is measured, and matches what new Function actually reports", () => {
    // A script whose throw is on player line 3.
    const source = `bot.log(1);\nbot.log(2);\nthrow new Error("boom");`;
    const fn = new Function("bot", "colony", `"use strict";\n${source}`);
    try {
      fn({ log() {} }, {});
      throw new Error("probe did not throw");
    } catch (err) {
      expect(playerLine(err)).toBe(3);
    }
    // V8's value, in Node and Chrome alike. Recorded so a change is visible.
    expect(SOURCE_LINE_OFFSET).toBe(3);
  });

  it("returns undefined for an error with no player frame", () => {
    expect(playerLine(new Error("host-side"))).toBeUndefined();
    expect(playerLine("not an error")).toBeUndefined();
  });
});

describe("errors reported from a running script", () => {
  it("names the line the player wrote", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await colony.run(1, `bot.log("one");\nbot.log("two");\nnope();`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("nope is not defined");
      expect(outcome.line).toBe(3);
      expect(outcome.logs).toEqual(["one", "two"]);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);

  it("maps the sim's own errors to the calling line too", async () => {
    const colony = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      // The starting chassis carries only the harvester.
      const outcome = await colony.run(1, `bot.move("east");\nbot.scanner.scan(1);`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("Bot 1 has no Scanner module");
      expect(outcome.line).toBe(2);
    } finally {
      await colony.stopAll();
    }
  }, 20_000);
});
