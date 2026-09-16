# Milestone 10, part five: the key carries the code, as line numbers

Extends part four. That key carried what the player had learned and researched.
This one carries their scripts too, so a game served off a static host with no
account and no server can be moved between a laptop and a phone by copying one
string out of a text box.

## The measurement that shaped it

A player's script compressed conventionally is not small. Maximum-strength
deflate on the book's own chips:

| | |
|---|---|
| One chip, deflated | **276 key characters** |
| The whole progress key | **11 characters** |

One chip in the book — "Queue some research", 33 bytes — actually *grows* to 35
bytes when deflated. General-purpose compression has overhead that short strings
cannot pay off.

But the game knows its own vocabulary, and a player's code is largely made of
it. Compressing against the codebook as a shared dictionary:

| Scratchpad | Plain | Against the codebook |
|---|---|---|
| A chip, verbatim | 276 chars | **8 chars** |
| A chip, one number edited | 274 chars | **15 chars** |
| A veteran's own planner | 312 chars | **253 chars** |

**It works, and it inverts.** Magnificent for the player whose code came out of
the book — the beginner, with the least worth saving — and nearly useless for the
veteran writing original code, who has the most. That asymmetry is the finding
that decided the design.

## Decisions

1. **Line numbers, not compression.** A key stores *references* into a numbered
   list of lines the game already knows. The text lives in the game. That is why
   a seven-line script out of the book is 37 characters.

2. **A fast path, never a rule.** A line that is not in the dictionary is spelled
   out in full and costs what it costs. The alternative — a scratchpad that only
   accepts book lines — would mean a veteran's planner cannot be saved at all,
   and cycle 5 is the thing the whole design builds toward. Nobody hits a wall;
   they get a longer key.

3. **The cost is shown, not hidden.** *"106 characters — 13 lines from the book,
   1 your own"* is the honest explanation of why one player's key is short and
   another's is long, and it quietly teaches the true thing: code built out of
   the codebook is code the game already knows.

4. **No compression library.** Raw literals cost about 35% more than deflating
   them would, and deflate in a browser is `CompressionStream`, which is async
   and needs a second code path under Node. For a string you paste into a text
   file, 35% is not worth an async encoder and two implementations. The whole
   thing is synchronous and identical everywhere.

5. **Field widths are fixed forever, including the index width.** `INDEX_BITS` is
   10 — room for 1024 lines — and is deliberately **not** derived from the list's
   length. Deriving it was the first version and it is the same bug one level up:
   growing the list from 40 entries to 65 would widen every reference from 6 bits
   to 7, and every key issued before that would decode as noise.

6. **A version 1 key still reads.** The bit stream is identical up to the end of
   the facts and a v1 key simply stops there. Not a courtesy — it is the proof
   that the version marker does its job, and it is tested.

## The promise this file makes

`line-dictionary.ts` is append-only forever. Nothing is removed, nothing is
reordered, and a line whose chip was rewritten keeps its slot as a tombstone.

Renumbering silently corrupts every key ever issued: valid checksum, no error,
the player handed code they did not write. They will assume they did something
wrong and will not report it. `tests/editor/line-dictionary.test.ts` holds a
literal copy of the list, so reordering fails the build rather than the player.

**The dictionary is written out by hand rather than derived from the chips**, and
that is the point. `SNIPPETS.flatMap(s => s.code.split("\n"))` is the obvious
implementation and a trap: milestone 10 edited chip prose twice in passing, and
under a derived dictionary each of those edits would have renumbered everything
after it. Written out, the chips stay freely editable. A chip that drifts from
the dictionary only makes a key longer — never wrong.

## The bug driving it found

A brand new game issued a **655-character key**.

The shared library opens with a twelve-line comment explaining what a shared
library is. Every one of those lines was being spelled out in full, forever, in
the key of every player who had never opened the library at all.

Two fixes, both worth keeping. A buffer still holding exactly what the game put
there is **left out of the key entirely** — a key should carry what the player
wrote, and restoring with a buffer missing already does the right thing, because
the store falls back to the same default it would have shown. And the library's
own lines went into the dictionary, for the player who edits the library and
keeps the explanation.

A fresh game is now **12 characters**.

## Verified on the page

Measured live, in a clean tab with no console errors:

| | |
|---|---|
| Fresh game | **12 characters** |
| A seven-line script entirely out of the book | **37** — *"7 lines from the book, 0 of your own"* |
| The same, plus one line the player wrote | **86** — *"1 your own"* |
| A real save: bot script, edited library, 2 researches | **106** |

Then the thing it is all for. Take that 106-character key, open a second browser
tab, `localStorage.clear()`, reload — opening script, no research, fresh key.
Paste the key in lowercase with the dashes stripped, as a person would:

> **key accepted — 2 researched, 5 learned, 2 scripts**

The bot's script comes back including the line that was the player's own, the
shared library comes back, the scanner and the library are researched, the field
loop ladder opens on rung 2, and **the key re-encodes to the identical string** —
which is the round-trip proving itself rather than being asserted.

720 tests pass; `tsc --noEmit` clean.

## Known, and left alone

**Every chip must stay in the dictionary or keys get longer.** A test asserts the
book's current lines are all present, so drift is a decision somebody makes and
sees, rather than a slow leak.

**A key is only meaningful against a build with the same dictionary.** That is the
promise above, and the version marker is the backstop: a cached older copy of the
game on GitHub Pages refuses a newer key with a sentence instead of guessing.

**Fifteen buffers, 65535 lines each.** Beyond that a key silently carries less.
Nowhere near reachable by a player and stated so that it is a known limit rather
than a discovered one.
