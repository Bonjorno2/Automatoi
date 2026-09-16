/**
 * Which slice of the player API the editor is allowed to know about.
 *
 * The design's claim is that *"namespaces are the tutorial — autocomplete on
 * `bot.` lists what you have"*, and until milestone 10 that was false: the whole
 * generated `.d.ts` went into Monaco at boot, so a fresh save autocompleted
 * `bot.builder` and `colony.fabricator` on a chassis that had neither and a
 * colony that had researched neither. The editor contradicted the tech tree,
 * which is the one thing the "research is the API" pitch rests on.
 *
 * So the generator splits every piece of hardware into a `//#gate` block that
 * merges back into the interface, and this file decides which blocks Monaco
 * sees. A locked namespace is **absent**, not struck through: the point is that
 * the list of what you can do is the list of what you own, and a greyed-out
 * entry is still an entry.
 *
 * No Monaco import on purpose — `editor.ts` cannot be loaded under Vitest, and
 * the rule about what a player can see deserves tests of its own.
 */

/** One run of the file: ungated when `gate` is null, earned when it is not. */
export interface ApiPart {
  readonly gate: string | null;
  readonly text: string;
}

export interface ApiSurface {
  /**
   * The file in order, gated and ungated runs alike.
   *
   * In order, and not a base plus a bag of blocks, because a composed file has
   * to be the committed file with lines removed — nothing else. Appending the
   * earned blocks after the `declare const bot` at the bottom would typecheck
   * identically and diff against the source forever.
   */
  readonly parts: readonly ApiPart[];
  /** Everything outside a gate: the sim's vocabulary and the verbs a bot always has. */
  readonly base: string;
  /** Gate name (`module:scanner`, `research:fabricator`) to the block it guards. */
  readonly gates: ReadonlyMap<string, string>;
}

const GATE_OPEN = /^\/\/#gate (.+)$/;
const GATE_CLOSE = "//#endgate";

/**
 * Split the generated file into what is always there and what has to be earned.
 *
 * Line-based rather than a regex over the whole file, so an unterminated block
 * is an error here rather than a silently swallowed rest-of-file.
 */
export function parseApiSurface(dts: string): ApiSurface {
  const parts: ApiPart[] = [];
  const gates = new Map<string, string>();
  let plain: string[] = [];
  let open: { name: string; lines: string[] } | null = null;

  const flushPlain = (): void => {
    if (plain.length) parts.push({ gate: null, text: plain.join("\n") });
    plain = [];
  };

  for (const line of dts.split("\n")) {
    const start = GATE_OPEN.exec(line.trim());
    if (start) {
      if (open) throw new Error(`gate ${start[1]} opened inside gate ${open.name}`);
      flushPlain();
      open = { name: start[1]!, lines: [] };
      continue;
    }
    if (line.trim() === GATE_CLOSE) {
      if (!open) throw new Error("a //#endgate with no //#gate above it");
      if (gates.has(open.name)) throw new Error(`two blocks gated on ${open.name}`);
      const text = open.lines.join("\n").trim();
      gates.set(open.name, text);
      parts.push({ gate: open.name, text });
      open = null;
      continue;
    }
    (open ? open.lines : plain).push(line);
  }
  if (open) throw new Error(`gate ${open.name} was never closed`);
  flushPlain();

  const base = parts.filter((p) => p.gate === null).map((p) => p.text).join("\n");
  return { parts, base, gates };
}

/**
 * The type file for a player who owns exactly `owned`.
 *
 * A gate nobody has is dropped; an `owned` entry with no gate is ignored rather
 * than an error, because the caller is handing us a bot's whole module list and
 * a colony's whole research list, most of which gate nothing.
 */
export function composeApi(surface: ApiSurface, owned: ReadonlySet<string>): string {
  // Walked in file order, not over `owned`, so two equal surfaces produce
  // byte-identical text — which is what lets `addExtraLib` no-op instead of
  // re-typechecking the world every frame.
  return surface.parts
    .filter((p) => p.gate === null || owned.has(p.gate))
    .map((p) => p.text)
    .join("\n");
}

/**
 * What a bot with these modules, in a colony with this research, has earned.
 *
 * Both halves in one function because the answer is one set: `bot.scanner`
 * follows the chassis and `colony.fabricator` follows the tech tree, and a
 * caller should not have to remember which is which.
 */
export function ownedGates(modules: Iterable<string>, research: Iterable<string>): Set<string> {
  const owned = new Set<string>();
  for (const m of modules) owned.add(`module:${m}`);
  for (const r of research) owned.add(`research:${r}`);
  return owned;
}
