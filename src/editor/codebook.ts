import type * as monaco from "monaco-editor";
import { insertAtCursor, replaceAll } from "./insert.ts";
import { LADDERS, SNIPPETS, needsFor } from "./snippets.ts";
import type { Ladder, Rung } from "./snippets.ts";
import { PRIMITIVE_LABEL } from "./source.ts";
import type { Primitive } from "./source.ts";
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
}

export function createCodebook(
  root: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor,
  actions: CodebookActions,
): Codebook {
  root.innerHTML = `
    <h2 class="group-title">codebook</h2>
    <div class="book-suggested"></div>
    <div class="book-ladders" hidden></div>
    <p class="hint book-hint"></p>`;

  const suggestedEl = root.querySelector<HTMLElement>(".book-suggested")!;
  const laddersEl = root.querySelector<HTMLElement>(".book-ladders")!;
  const hintEl = root.querySelector<HTMLElement>(".book-hint")!;

  let open = false;
  /** Which rung of each ladder is on show. UI state, so it survives a redraw. */
  const showing = new Map<string, number>();
  /** What the last redraw drew, so a frame that changes nothing touches no DOM. */
  let drawn = "";
  let view: CodebookView | null = null;

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

    laddersEl.replaceChildren();
    const visible = LADDERS.filter((l) => owned(l, v));
    for (const ladder of visible) laddersEl.append(drawLadder(ladder, v));
    laddersEl.hidden = !open;

    const climbed = visible.reduce(
      (n, l) => n + l.rungs.filter((_, i) => unlocked(l, i, v)).length,
      0,
    );
    hintEl.textContent = open
      ? "Click a chip to drop it in at the cursor."
      : `${climbed} of ${SNIPPETS.length} patterns learned.`;
  }

  function redraw(force = false): void {
    if (!view) return;
    const v = view;
    const key = [
      v.suggestion?.id ?? "",
      [...v.offered].sort().join(","),
      [...v.vocabulary].sort().join(","),
      [...v.modules].sort().join(","),
      [...v.machines].sort().join(","),
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
