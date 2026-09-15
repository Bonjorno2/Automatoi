import { clearRuntimeErrors, markRuntimeError, mountEditor } from "./editor.ts";
import { createConsolePanel } from "./console-panel.ts";
import { createSnippetBook } from "./snippet-book.ts";
import { GameSession } from "./session.ts";
import { createStage, drawPlaceholder } from "../render/stage.ts";

/**
 * Cross-origin isolation is checked before anything else. Without it
 * `SharedArrayBuffer` is not constructible and the bridge fails deep inside
 * worker startup, where the error says nothing useful.
 */
const isolated = crossOriginIsolated && typeof SharedArrayBuffer === "function";

// Not `status`: that name is already taken by the DOM's global `window.status`.
const statusEl = document.querySelector<HTMLElement>("#status")!;
if (!isolated) {
  statusEl.textContent = "NOT ISOLATED — SharedArrayBuffer unavailable";
  throw new Error("cross-origin isolation required");
}

const editor = mountEditor(document.querySelector<HTMLElement>("#editor")!);
const session = new GameSession();
session.start();

const grid = { width: session.world.width, height: session.world.height };
const stage = await createStage(document.querySelector<HTMLElement>("#world")!, grid);
drawPlaceholder(stage, grid);
stage.onResize = () => drawPlaceholder(stage, grid);

const panel = createConsolePanel(document.querySelector("#log")!, statusEl);
const readoutEl = document.querySelector("#readout")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;

/**
 * Which run the panel belongs to. Restarting settles the outgoing script as
 * "stopped", and that callback lands *after* the new one has started — without
 * this the player would press Ctrl+S and watch their fresh run be labelled
 * stopped by its predecessor.
 */
let generation = 0;

async function run(): Promise<void> {
  const mine = ++generation;
  panel.start();
  clearRuntimeErrors(editor);

  await session.runScript(editor.getValue(), {
    onLog: (m) => { if (mine === generation) panel.log(m); },
    onSettle: (outcome) => {
      if (mine !== generation) return;
      panel.settle(outcome);
      if (outcome.status === "error") {
        markRuntimeError(editor, outcome.line, outcome.message ?? "error");
      }
    },
  });
  // A script that never ends never gets here; that is the normal case.
}

const book = createSnippetBook(editor);
document.body.append(book.element);
document.querySelector("#book-toggle")!.addEventListener("click", () => book.toggle());

document.querySelector("#run")!.addEventListener("click", () => void run());
document.querySelector("#stop")!.addEventListener("click", () => void session.stopScript());
document.querySelector("#step")!.addEventListener("click", () => session.clock.step());

pauseButton.addEventListener("click", () => {
  session.clock.paused = !session.clock.paused;
  pauseButton.textContent = session.clock.paused ? "Resume" : "Pause";
});

document.querySelector<HTMLSelectElement>("#speed")!.addEventListener("change", (e) => {
  session.clock.speed = Number((e.target as HTMLSelectElement).value);
});

// Hot reload: restart only this bot's script, leaving the world running.
window.addEventListener("keydown", (e) => {
  if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    void run();
  }
});

// The world readout stands in for the renderer milestone 4 brings.
function draw(): void {
  const v = session.view();
  readoutEl.textContent =
    `tick    ${v.time}\n` +
    `pos     ${v.pos.x}, ${v.pos.y}\n` +
    `wheat   ${v.inventory.wheat ?? 0}\n` +
    `state   ${v.paused ? "paused" : v.busy ? "busy" : "idle"}  ${v.speed}x`;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// Every manual check in the milestone 4 plan is performed from the page's own
// console, and several of them measure things no UI exposes.
if (import.meta.env.DEV) Object.assign(globalThis, { session, stage });

statusEl.textContent = "ready";
