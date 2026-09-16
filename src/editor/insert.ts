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
