import { clearRuntimeErrors, markRuntimeError, mountEditor } from "./editor.ts";
import { createConsolePanel } from "./console-panel.ts";
import { createSnippetBook } from "./snippet-book.ts";
import { GameSession } from "./session.ts";
import { createStage } from "../render/stage.ts";
import { createTileLayer } from "../render/tiles.ts";
import { createActorLayer } from "../render/actors.ts";
import { createMarkLayer, heldMarks } from "../render/marks.ts";
import { createInspector } from "../render/inspector.ts";
import { createHud, createSidePanel } from "../render/hud.ts";

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

const grid = { width: session.world.width, height: session.world.height };
const worldEl = document.querySelector<HTMLElement>("#world")!;
const stage = await createStage(worldEl, grid);

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
const marks = createMarkLayer(stage.frameLayer);
const inspector = createInspector(worldEl, stage.frameLayer, grid, stage.geometry);
const hud = createHud(stage.app.stage, { width: stage.app.screen.width, height: stage.app.screen.height });
const sidePanel = createSidePanel(document.querySelector<HTMLElement>("#panel")!);
stage.onResize = (g) => {
  tiles.resize(g, snap);
  actors.resize(g);
  hud.resize(g, { width: worldEl.clientWidth, height: worldEl.clientHeight });
};

const panel = createConsolePanel(document.querySelector("#log")!, statusEl);
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

/**
 * Clicking a bot selects it; clicking empty space clears the selection.
 *
 * With one bot this changes almost nothing visible, which is exactly why it is
 * built now rather than in milestone 5 — where a second bot, a per-bot script
 * pane and a module-install target would all want it at once.
 */
let selectedBotId: number | null = session.botId;
inspector.onSelect = (botId) => {
  selectedBotId = botId;
};

/**
 * Rolling means over two seconds of frames, shown only with `?perf`.
 *
 * Kept behind a flag rather than removed after Task 8: the numbers that answer
 * "where does the sim run" go stale the moment the sim grows, and milestone 5
 * grows it by a whole production chain.
 */
const SHOW_PERF = new URLSearchParams(location.search).has("perf");
const PERF_WINDOW = 120;
const passMs: number[] = [];
const drawMs: number[] = [];
const frameMs: number[] = [];
let lastFrameAt = 0;

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function record(into: number[], value: number): void {
  into.push(value);
  if (into.length > PERF_WINDOW) into.shift();
}

let drawnTick = -1;

/**
 * One frame: advance the world, then draw it.
 *
 * Exported onto `globalThis` in dev because the preview pane this is developed
 * against delivers no `requestAnimationFrame` callbacks, so the only way to
 * measure a frame is to run one on purpose.
 */
function frame(): void {
  const t0 = performance.now();
  if (lastFrameAt) record(frameMs, t0 - lastFrameAt);
  lastFrameAt = t0;

  session.pass();
  const t1 = performance.now();
  draw();
  const t2 = performance.now();

  record(passMs, t1 - t0);
  record(drawMs, t2 - t1);
}

function draw(): void {
  snap = session.world.snapshot();
  // Crops change on a tick and never between ticks.
  if (snap.time !== drawnTick) {
    tiles.update(snap);
    drawnTick = snap.time;
  }
  // Actors every frame: the whole point of alpha is that they move between ticks.
  actors.update(snap, session.clock.alpha, selectedBotId);
  // Drained every frame, not every tick: an undrained event is a lost signal,
  // and marks decay against the wall clock rather than the sim's.
  marks.update(session.world.drainEvents(), heldMarks(snap), performance.now(), stage.geometry);
  inspector.update(snap, stage.geometry);
  hud.update(snap, {
    paused: session.clock.paused,
    speed: session.clock.speed,
    perf: SHOW_PERF
      ? `pass ${mean(passMs).toFixed(2)}ms  draw ${mean(drawMs).toFixed(2)}ms  frame ${mean(frameMs).toFixed(1)}ms`
      : undefined,
  });
  sidePanel.update(snap, selectedBotId);
}

function loop(): void {
  frame();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Every manual check in the milestone 4 plan is performed from the page's own
// console, and several of them measure things no UI exposes.
if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    session,
    stage,
    frame,
    perf: () => ({ pass: mean(passMs), draw: mean(drawMs), frame: mean(frameMs) }),
  });
}

statusEl.textContent = "ready";
