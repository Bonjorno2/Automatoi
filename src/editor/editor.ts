import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import playerApi from "./generated/player-api.d.ts?raw";

/**
 * Monaco, configured for player scripts.
 *
 * The language is JavaScript, not TypeScript: the design is explicit that
 * players write real JavaScript and that research never gates the language.
 * The generated `.d.ts` still drives autocomplete, hover docs and — with
 * `checkJs` — real diagnostics, so `bot.move("up")` is squiggled in the editor
 * rather than discovered at runtime.
 */

// Monaco's language services run in their own workers. Vite gives us each as a
// constructor via `?worker`, which keeps them same-origin and so loadable under
// the cross-origin isolation the bridge needs.
self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    return label === "typescript" || label === "javascript" ? new tsWorker() : new editorWorker();
  },
};

/** What a new player sees, exactly as the design doc's "first ten minutes" promises. */
export const OPENING_SCRIPT = `bot.harvester.harvest();
bot.move("east");
`;

export function mountEditor(container: HTMLElement, initial = OPENING_SCRIPT): monaco.editor.IStandaloneCodeEditor {
  const js = monaco.languages.typescript.javascriptDefaults;

  js.setCompilerOptions({
    // Monaco's bundled TypeScript does not expose ES2022 on this enum; ESNext
    // is the closest and lets it choose the matching lib for itself.
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    checkJs: true,
    // A beginner writing `let x = 0` should not be lectured about implicit any.
    noImplicitAny: false,
  });

  // Monaco defaults JavaScript to `noSemanticValidation: true`, so `checkJs`
  // on its own is silent — verified by reading getDiagnosticsOptions() in a
  // live page. Without this the editor autocompletes against the API but never
  // objects to `bot.move("up")`, which is half the value of shipping types.
  js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });

  js.addExtraLib(playerApi, "ts:player-api.d.ts");

  return monaco.editor.create(container, {
    value: initial,
    language: "javascript",
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    scrollBeyondLastLine: false,
    tabSize: 2,
  });
}
