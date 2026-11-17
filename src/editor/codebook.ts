import type * as monaco from "monaco-editor";
import { insertAtCursor, replaceAll } from "./insert.ts";
import { LADDERS, SNIPPETS, needsFor } from "./snippets.ts";
import type { Ladder, Rung } from "./snippets.ts";
import { refKey, type ChipBar, type ChipRef } from "./chip-bar.ts";
import { lineCount, suggestName } from "./saved-chips.ts";
import type { SaveResult, SavedChip, SavedChips } from "./saved-chips.ts";
import { classOf, PRIMITIVE_LABEL } from "./source.ts";
import type { Primitive } from "./source.ts";
import { CLASS_COLOR, cssColor } from "../render/palette.ts";
import type { Suggestion } from "./suggestions.ts";

/**
 * The codebook: what the player has learned, and whichever chip the game is
 * offering them next.
 *
 * **One surface, deliberately.** The suggestion and the book used to be two
 * things — a chip in the side panel and a floating panel behind a button — and
 * that was wrong in a way worth stating: a player who is handed a loop when they
 * need one, and then goes looking for it a week later, has to have somewhere to
 * look. If the suggestion is a card that appears and vanishes, the game taught
 * them something and then took it away. So the suggestion **is** the book,
 * raising the chip it wants them to see, in the place they will come back to.
 *
 * **A ladder, not a list.** Several chips turned out to be the same program
 * growing up, and showing them as siblings hid the only interesting thing about
 * them. Each ladder is a line of descent; the player toggles along it to see
 * what their program became, and the rungs open as they earn them.
 *
 * **And a section the player writes.** WoW keeps these apart — a spellbook of
 * what you were taught, a macro window for what you wrote — and they are one
 * panel here for the same reason the suggestion is: somewhere to look. A chip
 * you saved sits above the ladders, behaves exactly like a chip the game gave
 * you, and can be pinned to the bar alongside one.
 *
 * Two gates, and they are deliberately different:
 *
 * - **Hardware hides a ladder.** No scanner, no scanner ladder — the same answer
 *   part one gives in autocomplete, where a locked namespace is absent rather
 *   than struck through.
 * - **A rung the player has not earned is shown, locked, and names what it
 *   needs.** The opposite call, on purpose. A completion list answers "what can
 *   I type right now", where anything extra is noise. A book is a thing you read
 *   ahead in, and one you can see further into is one worth climbing. It is also
 *   the most useful hint the game has: on a fresh save the first rung reads
 *   *"needs while"*, which is the whole lesson of the first ten minutes.
 */

export interface CodebookView {
  suggestion: Suggestion | null;
  /** Chips the game has raised. Each counts as its rung being unlocked. */
  offered: ReadonlySet<string>;
  /** Primitives the player has run. */
  vocabulary: ReadonlySet<Primitive>;
  /** Modules on the bot whose script is open. */
  modules: ReadonlySet<string>;
  /** Machine kinds standing in the world. */
  machines: ReadonlySet<string>;
}

/**
 * The two stores this panel reads, as stores rather than as snapshots.
 *
 * **Everything else here arrives as a `CodebookView` once a frame, and these
 * deliberately do not.** Found by saving a chip and watching the panel go on
 * saying "nothing saved yet": a click redraws immediately, a view is a copy
 * taken at the last frame, and so the panel redrew from a list that did not have
 * the chip in it yet. On a page with a render loop that is one stale frame; in a
 * pane without one it never resolves at all.
 *
 * So: the world arrives as a view, because a panel cannot ask a snapshot for a
 * newer one. The book and the bar are asked directly, because they are right
 * here and always current. Writing still goes through `CodebookActions` — the
 * page owns what a save *means*, including which sentence a refusal gets.
 */
export interface BookStores {
  chips: SavedChips;
  bar: ChipBar;
}

export interface Codebook {
  /** Expand or collapse the ladders. The suggestion is visible either way. */
  toggle(): void;
  /** Redraw, doing nothing when nothing that shows has changed. */
  update(view: CodebookView): void;
}

const unlocked = (ladder: Ladder, i: number, view: CodebookView): boolean =>
  view.offered.has(ladder.rungs[i]!.title) ||
  needsFor(ladder, i).every((p) => view.vocabulary.has(p));

const owned = (ladder: Ladder, view: CodebookView): boolean =>
  (!ladder.requires || view.modules.has(ladder.requires)) &&
  (!ladder.needsMachine || view.machines.has(ladder.needsMachine));

/** What a locked rung is still waiting on, in the player's words. */
function missing(ladder: Ladder, i: number, view: CodebookView): string[] {
  return needsFor(ladder, i)
    .filter((p) => !view.vocabulary.has(p))
    .map((p) => PRIMITIVE_LABEL[p]);
}

export interface CodebookActions {
  /** The player took the suggested chip. */
  onTake: (id: string) => void;
  /** The player refused it. Not the same act — see `Suggester.take`. */
  onRefuse: (id: string) => void;
  /** Save a selection as a chip of the player's own. */
  onSave: (name: string, code: string) => SaveResult;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Put a chip on the bar. Answers the slot it landed in, or null when full. */
  onPin: (ref: ChipRef) => number | null;
}

export function createCodebook(
  root: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor,
  actions: CodebookActions,
  book: BookStores,
): Codebook {
  root.innerHTML = `
    <h2 class="group-title">codebook</h2>
    <div class="book-suggested"></div>
    <div class="book-yours" hidden></div>
    <div class="book-ladders" hidden></div>
    <p class="hint book-hint"></p>`;

  const suggestedEl = root.querySelector<HTMLElement>(".book-suggested")!;
  const yoursEl = root.querySelector<HTMLElement>(".book-yours")!;
  const laddersEl = root.querySelector<HTMLElement>(".book-ladders")!;
  const hintEl = root.querySelector<HTMLElement>(".book-hint")!;

  let open = false;
  /** Which rung of each ladder is on show. UI state, so it survives a redraw. */
  const showing = new Map<string, number>();
  /** What the last redraw drew, so a frame that changes nothing touches no DOM. */
  let drawn = "";
  let view: CodebookView | null = null;
  /** True while the name field for a new chip is open. */
  let naming = false;
  /** Which saved chip is having its name edited, if any. */
  let renaming: string | null = null;
  /** Why the last save was refused, shown until the next attempt. */
  let refusal: string | null = null;

  /**
   * A chip, and what clicking it does.
   *
   * The two are not the same act, which the first playtest established the hard
   * way: a **suggested** chip is a whole program answering "your script is
   * wrong", so it replaces; a chip the player went **looking for** in the book
   * is a pattern to put somewhere, so it inserts at the cursor. See `insert.ts`.
   */
  function codeChip(rung: Rung, suggested: boolean): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = suggested ? "chip chip-suggest" : "chip";
    // The class of API object this chip is about, in the colour the bot will
    // run it in. The same edge appears on a bar slot and on the fleet row while
    // it runs, which is the point: three places, one vocabulary.
    chip.style.borderLeftColor = cssColor(CLASS_COLOR[classOf(rung.code)]);

    const blurb = document.createElement("span");
    blurb.className = "chip-blurb";
    blurb.textContent = rung.blurb;
    chip.append(blurb);

    const code = document.createElement("pre");
    code.textContent = rung.code;
    chip.append(code);

    const what = document.createElement("em");
    what.className = "chip-take";
    what.textContent = suggested
      ? "click to make this your script — Ctrl+Z puts yours back"
      : "click to drop it in at the cursor";
    chip.append(what);

    chip.addEventListener("click", () =>
      suggested ? replaceAll(editor, rung.code) : insertAtCursor(editor, rung.code),
    );
    return chip;
  }

  function drawSuggestion(suggestion: Suggestion | null): void {
    suggestedEl.replaceChildren();
    if (!suggestion) return;

    const rung = LADDERS.flatMap((l) => l.rungs).find((r) => r.title === suggestion.chip);
    if (!rung) return;

    const why = document.createElement("p");
    why.className = "book-why";
    why.textContent = suggestion.why;
    suggestedEl.append(why);

    const title = document.createElement("p");
    title.className = "rung-title";
    title.textContent = rung.title;
    suggestedEl.append(title);

    const chip = codeChip(rung, true);
    // A reactive suggestion is finished once taken — a chip that comes back
    // after you used it is a chip telling you that you did it wrong. An opening
    // step is not: it is advanced by running it. The suggester knows which.
    chip.addEventListener("click", () => actions.onTake(suggestion.id));
    suggestedEl.append(chip);

    // Dismissal is one click and it is permanent, which the IDE prior art is
    // unanimous about: a suggestion that cannot be turned off is the one that
    // loses the player's trust in every suggestion after it.
    const no = document.createElement("button");
    no.type = "button";
    no.className = "suggest-dismiss";
    no.textContent = "no thanks — keep it in the book";
    no.addEventListener("click", () => actions.onRefuse(suggestion.id));
    suggestedEl.append(no);
  }

  /**
   * "Put this where I can reach it."
   *
   * On every chip that has code, the player's own and the game's alike: a rung
   * the game handed over is exactly as worth pinning as one the player wrote,
   * and a bar that only took half the book would be a bar with a rule to explain.
   */
  function pinButton(ref: ChipRef): HTMLButtonElement {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "chip-pin";
    const at = book.bar.slotOf(ref);
    // The slot's *key*, not its index: what the player needs from this label is
    // the digit they are going to press.
    pin.textContent = at === null ? "pin" : `Alt+${at + 1}`;
    pin.title =
      at === null
        ? "put this in the first free bar slot"
        : `on the bar — Alt+${at + 1} drops it in at the cursor`;
    pin.addEventListener("click", (e) => {
      e.stopPropagation();
      const slot = actions.onPin(ref);
      refusal = slot === null ? "the bar is full — right-click a slot to free one" : null;
      redraw(true);
    });
    return pin;
  }

  /** What the player selected in the editor, with no trailing blank lines. */
  function selection(): string {
    const model = editor.getModel();
    const range = editor.getSelection();
    if (!model || !range) return "";
    return model.getValueInRange(range).replace(/\s+$/, "");
  }

  /**
   * The saving control: one button, which becomes a name field when pressed.
   *
   * Prefilled from the code, because a player who has just selected four lines
   * has already decided what it is and should not have to say so before the game
   * will keep it. Enter saves, Escape gives up, and a refusal stays on screen
   * rather than flashing — the twelve-line rule is a thing worth reading.
   */
  function drawSaveControl(): void {
    if (!naming) {
      const start = document.createElement("button");
      start.type = "button";
      start.className = "book-save";
      start.textContent = "save the selection as a chip";
      start.addEventListener("click", () => {
        naming = true;
        refusal = null;
        redraw(true);
      });
      yoursEl.append(start);
      return;
    }

    const code = selection();
    const form = document.createElement("div");
    form.className = "book-naming";

    const field = document.createElement("input");
    field.type = "text";
    field.className = "book-name";
    field.value = suggestName(code);
    field.setAttribute("aria-label", "chip name");

    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "save";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "cancel";

    const commit = (): void => {
      const result = actions.onSave(field.value, code);
      refusal = result.ok ? null : result.reason;
      naming = !result.ok;
      redraw(true);
    };
    const give = (): void => {
      naming = false;
      refusal = null;
      redraw(true);
    };

    save.addEventListener("click", commit);
    cancel.addEventListener("click", give);
    field.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") give();
    });

    form.append(field, save, cancel);
    yoursEl.append(form);

    const what = document.createElement("p");
    what.className = "hint";
    const lines = lineCount(code);
    what.textContent =
      lines === 0
        ? "nothing is selected — highlight some code first"
        : `${lines} line${lines === 1 ? "" : "s"} selected`;
    yoursEl.append(what);

    field.focus();
    field.select();
  }

  function drawSavedChip(chip: SavedChip): HTMLElement {
    const box = document.createElement("div");
    box.className = "saved";

    const head = document.createElement("div");
    head.className = "saved-head";

    if (renaming === chip.id) {
      const field = document.createElement("input");
      field.type = "text";
      field.className = "book-name";
      field.value = chip.name;
      field.setAttribute("aria-label", "new name");
      const done = (commit: boolean): void => {
        if (commit) actions.onRename(chip.id, field.value);
        renaming = null;
        redraw(true);
      };
      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
      });
      field.addEventListener("blur", () => done(true));
      head.append(field);
      box.append(head);
      queueMicrotask(() => {
        field.focus();
        field.select();
      });
      return box;
    }

    const name = document.createElement("strong");
    name.textContent = chip.name;
    head.append(name);

    const tools = document.createElement("span");
    tools.className = "saved-tools";
    tools.append(pinButton({ kind: "saved", id: chip.id }));

    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "chip-pin";
    rename.textContent = "rename";
    rename.addEventListener("click", () => {
      renaming = chip.id;
      redraw(true);
    });
    tools.append(rename);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-pin";
    remove.textContent = "delete";
    // No confirmation. The chip is a copy of something the player wrote, the
    // script it came from is untouched, and a modal for four lines of text
    // would cost more attention than losing them does.
    remove.addEventListener("click", () => {
      actions.onDelete(chip.id);
      redraw(true);
    });
    tools.append(remove);

    head.append(tools);
    box.append(head);

    // A saved chip is a `Rung` as far as the chip renderer is concerned: it has
    // a title, code, and nothing it introduces. Reusing `codeChip` is what keeps
    // "click to drop it in at the cursor" a single sentence written once.
    box.append(codeChip({ title: chip.name, blurb: "", code: chip.code, introduces: [] }, false));
    return box;
  }

  function drawYours(): void {
    yoursEl.replaceChildren();

    const title = document.createElement("h3");
    title.className = "book-subtitle";
    title.textContent = "yours";
    yoursEl.append(title);

    drawSaveControl();

    if (refusal) {
      const why = document.createElement("p");
      why.className = "book-refusal";
      why.textContent = refusal;
      yoursEl.append(why);
    }

    const saved = book.chips.list();
    if (saved.length === 0) {
      const none = document.createElement("p");
      none.className = "hint";
      none.textContent = "nothing saved yet. Select some code and it lands here.";
      yoursEl.append(none);
      return;
    }
    for (const chip of saved) yoursEl.append(drawSavedChip(chip));
  }

  /** The rung to open a ladder on: the furthest the player has got. */
  function defaultRung(ladder: Ladder, v: CodebookView): number {
    let best = 0;
    ladder.rungs.forEach((_, i) => {
      if (unlocked(ladder, i, v)) best = i;
    });
    return best;
  }

  function drawLadder(ladder: Ladder, v: CodebookView): HTMLElement {
    const box = document.createElement("div");
    box.className = "ladder";

    const at = Math.min(showing.get(ladder.id) ?? defaultRung(ladder, v), ladder.rungs.length - 1);
    const rung = ladder.rungs[at]!;
    const isUnlocked = unlocked(ladder, at, v);

    const head = document.createElement("div");
    head.className = "ladder-head";

    const name = document.createElement("strong");
    name.textContent = ladder.name;
    head.append(name);

    // The toggle only exists where there is something to toggle between.
    if (ladder.rungs.length > 1) {
      const nav = document.createElement("span");
      nav.className = "rung-nav";

      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "‹";
      back.disabled = at === 0;
      back.title = "the form before this one";
      back.addEventListener("click", () => {
        showing.set(ladder.id, at - 1);
        redraw(true);
      });

      const count = document.createElement("span");
      count.className = "rung-count";
      count.textContent = `${at + 1}/${ladder.rungs.length}`;

      const on = document.createElement("button");
      on.type = "button";
      on.textContent = "›";
      on.disabled = at === ladder.rungs.length - 1;
      on.title = "what it grows into";
      on.addEventListener("click", () => {
        showing.set(ladder.id, at + 1);
        redraw(true);
      });

      nav.append(back, count, on);
      head.append(nav);
    }
    box.append(head);

    const title = document.createElement("p");
    title.className = "rung-title";
    title.textContent = rung.title;
    box.append(title);

    if (isUnlocked) {
      box.append(codeChip(rung, false));
      box.append(pinButton({ kind: "rung", title: rung.title }));
    } else {
      const lock = document.createElement("p");
      lock.className = "rung-locked";
      const needs = missing(ladder, at, v);
      lock.textContent = needs.length
        ? `locked — use ${needs.join(", ")} in a script of your own`
        : "locked";
      box.append(lock);
    }
    return box;
  }

  function draw(v: CodebookView): void {
    drawSuggestion(v.suggestion);

    drawYours();
    yoursEl.hidden = !open;

    laddersEl.replaceChildren();
    const visible = LADDERS.filter((l) => owned(l, v));
    for (const ladder of visible) laddersEl.append(drawLadder(ladder, v));
    laddersEl.hidden = !open;

    const climbed = visible.reduce(
      (n, l) => n + l.rungs.filter((_, i) => unlocked(l, i, v)).length,
      0,
    );
    // The shut hint says the book takes chips as well as gives them, because
    // otherwise the only way to find that out is to open a book you think you
    // have already read.
    hintEl.textContent = open
      ? "Click a chip to drop it in at the cursor. Pin one to reach it with Alt+1…9."
      : `${climbed} of ${SNIPPETS.length} patterns learned, ${book.chips.list().length} of your own.`;
  }

  function redraw(force = false): void {
    if (!view) return;
    // A field the player is typing in outlives everything else on this panel.
    // The world changes every tick and this panel redraws from it; rebuilding
    // the DOM under an open name field would eat the name a letter at a time.
    if (!force && (naming || renaming !== null)) return;
    const v = view;
    const key = [
      v.suggestion?.id ?? "",
      [...v.offered].sort().join(","),
      [...v.vocabulary].sort().join(","),
      [...v.modules].sort().join(","),
      [...v.machines].sort().join(","),
      book.chips.list().map((c) => `${c.id}:${c.name}:${c.code.length}`).join(","),
      book.bar.slots().map((s) => (s ? refKey(s) : "")).join(","),
      [...showing].map(([k, n]) => `${k}:${n}`).sort().join(","),
      open ? "open" : "shut",
    ].join("|");
    if (!force && key === drawn) return;
    drawn = key;
    draw(v);
  }

  return {
    toggle() {
      open = !open;
      redraw(true);
      if (open) root.scrollIntoView({ block: "nearest" });
    },

    update(next) {
      view = next;
      redraw();
    },
  };
}
