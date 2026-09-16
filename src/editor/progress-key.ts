import { BitReader, BitWriter, KeyDamaged, checksum, group, normalise, ALPHABET } from "./bits.ts";
import { INDEX_BITS, LINES, LINE_INDEX } from "./line-dictionary.ts";
import { LADDERS } from "./snippets.ts";

/**
 * The save, as a code you can paste into a text file.
 *
 * There was no save at all before this — no `localStorage` anywhere, so a reload
 * lost the world, the research, the codebook and the player's scripts. A key is
 * the whole save now, and it is one string precisely so that a game served off
 * a static host with no account and no server can still be carried between a
 * laptop and a phone by copying it out.
 *
 * ## Two sections, and why the second one is cheap
 *
 * **Facts**: 44 bits. What the player has learned and researched.
 *
 * **Scripts**: their code, stored as *line numbers* rather than as text. The
 * game already knows every line the codebook contains, so a script assembled out
 * of chips is a list of small integers — a whole chip is 26 characters instead
 * of 276. A line the player wrote themselves is spelled out in full and costs
 * what it costs. Measured: a beginner's three scripts come to about 50
 * characters, a veteran's original planner to about 440, and neither is a
 * problem for something you paste into Notepad.
 *
 * This means a key is only meaningful against a game with the same line
 * dictionary — see `line-dictionary.ts`, which is append-only forever for
 * exactly that reason.
 *
 * ## Versions
 *
 * A version 1 key carried facts alone. It still reads: the bit stream is
 * identical up to the end of the facts, and a v1 key simply stops there. That is
 * not a courtesy, it is the proof that the version marker does its job — a key
 * from a *newer* build is refused with a sentence rather than misread.
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

/** The version this build writes. Readers accept this and everything below it. */
const VERSION = 2;
const VERSION_BITS = 5;

/** Field widths, every one of them fixed forever. See `line-dictionary.ts`. */
const BUFFER_COUNT_BITS = 4;
const BOT_ID_BITS = 8;
const LINE_COUNT_BITS = 16;
const DEPTH_BITS = 3;
const MAX_DEPTH = (1 << DEPTH_BITS) - 1;
const LITERAL_LEN_BITS = 12;
const MAX_LITERAL_BYTES = (1 << LITERAL_LEN_BITS) - 1;
const MAX_BUFFERS = (1 << BUFFER_COUNT_BITS) - 1;

/** One editor buffer: a bot's script, or the shared library. */
export interface Buffer {
  /** A bot id, or null for the shared library. */
  botId: number | null;
  source: string;
}

export interface KeyContents {
  facts: Set<Fact>;
  buffers: Buffer[];
}

export interface KeyResult extends KeyContents {
  /** What to tell the player, or undefined when the key was good. */
  error?: string;
}

/** How a key spends its characters, so the cost can be shown rather than guessed. */
export interface KeyCost {
  characters: number;
  fromBook: number;
  ownLines: number;
}

// ---- writing ----------------------------------------------------------

export function encodeKey(contents: KeyContents): string {
  const w = new BitWriter();
  w.write(VERSION, VERSION_BITS);
  for (const fact of FACTS) w.writeBit(contents.facts.has(fact));
  writeBuffers(w, contents.buffers);
  const body = w.toBase32();
  return group(body + checksum(body));
}

/** What the key costs, and why. Encodes nothing — it counts. */
export function keyCost(contents: KeyContents): KeyCost {
  let fromBook = 0;
  let ownLines = 0;
  for (const buffer of contents.buffers.slice(0, MAX_BUFFERS)) {
    for (const raw of buffer.source.split("\n")) {
      if (LINE_INDEX.has(raw.trim())) fromBook++;
      else ownLines++;
    }
  }
  return { characters: encodeKey(contents).replace(/-/g, "").length, fromBook, ownLines };
}

function writeBuffers(w: BitWriter, buffers: readonly Buffer[]): void {
  const kept = buffers.slice(0, MAX_BUFFERS);
  w.write(kept.length, BUFFER_COUNT_BITS);
  const encoder = new TextEncoder();

  for (const buffer of kept) {
    w.writeBit(buffer.botId === null);
    if (buffer.botId !== null) w.write(Math.min(buffer.botId, 255), BOT_ID_BITS);

    const lines = buffer.source.split("\n");
    const kept_lines = lines.slice(0, (1 << LINE_COUNT_BITS) - 1);
    w.write(kept_lines.length, LINE_COUNT_BITS);

    for (const raw of kept_lines) {
      const trimmed = raw.trim();
      // Depth is carried apart from the text so that the same statement at two
      // nesting levels is one dictionary entry, and so re-indenting a script
      // does not turn every line of it into a literal.
      const indent = raw.length - raw.trimStart().length;
      w.write(Math.min(indent >> 1, MAX_DEPTH), DEPTH_BITS);

      const index = LINE_INDEX.get(trimmed);
      if (index !== undefined) {
        w.writeBit(true);
        w.write(index, INDEX_BITS);
        continue;
      }
      w.writeBit(false);
      const bytes = encoder.encode(trimmed).slice(0, MAX_LITERAL_BYTES);
      w.write(bytes.length, LITERAL_LEN_BITS);
      w.writeBytes(bytes);
    }
  }
}

// ---- reading ----------------------------------------------------------

export function decodeKey(key: string): KeyResult {
  const empty = (): KeyResult => ({ facts: new Set(), buffers: [] });
  const cleaned = normalise(key);

  if (cleaned.length === 0) return { ...empty(), error: "no key entered" };
  for (const c of cleaned) {
    if (!ALPHABET.includes(c)) return { ...empty(), error: `“${c}” is not part of a key` };
  }

  const body = cleaned.slice(0, -1);
  if (cleaned.slice(-1) !== checksum(body)) {
    // Before the version check, because a typo in the version bits would
    // otherwise be reported as a key from the future.
    return { ...empty(), error: "that key has a typo in it somewhere" };
  }

  try {
    const r = new BitReader(body);
    const version = r.read(VERSION_BITS);
    if (version > VERSION) {
      return { ...empty(), error: "that key is from a newer version of the game" };
    }
    if (version < 1) return { ...empty(), error: "that key is not one of ours" };

    const facts = new Set<Fact>();
    for (const fact of FACTS) {
      if (r.readBit()) facts.add(fact);
    }

    // A version 1 key stops here, and the padding is all that is left.
    const buffers = version >= 2 ? readBuffers(r) : [];
    return { facts, buffers };
  } catch (e) {
    if (e instanceof KeyDamaged) return { ...empty(), error: e.message };
    throw e;
  }
}

function readBuffers(r: BitReader): Buffer[] {
  const count = r.read(BUFFER_COUNT_BITS);
  const decoder = new TextDecoder();
  const buffers: Buffer[] = [];

  for (let b = 0; b < count; b++) {
    const isLibrary = r.readBit();
    const botId = isLibrary ? null : r.read(BOT_ID_BITS);
    const lineCount = r.read(LINE_COUNT_BITS);
    const lines: string[] = [];

    for (let i = 0; i < lineCount; i++) {
      const depth = r.read(DEPTH_BITS);
      const text = r.readBit()
        ? LINES[r.read(INDEX_BITS)] ?? ""
        : decoder.decode(r.readBytes(r.read(LITERAL_LEN_BITS)));
      lines.push(text ? " ".repeat(depth * 2) + text : "");
    }
    buffers.push({ botId, source: lines.join("\n") });
  }
  return buffers;
}

// ---- what a key is made of --------------------------------------------

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
