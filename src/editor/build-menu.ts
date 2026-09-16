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
 *
 * `remove` is the odd one out and knows it: it is a tool rather than stock, and
 * it is here because milestone 7's Decision 9 chose one more armed mode over a
 * second way of pointing at a tile.
 */
export type BuildOption =
  | { kind: "machine"; machine: MachineKind; label: string }
  | { kind: "module"; module: ModuleName; label: string }
  | { kind: "chassis"; label: string }
  | { kind: "remove"; label: string };

/** Machine kinds a completed research unlocks, in the order they are researched. */
const PLACEABLE: { research: MachineKind; label: string }[] = [
  { research: "crate", label: "Crate" },
  { research: "mill", label: "Mill" },
  { research: "oven", label: "Oven" },
  { research: "conveyor", label: "Conveyor" },
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

  // Last, and only once there is something it could act on. A tool that can do
  // nothing is not an offer, and the console is not removable by anyone — so a
  // world with only a console in it has nothing for this mode to point at.
  if (snapshot.machines.some((m) => m.kind !== "console")) {
    out.push({ kind: "remove", label: "Remove" });
  }

  return out;
}

// `placementHint` lived here and was never called by anything. Milestone 6's
// Task 6 needed the tooltip to say more than one line — the placement *and*
// what is already on the tile — so the job moved to `describePlacement` in the
// inspector, beside `describeTile`, which is the other half of what it prints.
