import type { ScriptStatus } from "../bridge/colony.ts";
import { SNIPPETS } from "./snippets.ts";

/**
 * When the game has something worth saying, and which chip says it.
 *
 * The design's first ten minutes: *"Press Run. The bot harvests and steps east,
 * then stops because the script ended. Insight one: wrap it in a loop."* Nothing
 * in the game helped that insight happen. The player who has it is fine; the
 * player who does not press Run again, watch the same two ticks, and have no
 * reason to believe anything different is available.
 *
 * The same design says **"No tutorial popups"**, and that rule is what shapes
 * everything here:
 *
 * - A suggestion is **earned by something the player did**, never by a timer and
 *   never on arrival. Every rule reads history, so a player who never gets stuck
 *   never sees one.
 * - It points at a chip the **snippet book already has**. This is the book
 *   surfaced at the right moment, not a second corpus of advice that can drift
 *   from it — which is also why a rule names a chip by title and a test fails if
 *   that title stops existing.
 * - It **retires for good** once taken or dismissed. A suggestion that comes back
 *   after being refused is a popup with extra steps.
 *
 * No DOM and no Monaco here: what counts as a moment worth speaking at is a rule
 * about the game, and it deserves tests that do not need a browser.
 */

/** How a run the player started ended, as the rules need to see it. */
export interface RunRecord {
  status: ScriptStatus;
  /** Whether the source that ran actually loops. See `hasLoop`. */
  looped: boolean;
}

export interface Suggestion {
  /** Stable across firings, so dismissing one dismisses it for good. */
  id: string;
  /** The book chip whose code this offers. */
  chip: string;
  /** Why it is on screen, in the player's own terms. One line. */
  why: string;
  code: string;
}

/**
 * Enough history for the rules to read, per bot.
 *
 * A list rather than a counter because the rules that come next — bumping the
 * same wall, filling up and harvesting anyway — want different slices of the
 * same past, and a counter per rule is how that becomes six fields nobody can
 * name.
 */
interface History {
  runs: RunRecord[];
}

/** Runs kept per bot. Two is what today's rule reads; the rest is headroom. */
const MAX_RUNS = 4;

interface Rule {
  id: string;
  chip: string;
  why: string;
  fires(history: History): boolean;
}

const RULES: readonly Rule[] = [
  {
    id: "wrap-it-in-a-loop",
    chip: "Harvest in a loop",
    why: "This script ran to the end and stopped. A loop keeps the bot going.",
    /**
     * Twice, and only for a script with no loop in it.
     *
     * **Once is not a signal.** A first run ending is the game working exactly as
     * the design intends — that is the moment the player is supposed to feel.
     * Pressing Run a second time and watching the same two ticks is the moment
     * they are supposed to act on, and the second one is where the help belongs.
     *
     * Looplessness rather than a duration threshold, which was the other
     * candidate. A threshold needs a tuned constant this milestone has no
     * measurement for, and it would fire at a `while (true)` that ended for some
     * unrelated reason — suggesting a loop to somebody who wrote one. Reading the
     * source instead means the rule retires itself the instant the player adds
     * the loop, which is the behaviour that makes it feel like it was watching
     * rather than counting.
     */
    fires: (h) =>
      h.runs.length >= 2 && h.runs.slice(-2).every((r) => r.status === "done" && !r.looped),
  },
];

/**
 * True when the source actually loops.
 *
 * Comments and strings are blanked first, so `// go east for one tile` is prose
 * and not a `for`. The cost of getting that wrong is a suggestion that silently
 * never appears, which is the worst kind of bug this file could have: nobody
 * would ever report it.
 */
export function hasLoop(source: string): boolean {
  return /\b(?:while|for|do)\b/.test(stripNonCode(source));
}

/**
 * The source with comment and string bodies removed.
 *
 * A left-to-right scan rather than a chain of regexes: a `//` inside a string and
 * a quote inside a comment each break the regex version, in opposite directions.
 *
 * Known limit, stated rather than hidden: a regex literal containing a quote —
 * `/["']/` — opens a string that is never closed, and the rest of the file is
 * swallowed. A beginner's farm script does not contain one, and the failure is a
 * suggestion that does not appear rather than a wrong one that does.
 */
function stripNonCode(source: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (pair === "/*") {
      i += 2;
      while (i < source.length && source.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    const quote = source[i]!;
    if (quote === '"' || quote === "'" || quote === "`") {
      i++;
      while (i < source.length && source[i] !== quote) {
        // A backslash eats whatever follows it, including the closing quote.
        i += source[i] === "\\" ? 2 : 1;
      }
      i++;
      continue;
    }
    out.push(quote);
    i++;
  }
  return out.join("");
}

export interface Suggester {
  /** Record how a run the player started ended. */
  ran(botId: number, source: string, status: ScriptStatus): void;
  /** The one thing worth saying to this bot's author right now, if anything. */
  suggest(botId: number): Suggestion | null;
  /** Retire a suggestion for the rest of the session: taken, or refused. */
  retire(id: string): void;
}

export function createSuggester(): Suggester {
  const histories = new Map<number, History>();
  const retired = new Set<string>();

  const historyFor = (botId: number): History => {
    let h = histories.get(botId);
    if (!h) {
      h = { runs: [] };
      histories.set(botId, h);
    }
    return h;
  };

  return {
    ran(botId, source, status) {
      const h = historyFor(botId);
      h.runs.push({ status, looped: hasLoop(source) });
      if (h.runs.length > MAX_RUNS) h.runs.shift();
    },

    suggest(botId) {
      const h = historyFor(botId);
      // First match wins, so RULES is in priority order. With one rule that is
      // not yet a decision; with four it is, and the list is where it lives.
      for (const rule of RULES) {
        if (retired.has(rule.id) || !rule.fires(h)) continue;
        return { id: rule.id, chip: rule.chip, why: rule.why, code: codeFor(rule.chip) };
      }
      return null;
    },

    retire(id) {
      retired.add(id);
    },
  };
}

/** Exported for the test that keeps every rule pointing at a chip that exists. */
export const SUGGESTED_CHIPS: readonly string[] = RULES.map((r) => r.chip);

function codeFor(title: string): string {
  const snippet = SNIPPETS.find((s) => s.title === title);
  if (!snippet) throw new Error(`no snippet titled ${title} for a suggestion to offer`);
  return snippet.code;
}
