# The Spellbook: chips you saved, a bar to reach them by, and a cast bar per bot

**Goal:** The codebook becomes somewhere the player *puts* things, not only somewhere the game hands things over. A selection in the editor can be saved as a chip of the player's own; any chip — theirs or the game's — can be pinned to one of nine numbered slots and dropped in at the cursor with `Alt`+digit; and every bot on the fleet list grows a cast bar for the command it is running, coloured by **which class of the player API that command belongs to**.

This is not a new milestone. It is player-facing UX on top of what milestone 10 built, and it deliberately does not touch the sim, the bridge, or the protocol.

**Architecture:** Two pure stores in `src/editor/`, one DOM panel, one section added to the codebook, one total `Record` in the palette, and one optional field on `FleetRow`. No new dependencies, no sim change, no protocol change, no progress-key change.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md` — *"a snippet library exists for beginners to copy from; veterans ignore it"* — and milestone 10's codebook doctrine, which this extends rather than replaces: **one surface**, and *"a chip the player went looking for is a pattern to put somewhere, so it inserts at the cursor"*.

**Prior art surveyed before deciding** (2026-09-18):

- **World of Warcraft** is three surfaces, not one, and the request named the wrong one. The **spellbook** is authored content in school tabs — that is today's codebook exactly. The **macro window** is the player-authored one: name, icon, body, saved per character. The **action bar** is 8 bars of 12 slots holding *references* to both; nothing lives on the bar itself.
- **WoW's macro caps are a design statement, not an oversight.** 120 account-wide slots, 18 per character, and **255 characters per macro**. The character cap is the most-complained-about number in the system and has never moved; the 255-character cap is the one that carries meaning — a macro is shorthand, and the moment players wanted programs they wrote addons instead. ([Warcraft Wiki: Macro](https://warcraft.wiki.gg/wiki/Macro))
- **Factorio's blueprint library** is the genre-native version of the same shape: a personal library that persists across saves, books for grouping, export-to-string for sharing, and a quickbar whose slots are **shortcuts, not copies** — edit the library entry and every slot follows; delete it and the links clear themselves. ([Factorio wiki: Blueprint library](https://wiki.factorio.com/Blueprint_library), [Quickbar](https://wiki.factorio.com/Quickbar), [FFF-170](https://www.factorio.com/blog/post/fff-170))

---

## Decisions already made

1. **A saved chip goes in the codebook, not in a window of its own.** Milestone 10 settled this for the suggestion and the book, in a comment worth re-reading: *"a player who is handed a loop when they need one, and then goes looking for it a week later, has to have somewhere to look."* A second panel for the player's own patterns would re-open exactly that. So the book has a `yours` section above the ladders, and it is the same chip with the same click behaviour — insert at the cursor.

2. **A chip is capped at twelve lines, and the refusal names the shared library.** This is WoW's 255-character rule, ported to the unit this game shows the player. The colony already has a reuse mechanism that is *correct* for anything larger — the shared library, where a function is in scope in every bot's script — and a snippet book that silently accepts a forty-line program is a book competing with it and winning for the wrong reason.

   The cap is therefore not a storage limit, it is a **graduation path**: over twelve lines the game says so and points at the library, which is where a program that big belongs. The refusal only mentions the library once the library is researched; before that it says only that the chip is too long.

3. **No cap on how many chips are saved.** The other WoW number, 18 per character, is the one its players have been asking Blizzard to raise for a decade. Shipping the most-complained-about constant in the prior art would be a strange thing to do on purpose.

4. **A slot holds a reference, never a copy** — Factorio's rule, and for Factorio's reason. Rename a chip and the slot shows the new name; edit it and the slot inserts the new code; delete it and the link clears itself rather than lingering as a slot that inserts something the player thought they had thrown away. The store therefore holds `{ kind: "rung", title }` or `{ kind: "saved", id }`, resolved at draw time, and a reference that resolves to nothing draws as an empty slot instead of throwing.

5. **Nine slots, keyed `Alt`+1…9.** Nine because they are digits on one row and a tenth reachable only as `0` is a keybinding a player has to be taught. `Alt` rather than plain digits because the player's hands are in a text editor, where `3` must always mean three; and rather than `Ctrl`, because `Ctrl`+digit is Chrome's tab switcher. The binding is registered through Monaco so it fires while the editor has focus, which is the only time it is worth having.

6. **The cast bar is coloured by the class of the API object the command belongs to.** `bot.harvester.harvest()` runs orange because the harvester is orange on the map already; `bot.builder.place()` runs slate; `bot.move()` runs in the chassis' own neutral. The colours are not new — `palette.MODULE` has had one per module since milestone 4, and this reuses it rather than inventing a second vocabulary for the same five things.

   This is the closest thing the game has to WoW's spell schools, and it earns its place for a reason WoW's does not have to justify: **the class is visible in the code the player wrote.** A player who writes `bot.scanner.scan(2)` and sees blue run across a bot has been shown, without a word of text, that the thing they typed after `bot.` is a *thing* with verbs of its own — which is the one piece of JavaScript this game most needs them to notice.

7. **`COMMAND_CLASS` is a total `Record<Command["kind"], ApiClass>`.** Milestone 4's Decision 7, unchanged: anything keyed by a sim union is a `Record` over that union, so a new command is a row the compiler demands rather than a branch somebody has to remember. Milestone 12 adds a verb; it will be asked for its colour at compile time.

8. **The bar's own slots carry the same colour**, derived from the chip's code by the primitives it uses (`source.primitivesIn`, already written and already the thing the codebook unlocks rungs by). So a chip is the same colour on the bar as the bot is while running it. Where a chip uses several classes, the most specific wins over the chassis, because *"harvest, then move"* is a harvesting pattern.

9. **Saved chips live in `localStorage` and never in the progress key.** Milestone 10 split these deliberately — the key carries what you *learned* and is short enough to read aloud; your code is neither short nor anybody else's business. A saved chip is code. It follows the scripts.

10. **No new art.** The prior art's chips are icons because a spell is an atom with a picture; these chips are legible because they show their code, the panel is 22rem wide, and there is no icon anywhere in this project. Slots therefore show a digit, a name and a class colour, and the code on hover — the one thing Factorio's auto-generated blueprint icons are for is telling two saved things apart, and a name does that here.

11. **The fleet row keeps its sentence.** `describeBotActivity` already says *"harvest — 2 of 3 ticks left"*, and the inspector shows the same string on hover where there is no bar to draw. The bar is drawn from the same `remaining`/`total` the sentence quotes, and neither is derived from the other's text.

---

## What was verified

Recorded after building, not before.

- `npm run typecheck` clean, `npm test` 834 passing (803 before, so 31 new). The new files are `tests/editor/saved-chips.test.ts` and `tests/editor/chip-bar.test.ts`; `classOf` is tested in `tests/editor/source.test.ts` and `castOf` in `tests/render/hud.test.ts`.
- **On the page**, driven by hand in the Browser pane. The standing note that the pane runs no `requestAnimationFrame` still holds and still matters: nothing drew until `globalThis.frame()` was called, though the sim's own clock ticks regardless.
  - Selecting two lines and saving them prefilled the name `harvest`, said *"2 lines selected"*, and produced a chip whose stripe read `rgb(216, 112, 60)` — `MODULE.harvester`, from `bot.harvester.harvest()` being the first classed call in it.
  - Pinning put it in slot 1, which then read `1 harvest` with the same orange stripe and a tooltip naming `Alt+1` and quoting the code. The chip's own button changed from `pin` to `Alt+1`.
  - `Alt`+1 with the editor focused inserted the chip at the cursor and Monaco called `preventDefault`, which is the whole argument for binding through the editor rather than through `window`.
  - Renaming the chip to `sweep east` changed what slot 1 showed **without touching the bar**, and deleting it emptied the slot and dropped the link from storage. That is Decision 4 demonstrated rather than asserted.
  - A thirteen-line selection was refused with *"13 lines is a program, not a chip — chips stop at 12"*, and the name field stayed open so nothing was lost.
  - The cast bar, sampled over eight frames of a harvest loop: `chassis — 50%` in bone `rgb(143, 154, 122)` while moving, `harvester — 0%` then `67%` in orange while harvesting, hidden while idle. Colour and fraction both change with the class of the command in flight, which is what this was for.

### One bug found on the page, and what it changed

The first version handed the codebook its saved chips as part of the per-frame `CodebookView`. Saving a chip then redrew the panel *from the click*, before the next frame had supplied a new list — so the store held the chip and the panel went on saying "nothing saved yet". With a render loop that is one stale frame; in the pane, where there is no loop, it never resolved.

The fix is worth more than the bug: **the world arrives as a view, and the book and the bar are read live.** A panel cannot ask a snapshot for a fresher one, so anything the player changes by clicking has to be read from the thing that holds it. `BookStores` says so in `codebook.ts`, and `bar-panel.ts` takes the stores for the same reason.

### Known limits, stated rather than left to be found

- **Nine names across the editor column truncate.** At 1440px wide a slot is about 50px, which fits `reap and…`. The full name and the code are in the tooltip. This is the cost of a bar being a bar; the alternative was icons, which this project has none of and which would hide the code rather than shorten it.
- **A pinned chip is not gated on hardware.** Pin a scanner chip, remove the scanner, and the slot still inserts `bot.scanner.scan(2)` — where the editor will underline it, because `api-surface.ts` has already taken the namespace away. That is the same answer the book gives for a ladder whose module is missing, one step later.
- **`Alt`+digit is registered on the editor only.** With focus in the side panel the keys do nothing and the slots must be clicked. Deliberate, per Decision 5.
