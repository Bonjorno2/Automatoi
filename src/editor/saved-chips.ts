/**
 * The chips the player saved, as opposed to the ones the game hands over.
 *
 * The codebook has always been authored content — nine ladders the game climbs
 * for you. This is the other half, and the prior art is unambiguous about it
 * being a *different* half: World of Warcraft's spellbook holds what you were
 * taught, and its macro window holds what you wrote, and they are two windows
 * because they answer two questions. Here they are one panel, for milestone
 * 10's reason — *somewhere to look* is the whole point of a book — but they are
 * still two stores, and only this one can be written to.
 *
 * Kept apart from `snippets.ts` deliberately: that file is content, checked by
 * `ladders.test.ts` against the design doc. Nothing a player types belongs in it.
 */

import { stripNonCode } from "./source.ts";

/** One chip the player saved. `id` is what a bar slot points at. */
export interface SavedChip {
  id: string;
  name: string;
  code: string;
}

export type SaveResult = { ok: true; chip: SavedChip } | { ok: false; reason: string };

/**
 * How long a saved chip may be, in the unit the player is looking at.
 *
 * **This is a graduation path, not a storage limit.** WoW caps a macro at 255
 * characters, and that cap is the most load-bearing number in its whole macro
 * system: it says a macro is a shorthand, so the moment its players wanted
 * programs they went and wrote addons instead. The colony already has the right
 * home for a program — the shared library, where a function is in scope in every
 * bot's script — and a snippet book that quietly swallowed forty lines would be
 * competing with it and winning for the wrong reason.
 *
 * Twelve because the longest rung the game itself offers is eight, so a player
 * has room to save something bigger than anything they were handed before the
 * book tells them they have written a program.
 */
export const MAX_CHIP_LINES = 12;

/**
 * What to call a selection, before the player calls it something better.
 *
 * The verb it starts with, which is what a player would say the chip *is*: the
 * thing they selected four lines of code to do. A name is never blank — an
 * unnamed chip is a chip nobody can find again, and the panel prefills this
 * rather than asking a player to invent something before they have saved
 * anything.
 */
export function suggestName(code: string): string {
  const call = /\b(?:bot|colony)(?:\.\w+\??)*\.(\w+)\s*\(/.exec(stripNonCode(code));
  if (call?.[1]) return call[1];
  const first = code.split("\n").find((line) => line.trim() !== "");
  return first ? first.trim().slice(0, 24) : "chip";
}

/** Lines as the player sees them, ignoring blank ones at the end of a selection. */
export function lineCount(code: string): number {
  const trimmed = code.replace(/\s+$/, "");
  return trimmed === "" ? 0 : trimmed.split("\n").length;
}

/**
 * Where the browser keeps them. Beside the scripts and not in the progress key:
 * milestone 10 split those two on purpose, and a saved chip is code.
 */
const STORAGE_KEY = "automatori:chips";

interface Stored {
  next: number;
  chips: SavedChip[];
}

/**
 * Reading and writing storage never throws out of this module, for the three
 * reasons `script-store.ts` gives: no `localStorage` in a Node test, a blocked
 * one in a locked-down browser, and a full one at some size nobody documents.
 */
function readStored(): Stored | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    const chips = (parsed.chips ?? []).filter(
      (c): c is SavedChip =>
        typeof c?.id === "string" && typeof c.name === "string" && typeof c.code === "string",
    );
    return { next: typeof parsed.next === "number" ? parsed.next : chips.length + 1, chips };
  } catch {
    return null;
  }
}

export class SavedChips {
  private chips: SavedChip[];
  /** Ids are never reused, so a bar slot cannot be inherited by a later chip. */
  private next: number;

  constructor() {
    const stored = readStored();
    this.chips = stored?.chips ?? [];
    this.next = stored?.next ?? 1;
  }

  private persist(): void {
    try {
      const state: Stored = { next: this.next, chips: this.chips };
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // A player whose storage is full or blocked still gets to write code.
    }
  }

  list(): readonly SavedChip[] {
    return this.chips;
  }

  get(id: string): SavedChip | undefined {
    return this.chips.find((c) => c.id === id);
  }

  /**
   * Save a selection under a name.
   *
   * @param library whether the shared library is researched, which changes only
   * the sentence a refusal comes back with. Naming a thing the player has not
   * unlocked would be advice they cannot take.
   */
  save(name: string, code: string, library = false): SaveResult {
    const trimmedName = name.trim();
    const trimmedCode = code.replace(/\s+$/, "");
    if (trimmedCode === "") return { ok: false, reason: "nothing selected to save" };
    if (trimmedName === "") return { ok: false, reason: "give the chip a name" };

    const lines = lineCount(trimmedCode);
    if (lines > MAX_CHIP_LINES) {
      return {
        ok: false,
        reason: library
          ? `${lines} lines is a program, not a chip — put it in the shared library instead`
          : `${lines} lines is a program, not a chip — chips stop at ${MAX_CHIP_LINES}`,
      };
    }

    const chip: SavedChip = { id: `c${this.next++}`, name: trimmedName, code: trimmedCode };
    this.chips = [...this.chips, chip];
    this.persist();
    return { ok: true, chip };
  }

  /** @returns false when there is no such chip, or the name was blank. */
  rename(id: string, name: string): boolean {
    const trimmed = name.trim();
    if (trimmed === "") return false;
    const chip = this.get(id);
    if (!chip) return false;
    this.chips = this.chips.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
    this.persist();
    return true;
  }

  remove(id: string): boolean {
    if (!this.get(id)) return false;
    this.chips = this.chips.filter((c) => c.id !== id);
    this.persist();
    return true;
  }
}
