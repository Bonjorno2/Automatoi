import type * as monaco from "monaco-editor";
import { insertAtCursor } from "./insert.ts";
import { SNIPPETS } from "./snippets.ts";
import type { Snippet } from "./snippets.ts";
import type { Suggestion } from "./suggestions.ts";

/**
 * The codebook: every pattern the game knows, and whichever one it is offering.
 *
 * **One surface, deliberately.** The suggestion and the book used to be two
 * things — a chip in the side panel and a floating panel behind a button — and
 * that was wrong in a way worth stating: a player who is handed a loop when they
 * need one, and then goes looking for it a week later, has to have somewhere to
 * look. If the suggestion is a card that appears and vanishes, the game taught
 * them something and then took it away. So the suggestion **is** the book,
 * raising the chip it wants them to see, in the place they will come back to.
 *
 * That also settles what dismissal means. "No thanks" retires the *suggestion*
 * and leaves the *chip* exactly where it was, one click further down. Refusing
 * advice is not the same as losing it.
 *
 * Three tiers, top to bottom:
 *
 * 1. **Suggested now** — at most one, with the reason it is being offered.
 * 2. **Offered before** — chips the game has raised at some point. What it has
 *    taught you is the part of the book you are most likely to want again.
 * 3. **The rest**, collapsed until the player asks for it.
 *
 * Clicking any chip anywhere inserts it at the cursor. Insertion, not the
 * clipboard: milestone 7 settled that and `insert.ts` carries the reasoning.
 */

function chipNeed(s: Snippet): string {
  if (s.requires) return `needs the ${s.requires}`;
  if (s.needsMachine) return `needs a ${s.needsMachine} beside you`;
  return "";
}

export interface Codebook {
  /** Expand or collapse the full list. The suggestion is visible either way. */
  toggle(): void;
  /**
   * Redraw. Called every frame, so it does nothing when neither the suggestion
   * nor the set of chips the game has raised has changed.
   */
  update(suggestion: Suggestion | null, offered: ReadonlySet<string>): void;
}

export function createCodebook(
  root: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor,
  onRetire: (id: string) => void,
): Codebook {
  root.innerHTML = `
    <h2 class="group-title">codebook</h2>
    <div class="book-suggested"></div>
    <div class="book-known"></div>
    <div class="book-rest" hidden></div>
    <p class="hint book-hint"></p>`;

  const suggestedEl = root.querySelector<HTMLElement>(".book-suggested")!;
  const knownEl = root.querySelector<HTMLElement>(".book-known")!;
  const restEl = root.querySelector<HTMLElement>(".book-rest")!;
  const hintEl = root.querySelector<HTMLElement>(".book-hint")!;

  let open = false;
  /** What the last redraw drew, so a frame that changes nothing touches no DOM. */
  let drawn = "";

  function chipFor(snippet: Snippet, compact: boolean): HTMLButtonElement {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = compact ? "chip chip-compact" : "chip";

    const title = document.createElement("strong");
    title.textContent = snippet.title;
    chip.append(title);

    const need = chipNeed(snippet);
    if (need) {
      const tag = document.createElement("em");
      tag.className = "chip-need";
      tag.textContent = need;
      chip.append(tag);
    }

    if (!compact) {
      const blurb = document.createElement("span");
      blurb.className = "chip-blurb";
      blurb.textContent = snippet.blurb;
      chip.append(blurb);

      const code = document.createElement("pre");
      code.textContent = snippet.code;
      chip.append(code);
    }

    chip.addEventListener("click", () => insertAtCursor(editor, snippet.code));
    return chip;
  }

  function drawSuggestion(suggestion: Suggestion | null): void {
    suggestedEl.replaceChildren();
    if (!suggestion) return;

    const snippet = SNIPPETS.find((s) => s.title === suggestion.chip);
    if (!snippet) return;

    const why = document.createElement("p");
    why.className = "book-why";
    why.textContent = suggestion.why;
    suggestedEl.append(why);

    const chip = chipFor(snippet, false);
    chip.classList.add("chip-suggest");
    // Taken is as final as refused. A chip that comes back after the player has
    // used it is a chip telling them they did it wrong. The chip itself stays in
    // the book below, which is the whole point of the book being one surface.
    chip.addEventListener("click", () => onRetire(suggestion.id));
    suggestedEl.append(chip);

    // Dismissal is one click and it is permanent, which the IDE prior art is
    // unanimous about: a suggestion that cannot be turned off is the one that
    // loses the player's trust in every suggestion after it.
    const no = document.createElement("button");
    no.type = "button";
    no.className = "suggest-dismiss";
    no.textContent = "no thanks — keep it in the book";
    no.addEventListener("click", () => onRetire(suggestion.id));
    suggestedEl.append(no);
  }

  function draw(suggestion: Suggestion | null, offered: ReadonlySet<string>): void {
    drawSuggestion(suggestion);

    // Everything the game has raised, minus the one it is raising right now —
    // which is already above, in full, and does not want to be in two places.
    const known = SNIPPETS.filter((s) => offered.has(s.title) && s.title !== suggestion?.chip);
    knownEl.replaceChildren();
    if (known.length) {
      const label = document.createElement("p");
      label.className = "book-label";
      label.textContent = "offered before";
      knownEl.append(label);
      for (const s of known) knownEl.append(chipFor(s, true));
    }

    restEl.replaceChildren();
    for (const s of SNIPPETS) {
      if (s.title === suggestion?.chip || offered.has(s.title)) continue;
      restEl.append(chipFor(s, false));
    }
    restEl.hidden = !open;
    hintEl.textContent = open
      ? "Click a chip to drop it in at the cursor."
      : `Book: ${SNIPPETS.length} patterns.`;
  }

  return {
    toggle() {
      open = !open;
      restEl.hidden = !open;
      hintEl.textContent = open
        ? "Click a chip to drop it in at the cursor."
        : `Book: ${SNIPPETS.length} patterns.`;
      if (open) root.scrollIntoView({ block: "nearest" });
    },

    update(suggestion, offered) {
      const key = `${suggestion?.id ?? ""}|${[...offered].sort().join(",")}`;
      if (key === drawn) return;
      drawn = key;
      draw(suggestion, offered);
    },
  };
}
