# Milestone 10, part four: the save is a code you can read out loud

Fourth of four, and the one the other three made necessary. Part three ended on
*"nothing persists"* — and that turned out to understate it. **Nothing persisted
at all.** There was no `localStorage` anywhere in the codebase; the design
scoped save/load out of the first playable and even the localStorage half was
never built. A reload lost the world, the research, the codebook and the
player's scripts.

## The idea

A **progress key**: a short code the game issues, which encodes how far along you
are. Type an old one back in and the game recognises it. Password saves, as
console games did them before memory cards.

It is a better fit here than a save file, for a reason specific to this game:

**What you have learned is small. What you have built is not.** The codebook's
progress is 20 primitives, 13 rungs and 11 researches — 44 yes/no facts, which
is eleven characters. A 32×32 world of belts and bots and scripts is kilobytes.
So a key can honestly carry what you *know* and cannot carry what you *built* —
and for a game whose pitch is "the API is the tech tree, code is always free", a
save that is a certificate of what you learned rather than a snapshot of where
your belts were is that idea stated once more.

## Decisions

1. **The key carries knowledge and research; `localStorage` carries scripts.**
   Two mechanisms with two honest jobs. The key is short, portable and readable
   down a phone; it travels between machines and between people. Your code is
   neither short nor anybody else's business, and losing a serpentine sweep you
   spent ten minutes on is the thing a player would actually mourn — so the
   browser keeps that where you left it.

2. **Research is in the key, and it grants the hardware it always granted.**
   `World.unlockResearch` performs the console's own two steps — unlock, then
   `grant` — so a key that says "scanner" leaves a spare scanner to *fit* rather
   than a permission with no hardware behind it. The ladders stay gated on the
   module being fitted, so a restored player refits from the build menu. That is
   a hands phase, which is the right shape for this game.

   It emits no `research` event, deliberately: nothing just happened in the
   world, and the suggestion rules key off that event. A restored colony should
   not be told its scanner has arrived. It had one before the page was closed.

3. **`localStorage` stores the key string itself, not a second format.** One
   encoder, one decoder, and no way for the convenience copy to drift from the
   thing you can write down. A reload keeps your progress without typing; the
   key exists for leaving this browser.

4. **Restoring is additive and idempotent.** A player who types a key mid-session
   keeps what they have learned since booting, and typing it twice does nothing
   the second time. There is no case where forgetting something the player has
   demonstrably done is the right answer.

## The ordering trap, handled up front

A compact key is a bitfield, so every bit's meaning is its **position**. Insert a
primitive into the middle of the list in three months and *every key ever issued*
silently decodes into somebody else's progress — the player types their own key
and is handed a different game. Nothing at runtime can detect it.

So `FACTS` is append-only and frozen: new facts go on the end, never in the
middle, never removed, and a retired fact keeps its slot as a tombstone.
`tests/editor/progress-key.test.ts` opens with a **literal copy of the whole
list**, which is deliberately the dumbest possible test — reordering fails the
build rather than the player. A `VERSION` character on the front means a key from
a newer build is refused with a sentence instead of misread.

Appending does not need a version bump: an old key has zeros where the new facts
are, which is the truth about somebody who earned them before they existed.

## Reading it aloud

Crockford's base32 — no `I`, `L`, `O` or `U`. The first three because a key read
down a phone or copied off a screenshot must not turn a `1` into an `I`; the `U`
because it keeps accidental profanity out of a string the game hands to
strangers. The decoder maps the confusable characters back, ignores case, spaces
and the dashes the encoder added, and carries one checksum character.

**The checksum is the part that matters.** Without it a single mistyped character
is a *valid* key for different progress, and the player is silently handed
somebody else's game. A test flips every character of a key in turn and asserts
all of them are caught.

## What shipped

- `src/editor/progress-key.ts` — `FACTS`, `encodeKey`, `decodeKey`, and the two
  functions that gather and split them. Pure, no DOM.
- `src/editor/key-panel.ts` — a read-only field you click to select, a box to
  type one into, and a line saying how it went.
- `src/sim/world.ts` — `unlockResearch`.
- `src/editor/script-store.ts` — scripts to `localStorage`, with every read and
  write wrapped: storage is absent in Node, blocked in a locked-down browser and
  full at some undocumented size, and none of those is a reason a player's editor
  should fail to open.

## Two bugs found by reloading the page

Neither was visible in the code and both were obvious the moment the page came
back.

1. **The editor mounts before the script store exists** — it needs a container,
   the store needs a session — so it opened on `OPENING_SCRIPT` whatever was in
   storage. A returning player was quietly handed the beginner's two-liner with
   their own work sitting in `localStorage` behind it.

2. **`stash` was only reached by pressing Run or selecting another bot.** Type
   for ten minutes, reload, lose all of it. Saving now happens on an idle pause,
   as everything else that holds text does.

## Verified on the page

Clean tab, no console errors:

- Fresh game: `1000-0000-00Z`. After running a loop with an `if` in it and
  researching the scanner: `1N08-0800-004`.
- `localStorage.clear()`, reload — back to the fresh key, no research, first rung
  locked.
- Typing `1n0808000004` (lowercase, no dashes) → *"key accepted — 1 researched,
  4 learned"*, the scanner is researched, **"Fit scanner"** appears in the build
  menu, and the field loop opens on rung 2 — the furthest rung that key paid for.
- Fitting the scanner makes "Looking around" appear.
- Re-encoding gives back the identical key.
- Bad keys: a flipped character → *"that key has a typo in it somewhere"*;
  `hello world` → the same; `!` → *"“!” is not part of a key"*; an empty submit
  does nothing and says nothing.
- Typing a script and **never pressing Run**, then reloading: it comes back.

702 tests pass; `tsc --noEmit` clean.

## Known, and left alone

**A key can be shared, and that is not a bug.** Somebody can hand a friend a key
for progress they never earned. This is a single-player game with no leaderboard,
and it is the oldest feature of password saves rather than a hole in one. The
codebook's claim is "you learned this", and a player who types a stranger's key
has decided what that claim is worth to them.

**The world is not in the key,** by choice. A restored player has their knowledge
and their hardware and an empty field. Whether that is the right feeling is a
playtest question, not a code one — and it is the same question as whether the
farm was ever the interesting part.

**Nothing prunes `localStorage`.** Scripts accumulate per bot id forever, and a
bot that is removed keeps its buffer. Harmless at this size and worth a line here
so that it is a known thing rather than a discovered one.
