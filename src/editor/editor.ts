import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import playerApi from "./generated/player-api.d.ts?raw";
import { composeApi, parseApiSurface } from "./api-surface.ts";
import { OPENING_SCRIPT } from "./opening-script.ts";

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

// Re-exported so existing importers of editor.ts keep working; the constant
// itself lives apart from Monaco so it can be read without a bundler.
export { OPENING_SCRIPT } from "./opening-script.ts";

/** Markers we own, kept apart from the language service's own diagnostics. */
const OWNER = "automatori";

/** The one URI the API is loaded under. Re-adding it replaces it, in place. */
const API_LIB = "ts:player-api.d.ts";

const surface = parseApiSurface(playerApi);

/**
 * Show the player exactly the API they have earned.
 *
 * Called every time the selection or the world changes, which is why it is
 * cheap by construction: `addExtraLib` under an existing URI replaces that lib
 * and bumps its version, and returns without doing anything at all when the
 * text is unchanged. So an unchanged surface costs one string compare and never
 * disturbs the TypeScript worker.
 */
export function setApiSurface(owned: ReadonlySet<string>): void {
  monaco.languages.typescript.javascriptDefaults.addExtraLib(composeApi(surface, owned), API_LIB);
}

/**
 * What the editor currently believes the API is, and what it is complaining
 * about. Both exist for the same reason `perf()` does: the questions this
 * milestone has to answer — "does `bot.scanner` exist before it is fitted" —
 * are asked of the TypeScript worker, and nothing on the page shows its answer.
 */
export function apiLib(): string {
  return monaco.languages.typescript.javascriptDefaults.getExtraLibs()[API_LIB]?.content ?? "";
}

export function apiComplaints(editor: monaco.editor.IStandaloneCodeEditor): string[] {
  const model = editor.getModel();
  if (!model) return [];
  return monaco.editor
    .getModelMarkers({ resource: model.uri })
    .filter((m) => m.owner !== OWNER)
    .map((m) => `${m.startLineNumber}: ${m.message}`);
}

/**
 * Put a marker on the line a running script threw from, or clear ours when
 * `line` is undefined. Never touches the TypeScript worker's markers.
 */
export function markRuntimeError(
  editor: monaco.editor.IStandaloneCodeEditor,
  line: number | undefined,
  message: string,
): void {
  const model = editor.getModel();
  if (!model) return;
  if (line === undefined || line < 1 || line > model.getLineCount()) {
    monaco.editor.setModelMarkers(model, OWNER, []);
    return;
  }
  monaco.editor.setModelMarkers(model, OWNER, [{
    severity: monaco.MarkerSeverity.Error,
    message,
    startLineNumber: line,
    endLineNumber: line,
    startColumn: 1,
    endColumn: model.getLineMaxColumn(line),
  }]);
}

export function clearRuntimeErrors(editor: monaco.editor.IStandaloneCodeEditor): void {
  const model = editor.getModel();
  if (model) monaco.editor.setModelMarkers(model, OWNER, []);
}

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

  // Opened on the core alone. The page calls `setApiSurface` with the selected
  // bot's hardware before the first frame draws, and a surface that started
  // complete would flash every locked namespace into the completion list first.
  setApiSurface(new Set());

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
