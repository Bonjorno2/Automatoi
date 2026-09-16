import type * as monaco from "monaco-editor";
import { insertAtCursor } from "./insert.ts";
import type { Suggestion } from "./suggestions.ts";

/**
 * The one chip the game is offering, in the side panel above the console.
 *
 * Placed there and not over the editor on purpose. The design forbids tutorial
 * popups, and the IDE prior art says the same thing from the other side: the
 * complaint that gets filed against suggestion UI is always that it covers code
 * somebody was reading. A group in the right column is a thing the player can
 * look at when they choose to and ignore when they do not, which is the whole
 * difference between an offer and an interruption.
 *
 * It is styled as the build menu's offers are rather than as status, for the
 * same reason that menu is: clicking it is the point.
 */

export interface SuggestionPanel {
  /**
   * Show this suggestion, or nothing. Called every frame, so it does no DOM
   * work when the answer has not changed.
   */
  show(suggestion: Suggestion | null): void;
}

export function createSuggestionPanel(
  root: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor,
  onRetire: (id: string) => void,
): SuggestionPanel {
  root.innerHTML = `
    <h2 class="group-title">suggested</h2>
    <div class="suggest-body"></div>`;
  const body = root.querySelector<HTMLElement>(".suggest-body")!;
  let showing: string | null = null;

  return {
    show(suggestion) {
      if ((suggestion?.id ?? null) === showing) return;
      showing = suggestion?.id ?? null;
      root.hidden = suggestion === null;
      body.replaceChildren();
      if (!suggestion) return;

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip chip-suggest";

      const why = document.createElement("span");
      why.className = "chip-blurb";
      why.textContent = suggestion.why;
      chip.append(why);

      const code = document.createElement("pre");
      code.textContent = suggestion.code;
      chip.append(code);

      const take = document.createElement("em");
      take.className = "chip-take";
      take.textContent = "click to drop it in at the cursor";
      chip.append(take);

      chip.addEventListener("click", () => {
        insertAtCursor(editor, suggestion.code);
        // Taken is as final as refused. A chip that comes back after the player
        // has used it is a chip telling them they did it wrong.
        onRetire(suggestion.id);
      });

      // Dismissal is one click and it is permanent, which the IDE prior art is
      // unanimous about: a suggestion that cannot be turned off is the one that
      // loses the player's trust in every suggestion after it.
      const no = document.createElement("button");
      no.type = "button";
      no.className = "suggest-dismiss";
      no.textContent = "no thanks";
      no.addEventListener("click", () => onRetire(suggestion.id));

      body.append(chip, no);
    },
  };
}
