import { LADDERS } from "./snippets.ts";
import type { SavedChip } from "./saved-chips.ts";

/**
 * Nine numbered slots, each pointing at a chip somewhere else.
 *
 * **A slot holds a reference, never a copy.** This is Factorio's rule for the
 * quickbar and it is worth taking whole: rename a blueprint and the shortcut
 * shows the new name, edit it and the shortcut places the new thing, delete it
 * and the shortcut clears itself rather than lingering as a button that builds
 * something you thought you had thrown away. A bar of copies is a second store
 * that silently disagrees with the first one, and the disagreement surfaces at
 * the worst possible moment — when the player reaches for the thing by reflex.
 *
 * Nine rather than ten because a tenth slot reachable only as `0` is a
 * keybinding somebody has to be taught, and this bar is for the ones your hand
 * already knows.
 */

export type ChipRef =
  /** A rung of an authored ladder, by title — which `snippets.ts` keeps unique. */
  | { kind: "rung"; title: string }
  | { kind: "saved"; id: string };

export const SLOT_COUNT = 9;

export function sameRef(a: ChipRef, b: ChipRef): boolean {
  if (a.kind === "rung") return b.kind === "rung" && a.title === b.title;
  return b.kind === "saved" && a.id === b.id;
}

/** A stable string for a ref, for a redraw key and for `data-` attributes. */
export function refKey(ref: ChipRef): string {
  return ref.kind === "rung" ? `rung:${ref.title}` : `saved:${ref.id}`;
}

/**
 * What a slot actually shows, or null when it points at something that is gone.
 *
 * Resolving rather than storing is the whole of the decision above. A reference
 * that no longer resolves draws as an empty slot instead of throwing — which
 * `forget` makes rare rather than impossible, since storage can be edited and a
 * ladder can be renamed between one release and the next.
 */
export function resolveRef(ref: ChipRef, saved: readonly SavedChip[]): { name: string; code: string } | null {
  if (ref.kind === "saved") {
    const chip = saved.find((c) => c.id === ref.id);
    return chip ? { name: chip.name, code: chip.code } : null;
  }
  const rung = LADDERS.flatMap((l) => l.rungs).find((r) => r.title === ref.title);
  return rung ? { name: rung.title, code: rung.code } : null;
}

const STORAGE_KEY = "automatori:bar";

function readStored(): (ChipRef | null)[] | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return Array.from({ length: SLOT_COUNT }, (_, i) => {
      const slot = parsed[i] as ChipRef | null | undefined;
      if (slot?.kind === "rung" && typeof slot.title === "string") return slot;
      if (slot?.kind === "saved" && typeof slot.id === "string") return slot;
      return null;
    });
  } catch {
    return null;
  }
}

export class ChipBar {
  private readonly bar: (ChipRef | null)[];

  constructor() {
    this.bar = readStored() ?? Array.from({ length: SLOT_COUNT }, () => null);
  }

  private persist(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.bar));
    } catch {
      // Same three reasons as everywhere else. A bar that forgets itself
      // between visits is much better than a page that fails to open.
    }
  }

  slots(): readonly (ChipRef | null)[] {
    return this.bar;
  }

  slotOf(ref: ChipRef): number | null {
    const i = this.bar.findIndex((s) => s !== null && sameRef(s, ref));
    return i === -1 ? null : i;
  }

  /**
   * Put this on the bar and say which key it landed under.
   *
   * Pinning something already pinned answers its existing slot rather than
   * taking a second one: the button on a chip is "put this where I can reach
   * it", and a player pressing it twice meant it once.
   *
   * @returns the slot index, or null when all nine are taken.
   */
  pin(ref: ChipRef): number | null {
    const already = this.slotOf(ref);
    if (already !== null) return already;
    const free = this.bar.indexOf(null);
    if (free === -1) return null;
    this.bar[free] = ref;
    this.persist();
    return free;
  }

  /** Drop something into a chosen slot, replacing whatever was there. */
  set(index: number, ref: ChipRef): void {
    if (index < 0 || index >= SLOT_COUNT) return;
    this.bar[index] = ref;
    this.persist();
  }

  clear(index: number): void {
    if (index < 0 || index >= SLOT_COUNT) return;
    this.bar[index] = null;
    this.persist();
  }

  /** Forget every slot pointing at this — what a deleted chip must trigger. */
  forget(ref: ChipRef): void {
    let changed = false;
    this.bar.forEach((slot, i) => {
      if (slot !== null && sameRef(slot, ref)) {
        this.bar[i] = null;
        changed = true;
      }
    });
    if (changed) this.persist();
  }
}
