import type * as monaco from "monaco-editor";

/**
 * Drop code in at the cursor and leave the caret after it, focused.
 *
 * Insertion rather than the clipboard, which milestone 7 settled for the snippet
 * book and holds here for the same three reasons: it needs no permission prompt,
 * it behaves the same in every browser, and it puts the code where the player is
 * already looking rather than somewhere they then have to paste it.
 *
 * Its own module since milestone 10, because the suggestion panel offers chips
 * too. Two copies of this would be two answers to "where does the caret end up".
 */
export function insertAtCursor(
  editor: monaco.editor.IStandaloneCodeEditor,
  code: string,
): void {
  const selection = editor.getSelection();
  if (!selection) return;
  editor.executeEdits("insert", [{
    range: selection,
    text: `${code}\n`,
    forceMoveMarkers: true,
  }]);
  editor.focus();
}

/**
 * Put this in at the cursor with no newline — for something mid-line.
 *
 * A tile's address is not a statement. It lands inside whatever the player was
 * already typing, which is the difference between picking a coordinate off the
 * map and being handed a line you then have to unwrap.
 */
export function insertInline(
  editor: monaco.editor.IStandaloneCodeEditor,
  text: string,
): void {
  const selection = editor.getSelection();
  if (!selection) return;
  editor.executeEdits("pick", [{ range: selection, text, forceMoveMarkers: true }]);
  editor.focus();
}

/**
 * Put this in place of the whole script.
 *
 * **What the first real playtest found, and it was severe.** A suggested chip is
 * a complete program — "Stay on the field" is not a fragment, it is what the
 * script should now be. Inserting it at the cursor left the player with their
 * broken loop still first, the cure sitting unreachable below it, and two dead
 * lines under that. They took the fix, pressed Run, and went from *"stuck — 24
 * commands got nowhere"* to *"stuck — 328"*. Taking a suggestion also retires
 * it, so the game had nothing left to say. **Asking for help made things worse
 * and then went quiet**, which is the worst outcome this system can produce.
 *
 * So a *suggestion* replaces and a chip the player went looking for in the book
 * still inserts. The two are different sentences: one answers "your script is
 * wrong", the other offers a pattern to put somewhere.
 *
 * Safe because it is one edit through `executeEdits`, so Ctrl+Z gives the
 * player's script back. The chip says so.
 */
export function replaceAll(
  editor: monaco.editor.IStandaloneCodeEditor,
  code: string,
): void {
  const model = editor.getModel();
  if (!model) return;
  editor.executeEdits("suggestion", [{
    range: model.getFullModelRange(),
    text: `${code}\n`,
    forceMoveMarkers: true,
  }]);
  editor.setPosition({ lineNumber: 1, column: 1 });
  editor.focus();
}
