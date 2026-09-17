import { insertAtCursor, replaceAll } from "../../src/editor/insert.ts";

/**
 * What clicking a chip does to the buffer.
 *
 * The regression this file exists for, found by the first real playtest:
 * a suggested chip was being *inserted* at the cursor, so a player who took the
 * fix the game offered ended up with their broken loop still first, the cure
 * unreachable below it, and dead lines under that. They went from "stuck — 24
 * commands got nowhere" to "stuck — 328", and taking the suggestion retired it,
 * so the game had nothing left to say. Asking for help made things worse and
 * then went quiet.
 *
 * Monaco cannot be loaded under Vitest, so this drives the smallest editor that
 * satisfies what these two functions actually use. That is enough: the bug was
 * never in Monaco, it was in which range the edit was applied to.
 */
function fakeEditor(initial: string, cursorLine = 1) {
  let text = initial;
  const edits: { owner: string; range: unknown }[] = [];
  return {
    text: () => text,
    edits,
    focused: false,
    position: { lineNumber: cursorLine, column: 1 },
    getModel() {
      return {
        getFullModelRange: () => ({ whole: true }),
      };
    },
    getSelection() {
      return { at: this.position.lineNumber };
    },
    executeEdits(owner: string, [edit]: { range: unknown; text: string }[]) {
      edits.push({ owner, range: edit!.range });
      if ((edit!.range as { whole?: boolean }).whole) {
        text = edit!.text;
        return;
      }
      // Insert at the start of the cursor's line, as Monaco does for an empty
      // selection: the detail that put the cure below the broken loop.
      const lines = text.split("\n");
      lines.splice(this.position.lineNumber - 1, 0, edit!.text.replace(/\n$/, ""));
      text = lines.join("\n");
    },
    setPosition(p: { lineNumber: number; column: number }) {
      this.position = p;
    },
    focus() {
      this.focused = true;
    },
  };
}

const BROKEN = 'while (true) {\n  bot.harvester.harvest();\n  bot.move("east");\n}';
const CURE = 'let goingEast = true;\nwhile (true) {\n  if (!bot.move(goingEast ? "east" : "west")) {\n    goingEast = !goingEast;\n  }\n}';

describe("taking a chip from the book", () => {
  it("drops it in at the cursor and leaves the rest alone", () => {
    const ed = fakeEditor("a\nb", 2);
    insertAtCursor(ed as never, "X");
    expect(ed.text()).toBe("a\nX\nb");
  });

  it("focuses the editor, so the player can keep typing", () => {
    const ed = fakeEditor("a");
    insertAtCursor(ed as never, "X");
    expect(ed.focused).toBe(true);
  });
});

describe("taking the chip the game suggested", () => {
  it("becomes the whole script", () => {
    const ed = fakeEditor(BROKEN, 1);
    replaceAll(ed as never, CURE);
    expect(ed.text().trim()).toBe(CURE);
  });

  it("leaves nothing of the broken script behind, wherever the cursor was", () => {
    // The actual failure. The cursor sat on line 5 after the previous chip, and
    // inserting there put the cure *under* a `while (true)` that never exits.
    for (const line of [1, 3, 5]) {
      const ed = fakeEditor(BROKEN, line);
      replaceAll(ed as never, CURE);
      expect(ed.text()).not.toContain('bot.move("east");\n}');
      expect(ed.text().split("while (true)").length - 1).toBe(1);
    }
  });

  it("is one undoable edit, which is what makes replacing safe", () => {
    // The chip promises Ctrl+Z puts your script back. That promise is only good
    // if this is a single edit over the whole range.
    const ed = fakeEditor(BROKEN);
    replaceAll(ed as never, CURE);
    expect(ed.edits).toHaveLength(1);
    expect(ed.edits[0]!.range).toEqual({ whole: true });
  });

  it("puts the caret at the top of what it just wrote", () => {
    const ed = fakeEditor(BROKEN, 4);
    replaceAll(ed as never, CURE);
    expect(ed.position).toEqual({ lineNumber: 1, column: 1 });
  });
});
