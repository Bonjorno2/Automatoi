import type * as monaco from "monaco-editor";
import { insertAtCursor } from "./insert.ts";
import { SNIPPETS } from "./snippets.ts";
import type { Snippet } from "./snippets.ts";

/**
 * A floating book of code chips, so a player never retypes a pattern they have
 * already learned.
 *
 * Clicking a chip inserts it at the cursor rather than writing the clipboard:
 * insertion needs no permission prompt, behaves the same everywhere, and puts
 * the code where the player is already looking.
 */

function chipLabel(s: Snippet): string {
  if (s.requires) return `needs the ${s.requires}`;
  if (s.needsMachine) return `needs a ${s.needsMachine} beside you`;
  return "";
}

export interface SnippetBook {
  toggle(): void;
  readonly element: HTMLElement;
}

export function createSnippetBook(editor: monaco.editor.IStandaloneCodeEditor): SnippetBook {
  const root = document.createElement("div");
  root.id = "book";
  root.hidden = true;

  const heading = document.createElement("h2");
  heading.textContent = "Snippet book";
  root.append(heading);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Click a chip to drop it in at the cursor.";
  root.append(hint);

  for (const snippet of SNIPPETS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";

    const title = document.createElement("strong");
    title.textContent = snippet.title;
    chip.append(title);

    const need = chipLabel(snippet);
    if (need) {
      const tag = document.createElement("em");
      tag.className = "chip-need";
      tag.textContent = need;
      chip.append(tag);
    }

    const blurb = document.createElement("span");
    blurb.className = "chip-blurb";
    blurb.textContent = snippet.blurb;
    chip.append(blurb);

    const code = document.createElement("pre");
    code.textContent = snippet.code;
    chip.append(code);

    chip.addEventListener("click", () => {
      insertAtCursor(editor, snippet.code);
      root.hidden = true;
    });

    root.append(chip);
  }

  return {
    element: root,
    toggle() {
      root.hidden = !root.hidden;
    },
  };
}
