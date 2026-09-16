# Milestone 10, part two: the codebook, and the four moments it speaks at

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
The snippet book held the answer and was behind a button they had no reason to
press, because nothing had told them a book existed.

The prior art splits cleanly on how to close that. Games detect struggle and
nudge — Celeste's reminders after repeated failure, Breath of the Wild's
contextual prompts, the finding that context-sensitive tutorials beat instruction
screens on motivation at no cost to immersion. IDEs have converged on the
opposite emphasis: the complaint filed against suggestion UI is *always* that it
covered code somebody was reading, and the fix the long-lived systems landed on
is a passive affordance plus a dismissal that is one click and permanent.

Both point the same way here, because the design already forbids the loud version.

## Decisions

1. **The suggestion and the book are one surface, and that is the load-bearing
   decision.** They shipped as two — a chip in the side panel and a floating
   panel behind a button — and that was wrong in a way worth stating plainly: a
   player handed a loop when they need one, who goes looking for it again a week
   later, has to have somewhere to look. A card that appears and vanishes means
   the game taught them something and then took it away.

   So the suggestion *is* the codebook, raising the chip it wants them to see, in
   the place they will come back to. Three tiers, top to bottom: **suggested
   now**, at most one, with the reason; **offered before**, one line each,
   everything the game has ever raised; then **the rest**, collapsed until asked
   for. The floating `#book` is gone and the Book button opens this instead.

   It also settles what dismissal means. "No thanks — keep it in the book"
   retires the *suggestion* and leaves the *chip* one click further down.
   Refusing advice is not the same as losing it.

2. **Lives in the column, never over the editor.** The design forbids tutorial
   popups and the IDE prior art says the same thing from the other side.

3. **Every rule is earned, and most retire themselves.** Not one fires on
   arrival or on a timer. Three of the four stop firing when the player does the
   thing, with no click needed — a suggestion that must be dismissed by hand
   outstays its welcome by exactly as long as it is ignored.

4. **One thing at a time, in priority order.** What is happening to you beats
   what just became available. They rarely collide, and when they do the order
   in `RULES` is the answer.

## The four rules

| Rule | Fires when | Chip | Retires itself when |
|---|---|---|---|
| `wrap-it-in-a-loop` | Two runs in a row settled `done` with no loop in the source | Harvest in a loop | the source loops |
| `stay-on-the-field` | 8 bumps in one run of a looping script | Stay on the field | the run ends |
| `somewhere-to-put-it` | 3 `full` events and a crate exists | Empty into a crate | the run ends |
| `dont-overfill` | 3 `full` events and no crate exists | Don't overfill | the run ends |
| `new-hardware:<name>` | that research landed | the chip that teaches it | a script mentions the verb |

Notes on each:

- **Twice, never once,** for the loop. A first script running out is the design
  working — that is the moment the player is *meant* to feel, and talking over it
  replaces the insight with an instruction.
- **Looplessness, not a duration threshold.** A threshold needs a tuned constant
  nobody has measured, and would fire at a `while (true)` that ended for an
  unrelated reason. Reading the source means the rule retires itself.
- **8 and 3 are guesses and are named as guesses.** One bump is a bot turning
  around, which is a script working; eight is a bot pressed against the same wall
  for sixteen ticks, which is what milestone 3's playtest watched players fail to
  understand.
- **The crate rule outranks the stop rule** whenever a crate exists, because
  stopping when full is cycle one's fix and depositing is cycle two's, and by the
  time there is a crate on the map the player has bought their way out of the
  first one.
- **Hardware with no chip raises nothing** — the mill, oven, chassis, library and
  fabricator. Adding a chip is what adds the suggestion, which is the coupling
  this file wants.
- **Errors and stops raise nothing.** An error already has the editor's line
  marker and the console panel. A stop is the player deciding something, and
  answering a decision with advice is what makes a hint system feel like nagging.

## The bug driving it found

`stay-on-the-field` asks whether the running script loops. The first version read
that from `runs`, the list of **settled** runs — and a `while (true)` never
settles. So the one rule about a script that runs forever could only see scripts
that had stopped, and it never fired once. Every unit test passed, because every
test handed it a finished run.

`History` now carries `current`, the source of the script running right now, and
the fix is in the regression test both ways round. The general lesson is the one
milestone 4 already recorded about the preview pane: **a rule about a running
system has to be driven, not only asserted.**

## What shipped

- `src/editor/suggestions.ts` — the rules and the per-bot history they read. No
  DOM and no Monaco: what counts as a moment worth speaking at is a rule about
  the game, and it deserves tests that do not need a browser.
- `src/editor/codebook.ts` — the one surface. Replaces `snippet-book.ts` and
  `suggestion-panel.ts`, both deleted.
- `src/editor/insert.ts` — insertion at the cursor, so every chip in every tier
  gives one answer about where the caret lands.
- Events reach the suggester from the **same single drain** the marks and effects
  read. A second `drainEvents` would hand it an empty list, and the bump nobody
  counted would be the bump that mattered.

## Verified on the page

At `localhost:5176`, driving frames by hand, in a clean tab with no console
errors:

- Opening script run once: nothing. Run twice: *"This script ran to the end and
  stopped. A loop keeps the bot going."*
- Taking it inserts the loop and moves the chip to **offered before** — the whole
  claim of the merge, demonstrated.
- Running that loop: the bot walks to x=31 and pushes into the world's edge, and
  the book switches to *"This bot keeps walking into something."*
- Researching the scanner while that is on screen changes nothing — priority
  holds. Dismissing the wall advice hands the slot to *"The scanner has arrived."*
- Running a script that says `bot.scanner` retires that one with no click.
- A full bot with no crate: *"Stop before that and go somewhere."* Place a crate,
  and the same situation says *"There is a crate to empty into."*

663 tests pass; `tsc --noEmit` clean.

## Known, and left alone

**Insertion is at the cursor, not a replacement.** Taking the loop with the caret
at the end of the opening script leaves the original two lines above an infinite
loop — dead code that never runs and does no harm. Replacing the buffer would be
tidier and is not worth the one time it eats something the player wanted.

**Nothing is suggested while the library is on screen**, because a chip inserted
there would be advice about one bot written into every bot. The book itself
stays: it is a book, and the library is exactly where someone reaches for one.

**The book does not yet gate its chips by what the player owns**, the way
autocomplete now does. A chip carries `requires` and says "needs the scanner",
which is milestone 3's answer and is weaker than part one's. Making the book
agree with the completion list is the obvious next move and was deliberately not
smuggled into this change.
