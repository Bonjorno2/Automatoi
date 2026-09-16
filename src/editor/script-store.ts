import { OPENING_SCRIPT } from "./opening-script.ts";

/**
 * One source string per bot, and which bot the editor is pointed at.
 *
 * A module rather than three lines in `main.ts` because the interesting part is
 * a rule, not a Map: **the buffer on screen belongs to the selected bot until
 * the selection moves, at which point it must be written back before the new
 * one is read.** Getting that wrong loses a player's work silently, which is
 * the worst kind of bug an editor can have, so it is worth a test that drives
 * the real thing rather than a restatement of it.
 */
/**
 * What the editor is pointed at. A bot id, or the colony's shared library.
 *
 * Milestone 9's Task 4. The library is one more buffer and deliberately not one
 * more bot: it has no position, no inventory and no worker, and giving it a fake
 * bot id so that `Map<number, string>` still worked would be a lie the fleet
 * list would have to be taught to ignore.
 */
export const LIBRARY = "library" as const;
export type Target = number | typeof LIBRARY;

/** What a freshly unlocked library opens with, rather than an empty buffer. */
export const OPENING_LIBRARY = `// Everything here is in scope in every bot's script.
//
// This is where a function you want more than one bot to call lives — the
// design calls it the shared library, and it is what \`import\` would have been.

// function stamp(layout) {
//   for (const step of layout) {
//     bot.builder.place(step.machine, step.dir, step.facing);
//     bot.move(step.dir);
//   }
// }
`;

/**
 * Where the browser keeps a player's work between visits.
 *
 * Scripts live here and **not** in the progress key, which is the split milestone
 * 10 chose: the key is short, portable and readable aloud, and it carries what
 * you learned; your actual code is neither short nor anybody else's business.
 * Losing a serpentine sweep you spent ten minutes on is the thing a player would
 * genuinely mourn, and it is the thing a browser is good at remembering.
 */
const STORAGE_KEY = "automatori:scripts";

/**
 * Reading and writing storage never throws out of this module.
 *
 * `localStorage` is absent in a Node test, blocked in a locked-down browser and
 * full at some size nobody documents. None of those is a reason for a player's
 * editor to fail to open, and all of them mean the same thing here: there is no
 * saved work, carry on with the opening script.
 */
function readStored(): Map<Target, string> | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out = new Map<Target, string>();
    for (const [key, source] of Object.entries(parsed)) {
      if (typeof source !== "string") continue;
      out.set(key === LIBRARY ? LIBRARY : Number(key), source);
    }
    return out.size ? out : null;
  } catch {
    return null;
  }
}

export class ScriptStore {
  private readonly sources = new Map<Target, string>();
  private selected: Target | null;

  constructor(firstBotId: number) {
    this.selected = firstBotId;
    this.sources.set(firstBotId, OPENING_SCRIPT);
    this.sources.set(LIBRARY, OPENING_LIBRARY);
    for (const [target, source] of readStored() ?? []) this.sources.set(target, source);
  }

  /** Write every buffer to storage. Called whenever one of them changes. */
  private persist(): void {
    try {
      const plain: Record<string, string> = {};
      for (const [target, source] of this.sources) plain[String(target)] = source;
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(plain));
    } catch {
      // A player whose storage is full or blocked still gets to write code.
    }
  }

  /** Forget the saved work. The other half of a key that starts a fresh game. */
  static clearStored(): void {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do, and nothing worth saying.
    }
  }

  get selectedBotId(): number | null {
    return typeof this.selected === "number" ? this.selected : null;
  }

  /** What every worker is started with. Empty until the player researches it. */
  library(): string {
    return this.sources.get(LIBRARY) ?? "";
  }

  /** True while the editor is showing the library rather than a bot. */
  get editingLibrary(): boolean {
    return this.selected === LIBRARY;
  }

  /**
   * A bot with no script yet opens on the opening script rather than an empty
   * buffer. An empty editor is a worse prompt than two lines that do something.
   */
  sourceFor(target: Target): string {
    return this.sources.get(target) ?? (target === LIBRARY ? OPENING_LIBRARY : OPENING_SCRIPT);
  }

  /** Write the on-screen text back to whichever bot currently owns it. */
  stash(currentText: string): void {
    if (this.selected === null) return;
    if (this.sources.get(this.selected) === currentText) return;
    this.sources.set(this.selected, currentText);
    this.persist();
  }

  /**
   * Point the editor at another bot.
   *
   * @param currentText what is on screen right now, stashed before the switch
   * @returns the text to show, or null when nothing is selected
   */
  select(target: Target | null, currentText: string): string | null {
    this.stash(currentText);
    this.selected = target;
    return target === null ? null : this.sourceFor(target);
  }
}
