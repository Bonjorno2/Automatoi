import type { KeyCost } from "./progress-key.ts";

/**
 * Your key: the whole save, as one string to copy out.
 *
 * A textarea rather than the single line it started as, because the key carries
 * the player's scripts now and runs to a few hundred characters. That is fine
 * for the thing it is actually for — pasting into a text file, or a message to
 * somebody — and it stopped being a thing you read down a phone the moment it
 * started carrying code.
 *
 * Read-only on the way out and a separate box on the way in, because issuing and
 * entering are different acts and one field that did both is a field where a
 * half-typed key overwrites the one you were about to copy.
 *
 * **The cost is shown rather than left mysterious.** "487 characters — 21 lines
 * from the book, 6 your own" is the honest explanation of why one player's key
 * is short and another's is long, and it quietly teaches the thing that is true:
 * code built out of the codebook is code the game already knows.
 */

export interface KeyPanel {
  /** Show the key for the progress the player has right now, and what it cost. */
  update(key: string, cost: KeyCost): void;
}

export function createKeyPanel(root: HTMLElement, onEnter: (key: string) => void): KeyPanel {
  root.innerHTML = `
    <h2 class="group-title">your key</h2>
    <textarea class="key-out" readonly spellcheck="false" rows="3"
              aria-label="your progress key"></textarea>
    <p class="hint key-cost"></p>
    <form class="key-in">
      <input class="key-field" spellcheck="false" autocomplete="off"
             placeholder="paste a key" aria-label="enter a progress key" />
      <button type="submit">Use</button>
    </form>
    <p class="key-said" hidden></p>`;

  const out = root.querySelector<HTMLTextAreaElement>(".key-out")!;
  const cost = root.querySelector<HTMLElement>(".key-cost")!;
  const form = root.querySelector<HTMLFormElement>(".key-in")!;
  const field = root.querySelector<HTMLInputElement>(".key-field")!;
  const said = root.querySelector<HTMLElement>(".key-said")!;

  // Click it and it is ready to copy. `select` rather than a copy button: no
  // permission prompt, and it behaves the same in every browser.
  out.addEventListener("focus", () => out.select());
  out.addEventListener("click", () => out.select());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!field.value.trim()) {
      // Nothing happened, so nothing should still be on screen claiming it did:
      // the last key's verdict left up here reads as a reply to the empty one.
      said.hidden = true;
      return;
    }
    onEnter(field.value);
    field.value = "";
  });

  return {
    update(key, breakdown) {
      // Only when it changed, so a player's own selection is never stolen from
      // under them by a frame that had nothing new to say.
      if (out.value === key) return;
      out.value = key;
      const own = breakdown.ownLines;
      cost.textContent =
        `${breakdown.characters} characters — ${breakdown.fromBook} lines from the book, ` +
        `${own} ${own === 1 ? "your own" : "of your own"}`;
    },
  };
}

/** Say how it went, in the side panel rather than in an alert. */
export function sayAboutKey(root: HTMLElement, message: string, ok: boolean): void {
  const said = root.querySelector<HTMLElement>(".key-said");
  if (!said) return;
  said.textContent = message;
  said.hidden = false;
  said.classList.toggle("key-bad", !ok);
}
