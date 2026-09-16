# Cycle 5, played: the design's last rung, and what it hits

Not a milestone plan. This is the playtest milestone 9 asked for, run before
committing to a milestone 10, because the thing it would have built rests on a
claim nobody had tested.

**The claim.** The design: *"By cycle 5, `main.js` never says `move("east")`. It
says `expand(ironLine, 3)`. `expand` is built on `stamp`, on `place`, on `move`.
The player wrote every layer and owns the whole abstraction stack."* Milestone 9
added that cycle 5 is the first cycle needing **no engine work at all**, which is
*"either the design being right or the design being untestable, and only a
playtest can say which."*

**The method.** Write that stack the way a player would — four layers, each built
on the one beneath, nothing reaching past the shipped API — and run it. There is
no iron, so the thing expanded is a harvest block: a crate with a bot assigned to
fill it. Same shape as `ironLine`, with the only material this game has.
`tests/bench/cycle-five.bench.ts` is the script and the run.

**The verdict: the claim is false.** Cycle 5 needs engine work. It hit three
walls before it placed a second crate, and the first one was a defect severe
enough to fix on the spot.

---

## Findings

Finding 1 is fixed, per the rule milestone 5 established and every milestone
since has followed: a defect rather than a judgement gets fixed with a test and
gets said out loud. Findings 2 to 5 are recorded and left alone — they are design
gaps, and what to do about them is milestone 10's decision rather than this
document's.

### 1. A result too big for the channel killed a bot silently and forever

**Fixed.** The planner's first act is to read the world. `bot.scanner.scan(8)`
was the unconsidered first choice, and it does this:

```
frame too large: 23431 > 16384 bytes
```

`writeFrame` throws inside `Colony.reply`, host-side, and before this milestone
that throw escaped. Every consequence was silent:

- `ch.pending` stayed true, so `serve` skipped the channel from then on.
- The worker stayed parked on `Atomics.wait` and never woke.
- The watchdog **deliberately** never fires for a channel sitting on a REQUEST,
  which is correct for a blocking `receive()` and wrong here.
- The script's promise never settled, so no `onSettle`, so no console panel entry.

Driven on the page: the fleet list read `bot 1 idle · empty`, the status line
read `ready`, the console panel was empty, and the only trace anywhere in the
game was an uncaught promise rejection in the browser's own devtools. **A
documented API call, used at a reasonable argument, permanently killed a bot and
told the player nothing.** That is the design's "Failure is content" broken at
the one place nothing else covers — milestone 9's finding 1 was the same failure
for *worker* errors, and its fix does not reach a *host-side* throw.

The boundary, measured rather than assumed: **radius 6 (169 tiles) is the largest
scan that fits; radius 7 (225 tiles) does not.**

The fix is in `reply`: an overflow becomes an ordinary failed result, so the
script gets a catchable error on the line it called from. Verified on the page —
`status: "error"`, `line: 3`, `result too large to return — ask for less at
once`, where before the promise never settled. Five tests in
`tests/bridge/oversized-result.test.ts`, including that a script can catch it and
retry narrower, which is what a planner actually wants to do.

**A prediction of mine that was wrong, recorded because it was wrong for an
interesting reason.** Reading `main.ts`, `frame()` calls `session.pass()`
unwrapped and `requestAnimationFrame(loop)` comes after it, so I expected the
throw to freeze the whole game. It does not: the colony's own `drive()` loop
reaches the throw first, where it becomes an unhandled promise rejection, and rAF
survives. The game keeps running perfectly while one bot is dead. Arguably worse
than the freeze, and certainly harder to notice.

### 2. A planner cannot ask whether a tile is usable, so it retries forever

With scanning fixed, the planner reached its next wall and stayed there: **129
identical failures in 6000 ticks**, one crate placed, one wheat harvested.

```
1x    stamp refused at 16,16: tile occupied
128x  stamp refused at 16,17: tile occupied
129x  expand: stamp failed
```

`unservedSpot` picks the centroid of the crops it can see. The centre of a field
is where the console and the bot already are, so the centroid is occupied,
`place` throws, `expand` gives up, `main` waits forty ticks and **asks the same
question again**.

The sim knows the answer — `canPlace` is a predicate and has been since milestone
6, and it is what the build menu's ghost uses to colour itself. **A script cannot
call it.** A script's only way to test a tile is to walk to it and attempt the
build, which costs a round trip and answers with a thrown error rather than a
value. The ghost can see the future; the planner cannot.

That is squarely engine work, and it is the smallest thing on this list: a read
that costs no ticks, in the family `colony.research.status()` already joined.

### 3. A planner deadlocks its own children

Sampled live, mid-run:

```
bot 1 at 16,18 — action place, blockedOn nothing, stalled 0
bot 5 at 16,19 — action move,  blockedOn bot,     stalled 0
```

The planner stands on a tile it never leaves, because it is livelocked on finding
2. The bot it spawned tries to move through that tile, gets `blockedOn: "bot"` —
a command that **never resolves** — and waits for the rest of the session. The
parent's failure becomes the child's.

**`stalled` is 0 for both, and that is the interesting part.** Milestone 8 built
that counter precisely so a bot getting nowhere could say so, and here neither
bot can use it: the planner's commands *succeed* (it is `place` that throws,
which is an error and not a stall), and the child never completes a command at
all, so there is nothing to count. The one signal the game has for "getting
nowhere" reads zero in the case that most needs it. This is the fourth time the
fleet list has wanted a word the sim does not have.

> A methodology note that cost a run: **state read after the harness returns is
> useless.** `stopAll` calls `resetChannel`, which clears `action` and
> `blockedOn`, so every bot looks serenely idle whatever killed it. I read that
> once and concluded the child had simply stopped. Sampling from inside the
> `until` predicate, which runs every pass, is what showed the deadlock.

### 4. `spawn` cannot be given a parameter, which is what `expand` needs

`expand(blueprint, n)` stamps a block at a computed location and staffs it. The
child has to be told *which* block is its own — and it cannot be, because a
spawned function is source and closes over nothing. The only way through is to
build the source text:

```js
const source = "while (true) { workCrate(" + cx + ", " + cy + "); }";
colony.fabricator.spawn(new Function(source));
```

It works. It also throws away every reason `spawn` takes a function rather than a
string: no autocomplete, no syntax highlighting, no typecheck, inside the most
complex thing a player writes. Milestone 9's Decision 3 chose the function *for*
those affordances and named the closure trap as the price, having considered a
one-bot-one-script world. **Cycle 5 is where that price comes due**, because a
planner's whole job is producing bots that differ only in their parameters.

The design's own example has the shape: `expand(ironLine, 3)` places three
*different* lines. A second argument to `spawn`, serialised as JSON and handed to
the child, would cost nothing and keep the function.

### 5. A planner cannot read whether its children are alive or working

`colony.bots()` answers with `{ time, pos, inventory, modules, busy }`. Not
`stalled`, which exists on `BotSnapshot` and is simply not carried through the
mirror, and nothing at all about whether a script is still running. `busy` means
"has a command in flight", which is true of the deadlocked bot 5 above and also
true of a bot happily working.

So `expand` cannot tell whether the last thing it built is working before
building another, which is exactly the judgement a planner exists to make. This
is milestone 9's finding 3 seen from the other end — that one was "a parent
cannot wait for its child", and it has the same root: **the colony is observable
to the renderer and not to a script.**

---

## What this means for milestone 10

**Cycle 5 does not need new verbs; it needs the reads that make the existing
verbs usable.** Findings 2, 4 and 5 are all the same shape — the engine knows
something and no script can ask. None is large:

- `colony.canPlace(pos, kind)`, or the same answer folded into a scan tile.
- A second argument to `spawn`, serialised, so a blueprint can be parameterised.
- `stalled` and a script-alive flag carried through the mirror into
  `colony.bots()`.

That is a coherent, small milestone, and it is *not* what milestone 9 predicted
milestone 10 would be. Milestone 9 expected cycle 5 to need nothing and named a
non-food material and the Blackbox as the engine's outstanding debts. **The
material is still the right call for making expansion mean something** — nothing
here contradicts that, because this playtest never got far enough to care that
crates are free. It got stuck three walls earlier.

**The open question this did not answer** is the one the design actually scores
on: whether a player *wants* to write `expand(ironLine, 3)`. Every wall above is
mechanical, and a mechanical playtest cannot say whether the sentence feels
earned. That still needs a human who did not write it, and it has needed one
since milestone 3.
