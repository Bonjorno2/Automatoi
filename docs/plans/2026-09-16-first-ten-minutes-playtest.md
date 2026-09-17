# The first ten minutes, played

Not a milestone plan. This is the playtest of what milestone 10 built — gated
autocomplete, the suggestion rules, the ladder codebook, the progress key — none
of which had ever been played as a *sequence*. Four features that each work
alone can still add up to a game that does not, and that is the thing only
playing finds.

**The design's claim, which this scores against.** *"Press Run. The bot harvests
and steps east, then stops because the script ended. Insight one: wrap it in a
loop. Insight two: the bot walks off the field... Harvested wheat feeds a Research
Console. First research unlocks the planter."*

**The verdict: the first half works, and the second half has no path through it.**
The loop arrives exactly as designed. Research is unreachable for a beginner —
not because the sim lacks anything, but because every signpost the game owns
points somewhere else.

---

## Method, and its limits

Played through the interface only: clicking Run, Stop and Book, clicking chips,
reading the side panel. No `session.*`, no `world.*`, no `editor.setValue` —
with one exception, marked below, where a veteran's script stood in for typing.

Reading game state *was* allowed, because every number read is one the player can
see on screen. Writing was not.

Three methodology notes, one of which cost a run:

- **The pane delivers no `requestAnimationFrame`,** so frames are driven by hand.
  Known since milestone 4.
- **The sim runs on a real clock.** The first attempt drove 40 frames two
  milliseconds apart and measured a run in which 1.6 ticks passed. Frames have to
  be spaced like frames — 16ms — or the playtest measures its own harness.
- **Tick counts here are deltas.** The pane's boot delay lets the clock catch up
  by a couple of hundred ticks before anything is pressed.

**What this playtest is not.** I know where everything is and what every rule
fires on. The design scores a build on *"time to first loop unaided"* by a human
who did not write it, and that number is still unmeasured — as it has been since
milestone 3.

---

## Findings

Finding 1 is fixed, per the rule milestone 5 established and every milestone
since has followed: a defect rather than a judgement gets fixed with a test and
gets said out loud. The rest are recorded.

### 1. Taking the game's advice made things worse, then silenced it

**Fixed.** The sequence, played straight:

| | |
|---|---|
| Run once | `done`, nothing offered — the design's intended beat |
| Run again | *"This script ran to the end and stopped. A loop keeps the bot going."* |
| Take the chip | loop inserted **above** the player's two lines, which are now dead code below an infinite loop |
| Run the loop | `stuck — 24 commands got nowhere`, and the turnaround is offered |
| Take the turnaround | inserted at the cursor — **below the broken loop, unreachable** |
| Run | **`stuck — 328 commands got nowhere`**, and nothing is offered any more |

The player did exactly what the game told them, twice, and ended up more stuck
than when they started — with the helper gone quiet, because taking a suggestion
retires it. **Asking for help made things worse and then went silent.** That is
the worst outcome this system can produce, and it was produced by the first
person to play it.

The cause is one line. A suggested chip is a **complete program** — "Stay on the
field" is not a fragment, it is what the script should now be — and it was being
inserted at the cursor like a snippet.

The fix distinguishes the two sentences a chip can say. A *suggestion* answers
"your script is wrong" and now **replaces** the buffer; a chip the player went
**looking for** in the book offers a pattern and still inserts at the cursor. It
is one `executeEdits` over the whole range, so Ctrl+Z gives their script back,
and the chip says so: *"click to make this your script — Ctrl+Z puts yours
back."* Six tests in `tests/editor/insert.test.ts`, including the exact failure —
the cursor on line 5, where inserting put the cure under a `while (true)`.

Replayed after the fix: take the loop, run, get stuck, take the turnaround, run —
and the fleet reads `harvest — 3 of 3 ticks left` instead of `stuck`. The cycle
closes.

### 2. There is no path from "the loop works" to "research happens"

The design says harvested wheat feeds the Research Console. It does — the
mechanism is fine, and was verified by writing what a player who already knows
`bot.deposit` would write: walk west until blocked, deposit, and the panel reads
**`planter 4/10`**. *(This is the one place `setValue` stood in for typing.)*

**A beginner cannot get there, and the reason is a loop in the teaching:**

1. Researching anything needs wheat **inside the Research Console**.
2. The only way to put it there is `bot.deposit`.
3. The chip that teaches `bot.deposit` — "Empty into a crate" — is gated on a
   **crate** existing in the world.
4. Crates are unlocked by **research**.

So the one machine a beginner must deposit into is the console, which has existed
since tick 0, and the ladder that would teach them how is hidden because it is
looking for a crate. Three ladders are visible at this point — the field loop,
knowing where you are, buying the next thing — and **not one of them mentions
`deposit`**. The "Buying the next thing" ladder teaches `research.queue()`, which
queues a research that will never progress because nothing is feeding the
console.

Nothing is broken. Every signpost the game owns points away from the only door.

### 3. A bot harvesting nothing looks exactly like a bot working

After taking both chips, the bot ran for **1,200 ticks and gained no wheat.** It
sweeps a row it has already cleared, out past the edge of the field onto bare
grass — at the end it was eleven tiles east of the console, on ground that has
never grown anything.

The whole time, the fleet list read `harvest — 3 of 3 ticks left · 4 wheat`.
Busy. And the game said nothing, because none of the four rules can see it:
`stalled` is reset by every successful `move`, so a `harvest(); move();` loop
never accumulates one; there is no bump, because nothing is in the way; and the
bot is not full.

**This is the fourth time the fleet list has wanted a word the sim does not
have**, and it is cycle five's finding 3 restated from the other end: the one
signal the game has for "getting nowhere" reads zero in the case that most needs
it. A bot whose harvests all refuse is the single most common shape of failure in
the opening, and it is invisible.

### 4. On the shipped seed, the first harvest a player ever runs finds nothing

The design: *"Press Run. The bot harvests and steps east."* On seed 1 it does
not harvest — the tile under the starting bot is bare, so the fleet reads `idle ·
empty` after the first run and the player's first action achieved nothing they
can see.

Measured across twenty seeds: **6 of 20 start the bot on bare soil**, which is
`WILD_WHEAT_CHANCE` doing exactly what it says. But the game ships seed 1, so
this is not a 30% risk — it is **certain, for every new player**.

A one-line fix in world generation would guarantee a crop under the starting bot.
Left alone because it is a judgement about the opening rather than a broken
mechanism, and "your first action does nothing" may even be the intent. It should
be a decision, not an accident of the seed.

### 5. A key taken mid-research loses the research

`planter 4/10` on screen; the key issued at that moment says `0 researched`. The
key carries **unlocked** research and neither the queue nor the progress toward
the head of it. Small, and worth knowing before someone loses ten minutes of
console-feeding to a browser refresh.

---

## What this means for what comes next

**Findings 2 and 3 are the same hole seen twice.** The opening teaches the player
to harvest, and then has nothing to say about what harvested wheat is *for*. A
bot that fills up and keeps harvesting gets a suggestion; a bot that harvests
nothing gets silence; and the chip that would close the loop is behind a machine
that does not exist yet.

The three smallest things that would close it, none of which is engine work:

- **Ungate the hauling ladder from the crate.** A console is a machine on a tile
  and `deposit` works on it. The chip's own text is about crates, so it wants a
  rung above it: *empty into the console*, which is the first thing wheat is for.
- **A fifth rule: harvesting nothing.** A run of refused harvests is a distinct
  failure from stuck and from full, and the `refused` event already carries the
  command. It needs the sim to count it, which is finding 3's real ask.
- **A rule for wheat that is going nowhere** — a bot carrying wheat, a console
  that has eaten none, and a player who has never called `deposit`.

**Unchanged and still true:** the first half of the design's first ten minutes
works exactly as written, and the suggestion system delivered the loop at the
moment the design says the player needs it. The beat is real. It just stops one
step short of the thing the whole economy hangs on.

726 tests pass; `tsc --noEmit` clean. The progress key issued at the end of this
session round-trips to itself exactly.
