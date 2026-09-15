import type { MachineKind, ModuleName, WorldSnapshot } from "../sim/types.ts";

/**
 * The hands phase: what the player owns and has not yet put anywhere.
 *
 * Milestone 3's finding 1 — "the research reward cannot be collected" — has
 * waited three milestones for this. Research stocks modules and chassis and
 * unlocks machine kinds; until now nothing could spend any of it.
 *
 * The list is derived from a snapshot rather than tracked, so it cannot fall
 * out of step with what research has actually granted.
 */
export type BuildOption =
  | { kind: "machine"; machine: MachineKind; label: string }
  | { kind: "module"; module: ModuleName; label: string }
  | { kind: "chassis"; label: string };

/** Machine kinds a completed research unlocks, in the order they are researched. */
const PLACEABLE: { research: MachineKind; label: string }[] = [
  { research: "crate", label: "Crate" },
  { research: "mill", label: "Mill" },
  { research: "oven", label: "Oven" },
];

export function buildOptions(snapshot: WorldSnapshot): BuildOption[] {
  const out: BuildOption[] = [];
  const unlocked = new Set<string>(snapshot.research.unlocked);

  for (const { research, label } of PLACEABLE) {
    // Machines are unlimited once researched: there is no build cost in the sim
    // yet, so the unlock *is* the gate. A second mill costs nothing but a tile.
    if (unlocked.has(research)) out.push({ kind: "machine", machine: research, label });
  }

  for (const [module, n] of Object.entries(snapshot.research.spareModules)) {
    if ((n ?? 0) <= 0) continue;
    const name = module as ModuleName;
    out.push({
      kind: "module",
      module: name,
      label: n === 1 ? `Fit ${name}` : `Fit ${name} (${n})`,
    });
  }

  const chassis = snapshot.research.spareChassis;
  if (chassis > 0) {
    out.push({ kind: "chassis", label: chassis === 1 ? "Deploy bot" : `Deploy bot (${chassis})` });
  }

  return out;
}

/**
 * What a placement would do to a tile, phrased for a player rather than a log.
 *
 * The sim's own refusal strings are the source; this only decorates them, so
 * there is exactly one place that decides whether a tile is legal.
 */
export function placementHint(reason: string | null, label: string): string {
  return reason === null ? label : reason;
}
