import type * as monaco from "monaco-editor";
import { insertAtCursor } from "./insert.ts";
import { resolveRef, SLOT_COUNT, type ChipBar } from "./chip-bar.ts";
import type { SavedChip } from "./saved-chips.ts";
import { classOf } from "./source.ts";
import { CLASS_COLOR, cssColor } from "../render/palette.ts";

/**
 * The bar: nine numbered slots under the editor, each holding a chip you put
 * there.
 *
 * **Under the editor rather than in the side panel**, which is the one place it
 * could have gone instead. The side panel is where the game talks to the player
 * — fleet, field, research, book — and this is a tool the player points at their
 * own text. It is also the narrow column, and nine slots across 22rem is a row
 * of squares with no room for a name, which is the failure mode the whole
 * project has been avoiding: a chip that shows an icon instead of its code is a
 * chip you have to remember rather than read.
 *
 * A slot inserts at the cursor. It never replaces the script, and the
 * distinction is milestone 10's, learnt the hard way: replacing is what a
 * *suggestion* does, because a suggestion is the game answering "your script is
 * wrong". Nothing the player pinned themselves is that.
 */

export interface BarPanel {
  /** Redraw against what the stores say now. Cheap when nothing has changed. */
  update(): void;
  /** Insert whatever is in a slot, as the keyboard does. Ignores an empty one. */
  fire(index: number): void;
}

/**
 * Both stores are read live rather than handed in per frame, for the reason
 * `BookStores` gives in `codebook.ts`: pinning a chip redraws this panel
 * immediately, and a list captured at the last frame would not have it.
 */
export function createBarPanel(
  root: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor,
  bar: ChipBar,
  chips: { list(): readonly SavedChip[] },
): BarPanel {
  let drawn = "";

  function fire(index: number): void {
    const ref = bar.slots()[index];
    if (!ref) return;
    const chip = resolveRef(ref, chips.list());
    if (!chip) return;
    insertAtCursor(editor, chip.code);
  }

  function draw(): void {
    root.replaceChildren();

    const saved = chips.list();
    bar.slots().forEach((ref, i) => {
      const chip = ref ? resolveRef(ref, saved) : null;

      const slot = document.createElement("button");
      slot.type = "button";
      slot.className = chip ? "slot" : "slot slot-empty";
      slot.disabled = !chip;

      const key = document.createElement("kbd");
      key.textContent = String(i + 1);
      slot.append(key);

      const name = document.createElement("span");
      name.className = "slot-name";
      // An empty slot says what it is for rather than sitting there blank: nine
      // unexplained squares are nine questions.
      name.textContent = chip ? chip.name : "empty";
      slot.append(name);

      if (chip) {
        const cls = classOf(chip.code);
        slot.style.borderLeftColor = cssColor(CLASS_COLOR[cls]);
        slot.title = `Alt+${i + 1} — inserts at the cursor\n\n${chip.code}`;
        slot.addEventListener("click", () => fire(i));
        // Right-click unpins, which is the same gesture Factorio's quickbar
        // uses for the same act. The browser menu would otherwise cover the bar.
        slot.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          bar.clear(i);
          draw();
        });
      } else {
        slot.title = "pin a chip from the codebook to fill this slot";
      }

      root.append(slot);
    });
  }

  return {
    update() {
      // The slots' *contents* can change without the bar changing, because a
      // slot holds a reference: renaming a chip has to redraw the slot showing
      // it. So the key covers what is resolved, not what is stored.
      const saved = chips.list();
      const key = bar
        .slots()
        .map((ref) => {
          const chip = ref ? resolveRef(ref, saved) : null;
          return chip ? `${chip.name}:${chip.code.length}` : "";
        })
        .join("|");
      if (key === drawn) return;
      drawn = key;
      draw();
    },
    fire,
  };
}

/** The nine slots, for a caller wiring keys to them. */
export const BAR_SLOTS = SLOT_COUNT;
