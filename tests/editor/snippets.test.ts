import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";
import { SNIPPETS } from "../../src/editor/snippets.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const dts = join(root, "src/editor/generated/player-api.d.ts");

/**
 * Compile a chip the way Monaco does, not the way `tsc --strict` would.
 *
 * The editor deliberately runs with strictNullChecks off — see the note in
 * editor.ts — so a chip that is clean here is clean in front of the player,
 * which is the only thing this test cares about.
 */
function compile(code: string): string {
  const dir = mkdtempSync(join(tmpdir(), "automatori-snippet-"));
  try {
    copyFileSync(dts, join(dir, "player-api.d.ts"));
    writeFileSync(join(dir, "chip.js"), code, "utf8");
    mkdirSync(join(dir, "empty-types"), { recursive: true });
    try {
      execFileSync(process.execPath, [
        join(root, "node_modules/typescript/bin/tsc"),
        "--noEmit", "--allowJs", "--checkJs",
        "--target", "ESNext", "--lib", "ESNext",
        "--typeRoots", join(dir, "empty-types"),
        join(dir, "player-api.d.ts"), join(dir, "chip.js"),
      ], { stdio: "pipe", cwd: dir });
      return "";
    } catch (err) {
      return String((err as { stdout?: Buffer }).stdout ?? err);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the snippet book", () => {
  it("has chips", () => {
    expect(SNIPPETS.length).toBeGreaterThan(5);
  });

  it.each(SNIPPETS.map((s) => [s.title, s.code] as const))(
    "%s compiles against the shipped API",
    (_title, code) => {
      expect(compile(code)).toBe("");
    },
    60_000,
  );

  /**
   * Chips needing hardware the starting chassis lacks would fail with the sim's
   * own message, which is correct behaviour and not worth asserting here. The
   * rest have to actually work.
   */
  const runnable = SNIPPETS.filter((s) => !s.requires && !s.needsMachine);

  it.each(runnable.map((s) => [s.title, s.code] as const))(
    "%s runs without erroring",
    async (_title, code) => {
      const colony = new ScriptColony({ world: new World({ seed: 1 }) });
      let settled: { status: string; message?: string } | undefined;
      try {
        const running = colony.run(1, code, { onSettle: (o) => { settled = o; } });
        void running.catch(() => {});
        // Most chips are deliberate infinite loops; give them room to misbehave.
        await new Promise((r) => setTimeout(r, 700));

        // A chip may legitimately end in one of the sim's own errors, and what
        // must never happen is a mistake in the chip itself.
        //
        // **Milestone 10 emptied this branch rather than changing it.** The
        // canonical two-line harvest loop used to fill the bot's ten slots and
        // die on "inventory full"; a full harvest is now a refusal, so that chip
        // runs on and reports "running" instead. The `if` is kept because it is
        // the guard that matters — a chip that errors for any *other* reason
        // still fails here, and the message it would have to carry is named.
        const status = settled?.status ?? "running";
        expect(status).not.toBe("hung");
        if (status === "error") {
          expect(settled?.message).toContain("inventory full");
        }
      } finally {
        await colony.stopAll();
      }
    },
    30_000,
  );
});
