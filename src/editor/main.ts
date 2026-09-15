import { clearRuntimeErrors, markRuntimeError, mountEditor } from "./editor.ts";
import { createConsolePanel } from "./console-panel.ts";
import { createSnippetBook } from "./snippet-book.ts";
import { GameSession } from "./session.ts";
import { createStage } from "../render/stage.ts";
import { createTileLayer } from "../render/tiles.ts";
import { createActorLayer } from "../render/actors.ts";

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

/**
 * A fresh snapshot every frame, which Fact 2 of the milestone 4 plan measured
 * at 0.0079 ms on a 1024-tile world — 19x under the threshold that would have
 * forced a per-tick scheme. The renderer therefore reads a plain JSON copy and
 * has no reference to a live entity anywhere, which is the property the design
 * asks for and the cheapest version of it.
 */
let snap = session.world.snapshot();
const tiles = createTileLayer(stage.staticLayer, stage.tickLayer, stage.geometry, snap);
const actors = createActorLayer(stage.frameLayer, stage.geometry);
stage.onResize = (g) => {
  tiles.resize(g, snap);
  actors.resize(g);
};

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

// Task 6 gives this a way to change. Until then the one bot is always selected,
// which is the honest answer when there is only one.
const selectedBotId: number | null = session.botId;

// The world readout dies in Task 7, once the HUD carries what it says.
let drawnTick = -1;
function draw(): void {
  snap = session.world.snapshot();
  // Crops change on a tick and never between ticks.
  if (snap.time !== drawnTick) {
    tiles.update(snap);
    drawnTick = snap.time;
  }
  // Actors every frame: the whole point of alpha is that they move between ticks.
  actors.update(snap, session.clock.alpha, selectedBotId);

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
