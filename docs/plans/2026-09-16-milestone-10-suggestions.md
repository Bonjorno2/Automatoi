# Milestone 10, part two: the game says something, once, and can be told to stop

Companion to `2026-09-16-milestone-10-live-api.md`. That one made the editor tell
the truth about what the player owns. This one makes it say something when the
player is stuck, which is the other half of the same complaint: the coding flow
had no way to offer anything, only ways to refuse.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — the first ten
minutes (*"Press Run. The bot harvests and steps east, then stops because the
script ended. Insight one: wrap it in a loop"*), **"No tutorial popups"**, and
"Failure is content".

## The gap

The design describes the first insight arriving on its own, and for the player
who has it, it does. The player who does not have it presses Run again, watches
the same two ticks, and is given no reason to believe anything else is possible.
The snippet book holds the answer and is behind a button they have no reason to
press, because nothing has told them a book exists.

The prior art splits cleanly on how to close that. Games detect struggle and
nudge — Celeste's gentle reminders after repeated failure, Breath of the Wild's
contextual prompts, the research literature's finding that context-sensitive
tutorials beat instruction screens on motivation with no cost to immersion. IDEs
have converged on the opposite emphasis: the complaint filed against suggestion
UI is *always* that it covered code somebody was reading, and the fix the
long-lived systems landed on is a passive affordance plus a dismissal that is one
click and permanent.

Both point the same way for this game, because the design already forbids the
loud version.

## Decisions

1. **It is a group in the side panel, not an overlay on the editor.** Under
   BUILD, above the console. It never moves the code, never covers the canvas,
   and is visible without opening anything — which rules out the alternative of
   badging the Book button, since the player this exists for is exactly the one
   who has not found the Book.

2. **A suggestion points at a chip the book already has.** This is the book
   surfaced at the right moment, not a second corpus of advice that can drift
   from it. A rule names a chip by title and `SUGGESTED_CHIPS` plus a test fails
   the build if that title stops existing.

3. **Twice, never once.** A first script running out is the design working — that
   is the moment the player is *meant* to feel, and talking over it would replace
   the insight with an instruction. The second run is the signal: the player has
   seen the ending and done the same thing again.

4. **Looplessness, not a duration threshold.** The rule reads the source and asks
   whether it actually loops. A threshold would need a tuned constant nobody has
   measured, and it would fire at a `while (true)` that ended for an unrelated
   reason — offering a loop to someone who wrote one. Reading the source means
   the rule retires *itself* the moment the player adds the loop.

   The cost is that "does this loop" has to be answered properly. `hasLoop`
   blanks comments and strings with a left-to-right scan before looking, because
   `// go east for one tile` contains the word `for` and the failure mode of
   getting it wrong is a suggestion that silently never appears — the one kind of
   bug nobody would ever report.

5. **Taken and refused are the same ending.** Both retire the suggestion for the
   session, and refusing retires it for every bot, because "no thanks" is a
   statement about the advice and not about bot 1. A suggestion that returns
   after being used is the game telling the player they did it wrong.

6. **Errors and stops raise nothing.** An error already has the editor's line
   marker and the console panel. A stop is the player deciding something, and
   answering a decision with advice is precisely what makes a hint system feel
   like nagging.

7. **Spawned bots are not watched.** A fabricator-built bot's source is in no
   buffer, so a chip offered about it would be inserted into some other bot's
   script.

## What shipped

- `src/editor/suggestions.ts` — the rules and the per-bot history they read. No
  DOM and no Monaco, because what counts as a moment worth speaking at is a rule
  about the game and deserves tests that do not need a browser.
- `src/editor/suggestion-panel.ts` — the chip, the "click to drop it in at the
  cursor" line, and the dismiss.
- `src/editor/insert.ts` — insertion at the cursor, extracted from the snippet
  book so the two chips cannot end up with two answers about where the caret
  lands.
- One rule: `wrap-it-in-a-loop`. The mechanism takes the other three as data.

Also fixed in passing: `run` read `editor.getValue()` twice, so what was stashed
and what was started could disagree if the buffer changed between them.

## Verified on the page

At `localhost:5176`, driving frames by hand:

- Opening script, run once: the group stays hidden, status `done`.
- Run a second time: the chip appears, reading *"This script ran to the end and
  stopped. A loop keeps the bot going."* over the `while (true)` body.
- Clicking it inserts the loop at the caret and the group disappears; two further
  loopless runs do not bring it back.
- A looping script run twice never raises it at all.
- "no thanks" hides it and leaves the buffer untouched.

644 tests pass, `tsc --noEmit` clean, console clean.

## Known, and left alone

**Insertion is at the cursor, not a replacement.** Taking the chip with the caret
at the end of the opening script leaves the original two lines above an infinite
loop — dead code that never runs and does no harm. Replacing the buffer would be
the tidier result and is not worth the one time it eats something the player
wanted. The book has behaved this way since milestone 7 and now they share one
implementation.

**The other three triggers are designed and unbuilt** — bumping the same wall,
filling up and harvesting anyway, and new hardware landing. Each is one entry in
`RULES` reading one more field of `History`; the signals already exist in the
`WorldEvent` stream. They were left out because one rule is enough to find out
whether the panel is welcome, and four is enough to find out the hard way.
