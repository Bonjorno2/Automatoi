import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BOT_CAPACITY,
  CONVEYOR_TICKS,
  CROP_GROWTH,
  MACHINE_CAPACITY,
  TICK_COST,
  capacityOf,
} from "../src/sim/config.ts";
import { RES_BYTES } from "../src/bridge/protocol.ts";

/**
 * Generate the player-facing type file Monaco loads for autocomplete.
 *
 * The design requires this be derived from `BotApi` and `ColonyApi` rather than
 * maintained beside them — that is why those are declared as explicit
 * interfaces. `tsc --emitDeclarationOnly` gets us most of the way, including
 * the JSDoc that becomes Monaco's hover text, but its output is a module with
 * imports. Monaco's `addExtraLib` wants one ambient file, so the referenced
 * declarations are inlined and every `export` stripped.
 *
 * Two things happen on top of that, both milestone 10's:
 *
 * 1. **Numbers are substituted, not written.** A `%ticks.move%` in the JSDoc
 *    becomes `2` from `config.ts`. Hover text that quotes a tick cost by hand is
 *    hover text that lies the first time the cost is tuned, and the design says
 *    these are tuned in playtests.
 * 2. **Hardware is split into gated blocks.** Every module namespace leaves the
 *    interface and comes back as a `//#gate module:scanner` block that merges
 *    into it. The editor drops the blocks the player has not earned, which is
 *    how "autocomplete on `bot.` lists what you have" becomes true rather than
 *    aspirational. See `src/editor/api-surface.ts`.
 *
 * Run with `npm run generate:dts`. `tests/editor/dts.test.ts` fails if the
 * committed output drifts from what this produces.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(root, "src/editor/generated/player-api.d.ts");

/**
 * What the `%name%` placeholders in `api.ts` resolve to.
 *
 * Spread from the config tables rather than listed, so a new command's tick cost
 * is quotable in a doc comment the moment it exists.
 */
const NUMBERS: Record<string, number> = {
  ...Object.fromEntries(Object.entries(TICK_COST).map(([k, v]) => [`ticks.${k}`, v])),
  ...Object.fromEntries(Object.entries(CROP_GROWTH).map(([k, v]) => [`growth.${k}`, v])),
  BOT_CAPACITY,
  MACHINE_CAPACITY,
  CONVEYOR_CAPACITY: capacityOf("conveyor"),
  CONVEYOR_TICKS,
  RES_BYTES,
};

/**
 * Which member of which interface needs which thing owned.
 *
 * `module:` is asked of the bot whose script is on screen and `research:` of the
 * colony, because that is the difference between the two: a chassis carries a
 * scanner, and a colony owns a Fabricator.
 *
 * The harvester is here like every other module even though every bot ships with
 * one. A gate that is always met costs nothing, and the day a chassis arrives
 * without a harvester this file should not be where that breaks.
 */
const GATED: ReadonlyArray<{ owner: "BotApi" | "ColonyApi"; member: string; gate: string }> = [
  { owner: "BotApi", member: "harvester", gate: "module:harvester" },
  { owner: "BotApi", member: "planter", gate: "module:planter" },
  { owner: "BotApi", member: "scanner", gate: "module:scanner" },
  { owner: "BotApi", member: "radio", gate: "module:radio" },
  { owner: "BotApi", member: "builder", gate: "module:builder" },
  { owner: "ColonyApi", member: "fabricator", gate: "research:fabricator" },
];

/** Replace every `%name%`, and refuse to ship one nobody defined. */
export function substitute(source: string): string {
  return source.replace(/%([A-Za-z_][\w.]*)%/g, (_all, name: string) => {
    const value = NUMBERS[name];
    if (value === undefined) throw new Error(`no number named ${name} for a %${name}% in api.ts`);
    return String(value);
  });
}

/**
 * Lift one optional member — with the JSDoc above it, which is the whole point
 * — out of an interface body, and hand back both halves.
 */
function splitMember(text: string, member: string): { rest: string; block: string } {
  const at = new RegExp(`^[ \\t]*${member}\\?: \\{`, "m").exec(text);
  if (at === null) throw new Error(`no optional member ${member} to gate`);

  let start = at.index;
  // The hover text travels with the member. Without this the doc comment stays
  // behind in the core block, documenting a member that is no longer under it.
  // `\s` and not `[ \t]`: what sits between a doc comment and the member it
  // documents is a newline *and* the member's indent, and trimming only the
  // indent leaves the `*/` one character out of reach.
  const before = text.slice(0, start).replace(/\s*$/, "");
  if (before.endsWith("*/")) {
    const open = before.lastIndexOf("/**");
    if (open === -1) throw new Error(`unbalanced JSDoc above ${member}`);
    start = text.lastIndexOf("\n", open) + 1;
  }

  let depth = 0;
  let i = text.indexOf("{", at.index);
  for (; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) break;
  }
  if (depth !== 0) throw new Error(`unbalanced braces in member ${member}`);
  let end = i + 1;
  if (text[end] === ";") end++;
  if (text[end] === "\n") end++;

  return { rest: text.slice(0, start) + text.slice(end), block: text.slice(start, end).trimEnd() };
}

/** Pull one `interface Name { ... }` block out by matching braces. */
function extractInterface(source: string, name: string): string {
  const start = source.indexOf(`interface ${name} {`);
  if (start === -1) throw new Error(`no interface ${name} in emitted declarations`);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in interface ${name}`);
}

const stripExports = (s: string): string => s.replace(/^export (declare )?/gm, "");

export function generate(): string {
  const out = mkdtempSync(join(tmpdir(), "automatori-dts-"));
  try {
    // The local tsc entry point, run directly: no npx, and so no shell, which
    // execFileSync warns about on Windows when it is passed arguments.
    execFileSync(process.execPath, [
      join(root, "node_modules/typescript/bin/tsc"),
      "--declaration", "--emitDeclarationOnly", "--noEmit", "false",
      "--outDir", out,
      "--module", "ESNext", "--moduleResolution", "Bundler",
      "--allowImportingTsExtensions", "--target", "ES2022", "--strict",
      join(root, "src/bridge/api.ts"),
    ], { cwd: root, stdio: "pipe" });

    const api = substitute(readFileSync(join(out, "bridge/api.d.ts"), "utf8"));
    const protocol = readFileSync(join(out, "bridge/protocol.d.ts"), "utf8");
    const simTypes = readFileSync(join(out, "sim/types.d.ts"), "utf8");

    // Every gated member leaves its interface and comes back below it as a
    // block of its own. Declaration merging puts them back together, so a file
    // with every block present is the same type as before this existed.
    const core: Record<"BotApi" | "ColonyApi", string> = {
      BotApi: stripExports(extractInterface(api, "BotApi")),
      ColonyApi: stripExports(extractInterface(api, "ColonyApi")),
    };
    const blocks: string[] = [];
    for (const { owner, member, gate } of GATED) {
      const { rest, block } = splitMember(core[owner], member);
      core[owner] = rest;
      blocks.push([`//#gate ${gate}`, `interface ${owner} {`, block, "}", "//#endgate"].join("\n"));
    }

    return [
      "// Generated by scripts/generate-dts.ts from src/bridge/api.ts.",
      "// Do not edit by hand: `npm run generate:dts` and commit the result.",
      "",
      "// --- sim vocabulary ---------------------------------------------------",
      stripExports(simTypes).trimEnd(),
      "",
      "// --- a bot's readable state -------------------------------------------",
      stripExports(extractInterface(protocol, "MirrorState")),
      "",
      "// --- what colony.research.status() answers with ------------------------",
      stripExports(extractInterface(protocol, "ResearchStatus")),
      "",
      "// --- the player API, always present ------------------------------------",
      core.BotApi.trimEnd(),
      "",
      core.ColonyApi.trimEnd(),
      "",
      "// --- hardware, one block per thing that has to be owned -----------------",
      "// The editor loads only the blocks whose gate is met, so autocomplete on",
      "// `bot.` lists what this chassis carries. See src/editor/api-surface.ts.",
      "// Anything reading this file whole — a typecheck, a test — gets them all.",
      blocks.join("\n\n"),
      "",
      "// Player scripts see these as globals, not as imports.",
      "declare const bot: BotApi;",
      "declare const colony: ColonyApi;",
      "",
    ].join("\n");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// Only write to disk when run directly, so the test can call generate() alone.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, generate(), "utf8");
  console.log(`wrote ${OUT}`);
}
