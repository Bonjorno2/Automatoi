import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generate, substitute } from "../../scripts/generate-dts.ts";
import { BOT_CAPACITY, TICK_COST } from "../../src/sim/config.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const committed = join(root, "src/editor/generated/player-api.d.ts");

/** Typecheck a player script against the generated globals. Returns tsc's output, or "" when clean. */
function checkScript(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "automatori-dts-check-"));
  try {
    copyFileSync(committed, join(dir, "player-api.d.ts"));
    writeFileSync(join(dir, "script.ts"), source, "utf8");
    // An empty typeRoots, and a cwd away from the project, so tsc does not
    // auto-include @types/node here. A player script sees the game's globals
    // and nothing else — which is the environment this test exists to check.
    mkdirSync(join(dir, "empty-types"), { recursive: true });
    try {
      execFileSync(process.execPath, [
        join(root, "node_modules/typescript/bin/tsc"),
        "--noEmit", "--strict", "--target", "ES2022", "--lib", "ES2022",
        "--typeRoots", join(dir, "empty-types"),
        join(dir, "player-api.d.ts"), join(dir, "script.ts"),
      ], { stdio: "pipe", cwd: dir });
      return "";
    } catch (err) {
      return String((err as { stdout?: Buffer }).stdout ?? err);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the generated player API", () => {
  it("is current with BotApi", () => {
    expect(readFileSync(committed, "utf8")).toBe(generate());
  }, 60_000);

  it("quotes the sim's own numbers rather than restating them", () => {
    const text = readFileSync(committed, "utf8");
    // `%ticks.move%` resolved, and every other placeholder with it. A survivor
    // means the generator shipped a literal percent sign into the hover text.
    expect(text).not.toMatch(/%[A-Za-z_][\w.]*%/);
    expect(text).toContain(`Step one tile. Costs ${TICK_COST.move} ticks.`);
    expect(text).toContain(`A chassis holds ${BOT_CAPACITY} items`);
  });

  it("refuses a placeholder nobody defined", () => {
    // The guard that makes the above worth having: a typo in api.ts fails the
    // build rather than reaching a player as `%ticks.mvoe%`.
    expect(() => substitute("/** costs %ticks.nope% */")).toThrow("no number named ticks.nope");
  });

  it("accepts the design's opening script", () => {
    expect(checkScript(`bot.harvester!.harvest();\nbot.move("east");\n`)).toBe("");
  }, 60_000);

  it("keeps the module namespaces optional", () => {
    // The whole point of the `?`: this is the honest way to call a module.
    expect(checkScript(`bot.scanner?.scan(2);\n`)).toBe("");
    // And reaching through without checking is a type error, as designed.
    expect(checkScript(`bot.scanner.scan(2);\n`)).toContain("possibly 'undefined'");
  }, 60_000);

  it("constrains arguments to the sim's own vocabulary", () => {
    expect(checkScript(`bot.move("up");\n`)).toContain("not assignable");
    expect(checkScript(`colony.research.queue("jetpack");\n`)).toContain("not assignable");
  }, 60_000);

  it("exposes colony reads", () => {
    expect(checkScript(`const n: number = colony.time();\nconst b = colony.bots()[0]!.pos.x;\n`)).toBe("");
  }, 60_000);
});
