# Milestone 10, part three: the codebook is a ladder you climb

Third of three. Part one made autocomplete tell the truth about what the player
owns; part two made the game speak at four moments and put the suggestion inside
the book. This closes the item part two left open — *"the book does not yet gate
its chips by what the player owns"* — and turns out to be a larger idea than
gating.

## The idea, and the contradiction in it

The ask: gate chips by what the player owns, **and** require each primitive be
used before a chip is fully unlocked, **and** let the chip build on itself with a
toggle between the forms it has taken.

The contradiction, raised before building: if a chip unlocks only once the player
has *used* its primitives, then **the chip that teaches loops requires having
already written a loop**. The entire suggestion system exists for the player who
has not had that insight, so its most important chip could never reach the only
person who needs it. Same for every rule — `stay-on-the-field` fires precisely
because the player does not know `move()` answers false.

One word fixes it: a rung unlocks when the player has used its primitives **or
been shown it**. Being taught something counts as learning it, which also gives
the suggestion a permanent trace in the book — the thing part two was for.

The second correction: *"each individual line"* is too fine a unit. "Sweep the
whole field" is eight lines, and a rung demanding all eight unlocks only for
someone who could already write it. The unit that works is the **primitive** — a
verb or a control structure — and a rung asks for what it *introduces*, two or
three ideas, not everything it contains.

## What a ladder is

Several chips turned out to be the same program growing up, and showing them as
siblings hid the only interesting thing about them:

```
THE FIELD LOOP
  1. Harvest in a loop      introduces  while · harvest() · bot.move()
  2. Stay on the field      introduces  if
  3. Sweep the whole field  introduces  bot.inventory()
```

Eight ladders fall out of the thirteen chips. `needsFor(ladder, i)` is
**cumulative** — rung three asks for rungs one and two as well, because rung
three *is* rungs one and two plus a condition. That is what "builds on itself"
means mechanically, and it is why being handed rung one does not hand you the
ladder.

The toggle is `‹ 2/3 ›` in the ladder's header, and a ladder opens on the highest
rung the player has earned — what their program became.

## Decisions

1. **Two gates, and they answer opposite ways on purpose.**

   **Hardware hides a ladder.** No scanner, no scanner ladder — the same answer
   part one gives in autocomplete, where a locked namespace is absent rather than
   struck through.

   **An unearned rung is shown, locked, and names what it needs.** A completion
   list answers "what can I type right now", where anything extra is noise. A
   book is a thing you read ahead in, and one you can see further into is one
   worth climbing. The two surfaces have different jobs and the inconsistency is
   the point.

2. **The locked line is the best hint in the game, and it is free.** On a save
   where the player has run the opening script exactly once, the first rung reads
   **"locked — use `while` in a script of your own"**. That is the whole lesson
   of the design's first ten minutes, stated by the book, before the suggestion
   system says a word — and nobody wrote that sentence. It falls out of
   subtracting what they have used from what the rung introduces.

3. **Vocabulary is counted when a script starts, not when it settles.** A
   `while (true)` is the most a player can demonstrate and it never settles;
   waiting for a verdict would mean the best scripts taught the book nothing.
   Running it is the demonstration.

4. **Vocabulary is colony-wide and never forgotten.** It is a record of what this
   *player* knows, not of what some bot is doing.

5. **A rung must introduce something,** and must only claim primitives its own
   code uses — both are tests. A rung that introduces nothing is not a rung, and
   a rung promising "use `while`" had better then demonstrate one.

## What shipped

- `src/editor/source.ts` — reading a script for what it says: `stripNonCode`,
  `hasLoop`, `mentions`, and `primitivesIn`. Lifted out of `suggestions.ts`,
  which no longer owns it now that the book asks the same questions.
- `src/editor/snippets.ts` — `LADDERS`, with `SNIPPETS` derived flat so the
  suggestion rules and the compile-every-chip test are untouched by the book
  having a shape.
- `src/editor/codebook.ts` — ladders, rung toggle, both gates.
- `tests/editor/source.test.ts` and `tests/editor/ladders.test.ts`.

## Verified on the page

Fresh save, driving frames by hand, no console errors:

- Three ladders visible — the field loop, knowing where you are, buying the next
  thing. The scanner, builder, radio, planter and crate ladders do not exist.
- Before any run: *"locked — use while, harvest(), bot.move()"*.
- After one run of the opening script: *"locked — use while"*. Two verbs entered
  the vocabulary and the book narrowed its ask to the one thing left.
- After the second run: the game offers the loop **and** rung 1 unlocks in the
  ladder, same frame.
- Toggling to rung 2: *"locked — use while, if"* — being shown rung 1 did not
  grant `while`, only that rung.
- Taking the loop and running it: rung 2 narrows to *"locked — use if"*.
- Writing the `if` version: rung 2 opens and the ladder now opens on it; rung 3
  reads *"locked — use bot.inventory()"*.
- Fitting a scanner makes "Looking around" appear; placing a crate makes
  "Somewhere to put it" appear.
- Collapsed, the book reads **"2 of 13 patterns learned."**

682 tests pass; `tsc --noEmit` clean.

## Known, and left alone

**Nothing persists.** Vocabulary, offered chips and retired suggestions all live
for the session. The game has no save beyond `localStorage` for scripts, so a
reload resets what the player has "learned" — which is wrong for a progression
mechanic and is the same gap the rest of the game has. It belongs with save/load
rather than here.

**`introduces` is hand-written.** It could be derived from each rung's code minus
the rung below it, and deliberately is not: the primitives a rung *teaches* are
a smaller, editorial set than the ones it contains, and a derived list would
demand `log` of anybody wanting "Sweep the whole field" because the last line
happens to log. The test checks the hand-written list is a *subset* of what the
code uses, which catches the error that matters without pretending the judgement
is mechanical.

**`function` is detected by `=>` or the keyword,** so a player who writes any
arrow anywhere gets credit for the "Stamp a layout" rung's primitive. Coarse, and
harmless: that ladder needs the builder arm to be visible at all.
