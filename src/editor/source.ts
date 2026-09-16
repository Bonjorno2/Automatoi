/**
 * Reading a player's script for what it actually says.
 *
 * Two customers since milestone 10: the suggestion rules, which ask whether a
 * script loops or mentions a verb, and the codebook, which asks which
 * primitives the player has demonstrated so it knows which rungs they have
 * earned. Both have to answer about *code* rather than about text — a `for` in
 * a comment is prose — so both go through `stripNonCode` and neither owns it.
 */

/**
 * One thing a script can do. The unit a codebook rung is unlocked by.
 *
 * Deliberately coarse. "Each line must be used" was the other candidate and it
 * makes an eight-line chip unlock only for somebody who could already write it;
 * a rung should ask for the two or three ideas it *introduces*, which is what a
 * player would say they had learned.
 */
export type Primitive =
  | "while"
  | "for"
  | "if"
  | "function"
  | "move"
  | "wait"
  | "pos"
  | "inventory"
  | "log"
  | "deposit"
  | "withdraw"
  | "harvest"
  | "plant"
  | "scan"
  | "send"
  | "receive"
  | "place"
  | "queue"
  | "status"
  | "spawn";

/**
 * How each one is recognised in a stripped source.
 *
 * Optional chaining is allowed for everywhere a module namespace appears, because
 * `bot.scanner?.scan(2)` is the honest call the shipped `.d.ts` asks for and a
 * player who writes it has plainly used the scanner.
 */
const PATTERN: Record<Primitive, RegExp> = {
  while: /\bwhile\b/,
  for: /\bfor\b/,
  if: /\bif\b/,
  // An arrow counts: `spawn(() => {...})` is a player writing a function, and
  // the ladder that asks for this one is about naming a piece of behaviour.
  function: /\bfunction\b|=>/,
  move: /\bbot\.move\b/,
  wait: /\bbot\.wait\b/,
  pos: /\bbot\.pos\b/,
  inventory: /\bbot\.inventory\b/,
  log: /\bbot\.log\b/,
  deposit: /\bbot\.deposit\b/,
  withdraw: /\bbot\.withdraw\b/,
  harvest: /\bbot\.harvester\??\.harvest\b/,
  plant: /\bbot\.planter\??\.plant\b/,
  scan: /\bbot\.scanner\??\.scan\b/,
  send: /\bbot\.radio\??\.send\b/,
  receive: /\bbot\.radio\??\.receive\b/,
  place: /\bbot\.builder\??\.place\b/,
  queue: /\bcolony\.research\.queue\b/,
  status: /\bcolony\.research\.status\b/,
  spawn: /\bcolony\.fabricator\??\.spawn\b/,
};

/** What to call each one when the book has to name what a rung needs. */
export const PRIMITIVE_LABEL: Record<Primitive, string> = {
  while: "while",
  for: "for",
  if: "if",
  function: "a function of your own",
  move: "bot.move()",
  wait: "bot.wait()",
  pos: "bot.pos()",
  inventory: "bot.inventory()",
  log: "bot.log()",
  deposit: "bot.deposit()",
  withdraw: "bot.withdraw()",
  harvest: "harvest()",
  plant: "plant()",
  scan: "scan()",
  send: "radio.send()",
  receive: "radio.receive()",
  place: "builder.place()",
  queue: "research.queue()",
  status: "research.status()",
  spawn: "fabricator.spawn()",
};

const EVERY_PRIMITIVE = Object.keys(PATTERN) as Primitive[];

/** Everything this source demonstrably does. */
export function primitivesIn(source: string): Set<Primitive> {
  const code = stripNonCode(source);
  return new Set(EVERY_PRIMITIVE.filter((p) => PATTERN[p].test(code)));
}

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

/** True when the source really calls this, rather than mentioning it in a comment. */
export function mentions(source: string, needle: string): boolean {
  return stripNonCode(source).includes(needle);
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
export function stripNonCode(source: string): string {
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
