import { LADDERS } from "./snippets.ts";

/**
 * The save, as a code you can read out loud.
 *
 * There is no other save in this game — nothing persisted at all before this, so
 * a reload lost the world, the research and everything the codebook knew about
 * the player. What a key restores is deliberately **not** the world: it is what
 * the player has *learned* and what they have *researched*, which is small
 * enough to be eleven characters and is the part that took time to earn. Your
 * farm is a thing you can rebuild in a minute; your vocabulary is not.
 *
 * That split is also the design's own. "Research hands out hardware, never
 * language features"; "code is always free". A save that is a certificate of
 * what you know rather than a snapshot of where your belts were is the same idea
 * stated once more.
 *
 * ## The ordering trap, handled up front
 *
 * A compact key is a bitfield, and a bitfield means every bit's meaning is its
 * **position**. Insert a primitive in the middle of the list in three months and
 * every key ever issued silently decodes into somebody else's progress — the
 * player types their own key and is handed a different game. There is no way to
 * detect it after the fact, which is what makes it worth a whole section here.
 *
 * So `FACTS` is **append-only and frozen**. New facts go on the end, never in
 * the middle, and never get removed — a retired fact keeps its slot as a
 * tombstone. `tests/editor/progress-key.test.ts` pins the exact list, so
 * reordering it fails the build rather than the player.
 *
 * When the list outgrows what the current version can carry, bump `VERSION`.
 * A key names its own version, so an old reader refuses a new key with a
 * sentence rather than quietly misreading it.
 */

/** Every fact a key can carry, in an order that must never change. */
export const FACTS = [
  // Primitives the player has run. `p:` is a member of `Primitive`.
  "p:while",
  "p:for",
  "p:if",
  "p:function",
  "p:move",
  "p:wait",
  "p:pos",
  "p:inventory",
  "p:log",
  "p:deposit",
  "p:withdraw",
  "p:harvest",
  "p:plant",
  "p:scan",
  "p:send",
  "p:receive",
  "p:place",
  "p:queue",
  "p:status",
  "p:spawn",
  // Research the colony has finished. `r:` is a member of `ResearchName`.
  "r:planter",
  "r:scanner",
  "r:crate",
  "r:mill",
  "r:oven",
  "r:conveyor",
  "r:chassis",
  "r:radio",
  "r:builder",
  "r:library",
  "r:fabricator",
  // Rungs the game has offered. `c:` is a ladder id and the rung's index, which
  // survives a chip being retitled — the title is prose and prose gets edited.
  "c:field-loop/0",
  "c:field-loop/1",
  "c:field-loop/2",
  "c:knowing/0",
  "c:knowing/1",
  "c:research/0",
  "c:research/1",
  "c:hauling/0",
  "c:growing/0",
  "c:seeing/0",
  "c:building/0",
  "c:building/1",
  "c:talking/0",
] as const;

export type Fact = (typeof FACTS)[number];

/**
 * Bumped when a key issued today would be misread by the reader of the day.
 *
 * Appending facts does **not** need a bump: an old key simply has zeros where
 * the new facts are, which is the truth about a player who earned them before
 * they existed. A bump is for a change of encoding.
 */
const VERSION = 1;

/**
 * Crockford's base32: no I, L, O or U.
 *
 * The first three because a key that gets read down a phone or copied off a
 * screenshot must not turn a 1 into an I, and the U because it keeps accidental
 * profanity out of a string the game hands to strangers.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BITS = 5;

/** What a misread character most likely was. */
const CONFUSED: Record<string, string> = { I: "1", L: "1", O: "0", U: "V" };

export interface KeyResult {
  facts: Set<Fact>;
  /** What to tell the player, or undefined when the key was good. */
  error?: string;
}

/** The key for a player who has earned exactly these facts. */
export function encodeKey(facts: ReadonlySet<string>): string {
  const bits = FACTS.map((f) => (facts.has(f) ? 1 : 0));
  const payload: string[] = [];
  for (let i = 0; i < bits.length; i += BITS) {
    let value = 0;
    for (let b = 0; b < BITS; b++) value = value * 2 + (bits[i + b] ?? 0);
    payload.push(ALPHABET[value]!);
  }
  const body = ALPHABET[VERSION]! + payload.join("");
  return group(body + checksum(body));
}

/**
 * Read a key back, or say why not.
 *
 * Forgiving about everything that is not information: case, spaces, the dashes
 * this file added for readability, and the four characters Crockford's alphabet
 * leaves out because they are the ones people mistype.
 */
export function decodeKey(key: string): KeyResult {
  const cleaned = [...key.trim().toUpperCase().replace(/[\s-]/g, "")]
    .map((c) => CONFUSED[c] ?? c)
    .join("");

  if (cleaned.length === 0) return { facts: new Set(), error: "no key entered" };
  for (const c of cleaned) {
    if (!ALPHABET.includes(c)) return { facts: new Set(), error: `“${c}” is not part of a key` };
  }

  const body = cleaned.slice(0, -1);
  if (cleaned.slice(-1) !== checksum(body)) {
    // Before the version check, because a typo in the version character would
    // otherwise be reported as a key from the future.
    return { facts: new Set(), error: "that key has a typo in it somewhere" };
  }

  const version = ALPHABET.indexOf(body[0]!);
  if (version > VERSION) {
    return { facts: new Set(), error: "that key is from a newer version of the game" };
  }
  if (version < VERSION) {
    return { facts: new Set(), error: "that key is from an older version of the game" };
  }

  const bits: number[] = [];
  for (const c of body.slice(1)) {
    const value = ALPHABET.indexOf(c);
    for (let b = BITS - 1; b >= 0; b--) bits.push((value >> b) & 1);
  }

  const facts = new Set<Fact>();
  FACTS.forEach((fact, i) => {
    if (bits[i] === 1) facts.add(fact);
  });
  return { facts };
}

/** One character over the body, so a mistyped key is refused rather than obeyed. */
function checksum(body: string): string {
  let sum = 0;
  for (const c of body) sum = (sum * 31 + ALPHABET.indexOf(c)) % ALPHABET.length;
  return ALPHABET[sum]!;
}

/** Fours, because that is how people read a code back to each other. */
function group(s: string): string {
  return (s.match(/.{1,4}/g) ?? []).join("-");
}

/**
 * The facts a codebook and a world add up to.
 *
 * Here rather than in `main.ts` so that the shape of a key has exactly one
 * definition, and so the test can build one without a browser.
 */
export function factsFrom(opts: {
  vocabulary: Iterable<string>;
  research: Iterable<string>;
  offered: Iterable<string>;
}): Set<Fact> {
  const known = new Set<string>(FACTS);
  const facts = new Set<Fact>();
  const add = (candidate: string): void => {
    if (known.has(candidate)) facts.add(candidate as Fact);
  };
  for (const p of opts.vocabulary) add(`p:${p}`);
  for (const r of opts.research) add(`r:${r}`);
  for (const title of opts.offered) {
    const slot = rungSlot(title);
    if (slot) add(slot);
  }
  return facts;
}

/** Split the facts back out into the three things that consume them. */
export function partition(facts: ReadonlySet<Fact>): {
  vocabulary: string[];
  research: string[];
  offered: string[];
} {
  const vocabulary: string[] = [];
  const research: string[] = [];
  const offered: string[] = [];
  for (const fact of facts) {
    const body = fact.slice(2);
    if (fact.startsWith("p:")) vocabulary.push(body);
    else if (fact.startsWith("r:")) research.push(body);
    else {
      const title = rungTitle(body);
      if (title) offered.push(title);
    }
  }
  return { vocabulary, research, offered };
}

/** `c:field-loop/1` for a chip, by the title the rest of the game calls it. */
function rungSlot(title: string): string | undefined {
  for (const ladder of LADDERS) {
    const i = ladder.rungs.findIndex((r) => r.title === title);
    if (i !== -1) return `c:${ladder.id}/${i}`;
  }
  return undefined;
}

function rungTitle(slot: string): string | undefined {
  const [id, index] = slot.split("/");
  return LADDERS.find((l) => l.id === id)?.rungs[Number(index)]?.title;
}
