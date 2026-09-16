/**
 * Your key: the one thing in this game worth writing on a piece of paper.
 *
 * Read-only on the way out, because a key is issued rather than edited, and a
 * separate box on the way in, because the two are different acts and a single
 * field that does both is a field where a half-typed key overwrites the one you
 * were about to copy.
 *
 * Clicking the key selects all of it, which is the zero-permission way to hand
 * somebody a string. The snippet book settled the same question the same way in
 * milestone 7: the clipboard needs asking, selection does not.
 */

export interface KeyPanel {
  /** Show the key for the progress the player has right now. */
  update(key: string): void;
}

export function createKeyPanel(
  root: HTMLElement,
  onEnter: (key: string) => void,
): KeyPanel {
  root.innerHTML = `
    <h2 class="group-title">your key</h2>
    <input class="key-out" readonly spellcheck="false" aria-label="your progress key" />
    <p class="hint key-hint">Write this down. It remembers what you have learned.</p>
    <form class="key-in">
      <input class="key-field" spellcheck="false" autocomplete="off"
             placeholder="type a key" aria-label="enter a progress key" />
      <button type="submit">Use</button>
    </form>
    <p class="key-said" hidden></p>`;

  const out = root.querySelector<HTMLInputElement>(".key-out")!;
  const form = root.querySelector<HTMLFormElement>(".key-in")!;
  const field = root.querySelector<HTMLInputElement>(".key-field")!;
  const said = root.querySelector<HTMLElement>(".key-said")!;

  // Click anywhere on it and it is ready to copy. `select` rather than a copy
  // button: no permission prompt, and it works the same in every browser.
  out.addEventListener("focus", () => out.select());
  out.addEventListener("click", () => out.select());

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = field.value;
    if (!typed.trim()) {
      // Nothing happened, so nothing should still be on screen claiming it did:
      // the last key's verdict left up here reads as a reply to the empty one.
      said.hidden = true;
      return;
    }
    onEnter(typed);
    field.value = "";
  });

  return {
    update(key) {
      // Only when it changed, so the player's own selection is never stolen
      // from under them by a frame that had nothing new to say.
      if (out.value !== key) out.value = key;
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
