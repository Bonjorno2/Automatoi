# Milestone 10, part one: the editor stops lying about the tech tree

Built rather than planned: the change is small enough that the argument for it is
worth more than a task list, and it is recorded here because it settles a claim
the design has made since day one.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — "Research
hands out hardware, never language features", "The API is the tech tree", and the
rule under "API shape": *"Namespaces are the tutorial. Autocomplete on `bot.`
lists what you have."*

## The finding this starts from

**That last sentence was false, and had been since milestone 3.** `editor.ts`
called `addExtraLib` once at boot with the whole generated `.d.ts`, so a fresh
save offered `bot.builder`, `bot.radio` and `colony.fabricator` to a chassis
carrying one harvester and a colony that had researched none of them. Every
namespace the research tree exists to hand out was already in the completion
list, fully documented, before a single wheat had been spent.

Nothing failed loudly. A player who took the offer got the sim's own runtime
message — "Bot 1 has no Scanner module" — which is correct and is also the
design's own "failure is content" table doing the job the *editor* was supposed
to do first. The cost is not a bug. It is that the tech tree had no presence in
the one place the player spends their time, so "research is the API" was a
sentence in a design document rather than something felt.

The landscape research that prompted this says the same thing from the other
side: the recurring critique of Screeps is that a complete, accurate API
reference still leaves players reverse-engineering the basics, because a
reference answers *what does X do* and never *what can I do right now*. A
completion list is the only artifact in a programming game that can answer the
second question, and ours was answering it wrong.

## Decisions

1. **A locked namespace is absent, not greyed out.** Monaco can strike a member
   through with `@deprecated` and explain itself on hover, which was the other
   candidate and is friendlier on the one occasion a player types the name of
   something they have not bought. It was rejected because it keeps the failure
   the change exists to fix: the list of what you can do would still be the list
   of everything, with decoration. The price is paid on that one occasion —
   `Property 'scanner' does not exist on type 'BotApi'` is a duller sentence than
   the sim's — and the gain is that on every other occasion the list is true.

2. **Modules follow the chassis; colony verbs follow the research.** `bot.scanner`
   appears when *this bot* has a scanner fitted, not when the colony has
   researched one, because that is what the sim enforces: research produces a
   spare module and the build menu's Fit puts it on a bot. `colony.fabricator`
   follows research, because a colony owns it. Getting this backwards would have
   been the easier build and would have re-introduced the same lie one level
   down — an autocompleted `bot.scanner` on the bot you forgot to fit.

3. **The shared library sees the union of the fleet.** A library function is
   every bot's prelude, so gating it to one chassis would squiggle a helper in
   the file it is written in while it compiles perfectly in the bot that runs it.

4. **The `?` stays.** `api.ts` says in bold not to drop the optionality from the
   module namespaces, and gating is exactly the argument that could reopen it: if
   the type only contains what you own, the `?` carries no information. It stays
   anyway, because the reason for it is a *runtime* asymmetry — the namespaces
   are always present so the sim can produce its own error message — and that
   has not changed. It costs the player nothing: the editor runs with
   `strictNullChecks` off, so `bot.harvester.harvest()` is clean in front of them.

5. **Numbers are substituted, never typed.** Every tick cost, capacity and
   channel size in the hover text is a `%placeholder%` in `api.ts` that
   `generate-dts.ts` resolves from `config.ts` and `protocol.ts`. The design says
   these are tuned in playtests; a hand-written "costs 2 ticks" is a sentence
   that becomes a lie the first time someone tunes it, and hover text that lies
   is worse than hover text that is silent. An unresolved placeholder throws in
   the generator rather than shipping as a literal `%`.

6. **Gating is driven from `draw`, not from an event.** The three things that
   change the answer — a module fitted, a research landing, a different bot
   selected — arrive by three different paths, and a snapshot read every frame
   cannot miss one. It is cheap by construction: the composed text is
   byte-stable, and Monaco's `addExtraLib` compares content and does nothing when
   it matches, so an unchanged surface never disturbs the TypeScript worker.

## What shipped

- `scripts/generate-dts.ts` lifts each hardware namespace out of its interface
  and re-emits it as a `//#gate module:scanner` block that merges back in by
  declaration merging. A file read whole — by a typecheck, by a test — is the
  same type it was before this existed.
- `src/editor/api-surface.ts` parses those blocks and composes the slice a given
  player has earned. No Monaco import, so it has tests of its own.
- `src/bridge/api.ts` gained real doc comments on every verb: what it costs,
  what it answers, how it refuses, and a worked example. Monaco renders the
  fenced blocks in both the hover and the completion detail pane.
- `src/editor/main.ts` syncs the surface each frame; `api()` on the dev console
  reports what the editor believes and what it is complaining about.
- The "Don't overfill" snippet stopped claiming `harvest()` throws when full.
  It has answered `false` since the commit two before this one, and the chip was
  teaching a control flow that no longer exists.

## Verified on the page

Driven at `localhost:5176`, cross-origin isolated, with `frame()` called by hand
because the preview pane delivers no `requestAnimationFrame`:

- A fresh save: `api().gates` is `module:harvester` alone, and the completion
  list on `bot.` is `deposit, harvester, inventory, log, move, pos, wait,
  withdraw` — every always-present verb and the one module the chassis carries.
- `bot.scanner.scan(2)` in that save: `Property 'scanner' does not exist on type
  'BotApi'`, on line 1.
- Researching and fitting a scanner, then one frame: `module:harvester,
  module:scanner, research:scanner`, `scanner` joins the completion list, and the
  complaint clears **without a reload**.
- Hover on `move`: *"Step one tile. Costs 2 ticks."* — the 2 is `TICK_COST.move`,
  substituted — followed by the prose and the example.

629 tests pass, `tsc --noEmit` is clean.

## What this does not do

It does not build the codex panel. The research named four other shapes this
could take — a Shenzhen-style manual, Tunic's manual-as-progression, editor-flow
plumbing — and the one chosen here is the smallest and the one the others rest
on, because a reference panel that disagrees with the completion list is just
the original problem with more surface area.

**Still open, and untouched here:** the three reads cycle 5's playtest asked for
(`colony.canPlace`, a second argument to `spawn`, `stalled` through the mirror).
They are the other half of milestone 10 and nothing above changes their shape.

**Still open from the flow research, deliberately not started:** buffer switching
is invisible — clicking a bot on the map silently replaces what is in the editor,
with no tab, no dirty mark and no indication which bot you are looking at beyond
the fleet row's highlight. That is the loop-level finding, it is real, and it is
a decision rather than a defect.
