import type { ScriptStatus } from "../bridge/colony.ts";
import type { WorldEvent } from "../sim/events.ts";
import type { ResearchName, WorldSnapshot } from "../sim/types.ts";
import { SNIPPETS } from "./snippets.ts";
import { hasLoop, mentions, primitivesIn } from "./source.ts";
import type { Primitive } from "./source.ts";

/**
 * When the codebook has something worth saying, and which of its chips says it.
 *
 * The design's first ten minutes: *"Press Run. The bot harvests and steps east,
 * then stops because the script ended. Insight one: wrap it in a loop."* Nothing
 * in the game helped that insight happen. The player who has it is fine; the
 * player who does not press Run again, watch the same two ticks, and have no
 * reason to believe anything different is available.
 *
 * The same design says **"No tutorial popups"**, and that rule shapes all of it:
 *
 * - A suggestion is **earned by something the player did**, never by a timer and
 *   never on arrival. Every rule reads history, so a player who never gets stuck
 *   never sees one.
 * - It is **a chip of the codebook, raised**. Not a parallel corpus of advice
 *   that can drift from the book — the same chip, in the same place the player
 *   will come back to for it later. A rule names a chip by title and a test
 *   fails the build if that title stops existing.
 * - It **retires for good** once taken or dismissed, and the chip stays in the
 *   book. Refusing advice is not the same as losing it.
 *
 * No DOM and no Monaco here: what counts as a moment worth speaking at is a rule
 * about the game, and it deserves tests that do not need a browser.
 */

/** How a run the player started ended, as the rules need to see it. */
export interface RunRecord {
  status: ScriptStatus;
  /** What actually ran. Rules read it; none of them stores a verdict about it. */
  source: string;
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
 * Enough of one bot's past for the rules to read.
 *
 * `bumps` and `fulls` count within the current run rather than for all time: the
 * question every rule is really asking is "is this script, the one on screen
 * now, getting nowhere", and a total carried across a rewrite answers a
 * different question with the same number.
 */
interface History {
  runs: RunRecord[];
  /**
   * The script running right now, which is not in `runs` and never will be.
   *
   * Found by driving the page: `stay-on-the-field` asks whether the script
   * loops, `runs` only gains an entry when a script *settles*, and a
   * `while (true)` never settles. So the one rule about a script that runs
   * forever could only read scripts that had stopped, and it never fired once.
   */
  current: string | null;
  bumps: number;
  fulls: number;
}

/** What the colony as a whole offers the rules. Not per bot, because none of it is. */
interface Colony {
  /** Research that has landed. Cleared by nothing: a rule retires itself instead. */
  landed: Set<ResearchName>;
  /** A crate is standing somewhere in the world, so there is a place to put things. */
  hasCrate: boolean;
}

/** Runs kept per bot. Two is what the loop rule reads; the rest is headroom. */
const MAX_RUNS = 4;

/**
 * Bumps in one run before the game mentions it, and fulls before it does.
 *
 * Both are guesses and are named as guesses, per the house rule about numbers
 * nobody has measured. The shape of the guess: one bump is a bot turning around,
 * which is a script working. Eight is a bot pressed against the same wall for
 * sixteen ticks, which is the thing milestone 3's playtest found players watched
 * without understanding. Three fulls is a bot that has harvested nothing for a
 * while and looks busy doing it.
 */
const BUMPS_BEFORE_SPEAKING = 8;
const FULLS_BEFORE_SPEAKING = 3;

/**
 * The chip that teaches each piece of hardware, the moment it arrives.
 *
 * A partial map on purpose: a research with no chip to show — the mill, the oven,
 * the chassis, the library, the fabricator — raises nothing, because the honest
 * answer is that the book has nothing to say about it yet. Adding a chip is what
 * adds the suggestion, which is the coupling this file wants.
 */
const CHIP_FOR_RESEARCH: Partial<Record<ResearchName, string>> = {
  planter: "Harvest, then replant",
  scanner: "Look before you move",
  crate: "Empty into a crate",
  radio: "Take orders by radio",
  builder: "Lay a line of belts",
};

/** What a script has to mention for the game to stop explaining that hardware. */
const USES: Partial<Record<ResearchName, string>> = {
  planter: "bot.planter",
  scanner: "bot.scanner",
  crate: "bot.deposit",
  radio: "bot.radio",
  builder: "bot.builder",
};

interface Rule {
  id: string;
  chip: string;
  why: string;
  fires(history: History, colony: Colony): boolean;
}

/**
 * In priority order, because only one thing gets said at a time.
 *
 * Order by how stuck the player is, not by how clever the advice is. They rarely
 * collide — a script that never ends cannot raise the loop rule, and a bot
 * pressed against a wall is not filling up — but when they do, the rule about
 * what is happening right now beats the rule about what just became available.
 */
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
      h.runs.length >= 2 &&
      h.runs.slice(-2).every((r) => r.status === "done" && !hasLoop(r.source)),
  },
  {
    id: "stay-on-the-field",
    chip: "Stay on the field",
    why: "This bot keeps walking into something. move() answers false — turn around instead.",
    /**
     * The naive loop's own failure, and the sharpest thing milestone 3's playtest
     * found: `while (true) { harvest(); move("east"); }` walks off the field and
     * pushes into the edge forever, with the bot looking busy the whole time.
     *
     * Only for a script that loops. A loopless script cannot bump eight times —
     * it has two commands in it — so requiring the loop costs nothing here and
     * keeps this rule from ever being the answer to "your script ended".
     */
    fires: (h) => h.bumps >= BUMPS_BEFORE_SPEAKING && looping(h),
  },
  {
    id: "somewhere-to-put-it",
    chip: "Empty into a crate",
    why: "This bot is full, so harvest() does nothing. There is a crate to empty into.",
    // Ahead of "Don't overfill" whenever a crate exists, because it is the better
    // answer: stopping when full is cycle one's fix and depositing is cycle two's,
    // and by the time there is a crate on the map the player has bought their way
    // out of the first one.
    fires: (h, c) => h.fulls >= FULLS_BEFORE_SPEAKING && c.hasCrate,
  },
  {
    id: "dont-overfill",
    chip: "Don't overfill",
    why: "This bot is full, so harvest() does nothing. Stop before that and go somewhere.",
    fires: (h, c) => h.fulls >= FULLS_BEFORE_SPEAKING && !c.hasCrate,
  },
  ...hardwareRules(),
];

/**
 * One rule per piece of hardware that has a chip, generated rather than listed.
 *
 * Generated so that each carries its **own** id: dismissing "the scanner
 * arrived" must not also dismiss "the planter arrived", and one rule whose id
 * varied with what fired it would be a dismissal that hits whatever came next.
 */
function hardwareRules(): Rule[] {
  return Object.entries(CHIP_FOR_RESEARCH).map(([name, chip]) => {
    const research = name as ResearchName;
    const uses = USES[research];
    return {
      id: `new-hardware:${research}`,
      chip,
      why: `The ${research} has arrived. This is what it does.`,
      /**
       * Until the player writes it themselves.
       *
       * The same self-retiring shape as the loop rule, and for the same reason:
       * a suggestion that has to be dismissed by hand is a suggestion that
       * outstays its welcome by exactly as long as the player ignores it. A
       * script that says `bot.scanner` has answered the question.
       */
      fires: (h: History, c: Colony) =>
        c.landed.has(research) &&
        !(uses !== undefined && allSources(h).some((s) => mentions(s, uses))),
    };
  });
}

/** The script the player most recently set going, running or finished. */
const newest = (h: History): string | undefined => h.current ?? h.runs.at(-1)?.source;

/** Everything this bot has been asked to run, including what is running now. */
const allSources = (h: History): string[] =>
  h.current === null ? h.runs.map((r) => r.source) : [...h.runs.map((r) => r.source), h.current];

const looping = (h: History): boolean => {
  const source = newest(h);
  return source !== undefined && hasLoop(source);
};

export interface Suggester {
  /** A run is starting: this script's failures are its own, and this is its source. */
  started(botId: number, source: string): void;
  /** Record how a run the player started ended. */
  ran(botId: number, source: string, status: ScriptStatus): void;
  /** One frame's events, from the same drain the marks and effects read. */
  saw(events: readonly WorldEvent[]): void;
  /** What the world looks like now, for the rules that ask about the colony. */
  world(snapshot: WorldSnapshot): void;
  /** The one thing worth saying to this bot's author right now, if anything. */
  suggest(botId: number): Suggestion | null;
  /** Retire a suggestion for the rest of the session: taken, or refused. */
  retire(id: string): void;
  /**
   * Chips the game has raised at some point, whether or not they were taken.
   *
   * The codebook counts these as unlocked rungs. **Being shown something counts
   * as having learned it** — the alternative gates the loop chip behind having
   * written a loop, which makes it unreachable for exactly the player it is for.
   */
  offered(): ReadonlySet<string>;
  /**
   * Every primitive the player has actually set running, across every bot.
   *
   * Colony-wide and never forgotten, because it is a record of what this player
   * knows rather than of what some bot is doing. The codebook unlocks its rungs
   * against this.
   */
  vocabulary(): ReadonlySet<Primitive>;
  /**
   * Put back what a progress key remembered.
   *
   * Additive, never a replacement: a player who types a key mid-session keeps
   * what they have learned since booting. There is no case where forgetting
   * something the player has demonstrably done is the right answer.
   */
  restore(facts: { vocabulary: Iterable<string>; offered: Iterable<string> }): void;
}

export function createSuggester(): Suggester {
  const histories = new Map<number, History>();
  const retired = new Set<string>();
  const seen = new Set<string>();
  const known = new Set<Primitive>();
  const colony: Colony = { landed: new Set(), hasCrate: false };

  const historyFor = (botId: number): History => {
    let h = histories.get(botId);
    if (!h) {
      h = { runs: [], current: null, bumps: 0, fulls: 0 };
      histories.set(botId, h);
    }
    return h;
  };

  return {
    started(botId, source) {
      const h = historyFor(botId);
      h.current = source;
      h.bumps = 0;
      h.fulls = 0;
      // Counted at the start rather than at the end: a `while (true)` is the
      // most that can be known about a player's vocabulary and it never settles,
      // so waiting for a verdict would mean the best scripts taught the book
      // nothing. Running it is the demonstration; finishing it is not.
      for (const p of primitivesIn(source)) known.add(p);
    },

    ran(botId, source, status) {
      const h = historyFor(botId);
      h.current = null;
      h.runs.push({ status, source });
      if (h.runs.length > MAX_RUNS) h.runs.shift();
    },

    saw(events) {
      for (const e of events) {
        if (e.kind === "bump") historyFor(e.botId).bumps++;
        else if (e.kind === "full") historyFor(e.botId).fulls++;
        else if (e.kind === "research") colony.landed.add(e.name);
      }
    },

    world(snapshot) {
      colony.hasCrate = snapshot.machines.some((m) => m.kind === "crate");
    },

    suggest(botId) {
      const h = historyFor(botId);
      for (const rule of RULES) {
        if (retired.has(rule.id) || !rule.fires(h, colony)) continue;
        seen.add(rule.chip);
        return { id: rule.id, chip: rule.chip, why: rule.why, code: codeFor(rule.chip) };
      }
      return null;
    },

    retire(id) {
      retired.add(id);
    },

    offered() {
      return seen;
    },

    vocabulary() {
      return known;
    },

    restore(facts) {
      for (const p of facts.vocabulary) known.add(p as Primitive);
      for (const chip of facts.offered) seen.add(chip);
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
