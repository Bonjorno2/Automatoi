import {
  apiComplaints,
  apiLib,
  clearRuntimeErrors,
  markRuntimeError,
  mountEditor,
  setApiSurface,
} from "./editor.ts";
import { ownedGates } from "./api-surface.ts";
import { LIBRARY, ScriptStore } from "./script-store.ts";
import { createConsolePanel } from "./console-panel.ts";
import { createCodebook } from "./codebook.ts";
import { createSuggester } from "./suggestions.ts";
import { GameSession } from "./session.ts";
import { connectResize, createOverlay, createStage } from "../render/stage.ts";
import { createTileLayer } from "../render/tiles.ts";
import { createActorLayer } from "../render/actors.ts";
import { createAnimatedLayer } from "../render/animated.ts";
import { createMarkLayer, heldMarks } from "../render/marks.ts";
import { createEffectLayer } from "../render/effects.ts";
import { armedMessage, createInspector, type Placement } from "../render/inspector.ts";
import { CLOCKWISE, COUNTER_CLOCKWISE } from "../sim/world.ts";
import { FACES } from "../sim/config.ts";
import { createHud, createSidePanel } from "../render/hud.ts";
import {
  fitView,
  frameView,
  occupiedRect,
  panBy,
  viewGeometry,
  zoomAbout,
  type View,
} from "../render/camera.ts";
import { keyTarget } from "../render/keys.ts";
import type { Size } from "../render/geometry.ts";
import type { BuildOption } from "./build-menu.ts";
import type { Direction, ModuleName } from "../sim/types.ts";

/**
 * Cross-origin isolation is checked before anything else. Without it
 * `SharedArrayBuffer` is not constructible and the bridge fails deep inside
 * worker startup, where the error says nothing useful.
 */
const isolated = crossOriginIsolated && typeof SharedArrayBuffer === "function";

// Not `status`: that name is already taken by the DOM's global `window.status`.
const statusEl = document.querySelector<HTMLElement>("#status")!;
// Its own element rather than #status: the status line carries messages the
// player asked for ("fitted planter to bot 1"), and overwriting those every
// frame with a mode banner would lose them.
const placingEl = document.querySelector<HTMLElement>("#placing")!;
// Hidden until the research lands, because a buffer nobody can use is a button
// that only raises questions.
const libraryButton = document.querySelector<HTMLButtonElement>("#library")!;
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

/**
 * The camera, which is a view and nothing else.
 *
 * Per Decision 5 of the milestone 7 plan it produces a `Geometry` and every
 * layer already consumes one, so zooming is a resize that happened for a
 * different reason. The inspector's hit-testing follows for free, which is the
 * property the decision exists to buy — and the thing that would break if this
 * were a scaled container.
 *
 * It opens framed on what the player has rather than on the whole grid, which
 * is milestone 7's finding 1: the grid is 32x32, the field is 13x13, and a
 * narrow window opened at 8 pixels per tile where a belt's arrow is 2.4 of
 * them. `Home` still goes to `fitView` — that is "show me everything" and has
 * to keep meaning it.
 *
 * **Decided here, above every layer, rather than below them.** `stage.geometry`
 * is computed with the plain fit when the stage is built and is only recomputed
 * when something resizes, so a camera installed after the layers would leave
 * them drawn at a tile size the camera had already replaced — and the page
 * would open at the old view until the player touched the window.
 */
let view = frameView(occupiedRect(snap), grid, paneSize());
stage.geometryFor = (pane) => viewGeometry(view, grid, pane);
stage.refresh();

const tiles = createTileLayer(stage.staticLayer, stage.tickLayer, stage.geometry, snap);
const actors = createActorLayer(stage.frameLayer, stage.geometry);
const animated = createAnimatedLayer(actors.overlayContainer, stage.geometry);
const marks = createMarkLayer(stage.frameLayer);
const effects = createEffectLayer(stage.frameLayer);
const inspector = createInspector(worldEl, stage.frameLayer, grid, stage.geometry);
const overlay = createOverlay(stage.overlayLayer, {
  width: stage.app.screen.width,
  height: stage.app.screen.height,
});
const hud = createHud(stage.app.stage, { width: stage.app.screen.width, height: stage.app.screen.height });
const sidePanel = createSidePanel(
  document.querySelector<HTMLElement>("#panel")!,
  pick,
  // The design's click-to-script, routed through the inspector's own selection
  // path rather than setting `selectedBotId`: selecting a bot also swaps the
  // editor's contents and focuses its console panel, and a second way in would
  // show one bot's script while the panel highlighted another.
  (botId) => inspector.onSelect(botId),
);

function paneSize(): Size {
  return { width: stage.app.screen.width, height: stage.app.screen.height };
}

function setView(next: View): void {
  view = next;
  stage.refresh();
}

// Three of the layers cache the fit they were built with. Without this the
// terrain redraws at a new tile size and the bots stay at the old one.
connectResize(stage, {
  tiles,
  // Both caches of the fit behind one call, because they are one layer's worth
  // of sprites split across two modules and must never disagree about a tile.
  actors: {
    resize: (g) => {
      actors.resize(g);
      animated.resize(g);
    },
  },
  hud,
  overlay,
  snapshot: () => snap,
  pane: paneSize,
});

/**
 * The camera's controls.
 *
 * Wheel zooms about the cursor, middle-drag or space-drag pans, `Home` goes
 * back to the fit — which is today's view and must stay one keystroke away.
 *
 * Left-drag is deliberately not a pan: it is already how a player places a
 * machine and selects a bot, and stealing it would make every misdrag a
 * cancelled placement.
 */
{
  const rect = (): DOMRect => worldEl.getBoundingClientRect();
  let spaceHeld = false;
  let dragging: { x: number; y: number } | null = null;

  worldEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = rect();
      const steps = -Math.sign(e.deltaY);
      setView(zoomAbout(view, grid, paneSize(), { x: e.clientX - r.left, y: e.clientY - r.top }, steps));
    },
    { passive: false },
  );

  worldEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 1 && !(e.button === 0 && spaceHeld)) return;
    e.preventDefault();
    dragging = { x: e.clientX, y: e.clientY };
    worldEl.setPointerCapture(e.pointerId);
  });
  worldEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    setView(panBy(view, grid, paneSize(), e.clientX - dragging.x, e.clientY - dragging.y));
    dragging = { x: e.clientX, y: e.clientY };
  });
  const endDrag = (): void => {
    dragging = null;
  };
  worldEl.addEventListener("pointerup", endDrag);
  worldEl.addEventListener("pointercancel", endDrag);

  window.addEventListener("keydown", (e) => {
    const where = keyTarget(e.target);
    // Not while typing: Monaco is a different element, and a player writing a
    // script should not send the camera home with the Home key.
    if (where === "typing") return;

    if (e.key === "Home") {
      setView(fitView(grid, paneSize()));
      return;
    }
    if (e.code !== "Space") return;

    // Space is the one key the page and the camera both have a claim on: it is
    // how a browser activates a focused button. The platform wins there, which
    // is what keeps the page usable from the keyboard alone — and is why a
    // pointer click on a control hands focus back, below, so that a player who
    // clicked Run can still hold space and drag.
    if (where !== "world") return;
    spaceHeld = true;
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") spaceHeld = false;
  });
  // A held Space is a modifier, and a modifier that survives losing focus is a
  // cursor stuck in pan mode with no way to notice.
  window.addEventListener("blur", () => {
    spaceHeld = false;
    dragging = null;
  });
}

/**
 * A control clicked with the pointer hands focus back to the page.
 *
 * Milestone 7's finding 2, the half that a guard alone does not fix: after
 * clicking Run, `Space` belongs to the Run button, so holding it to pan presses
 * Run again instead. Blurring makes the camera's keys work the moment the
 * player's hand leaves the button, which is what they expect.
 *
 * Only for a pointer-driven click. `detail` is 0 when a click was synthesised
 * by Enter or Space on a focused control, so a player navigating by keyboard
 * keeps the focus they were relying on.
 */
document.querySelector<HTMLElement>("#side")!.addEventListener("click", (e) => {
  if (e.detail === 0) return;
  const el = e.target as HTMLElement | null;
  // `keyTarget` classifies a `select` as typing, which is what keeps this from
  // closing the speed dropdown the instant it opens.
  if (el && keyTarget(el) === "control") el.blur();
});

/**
 * Picking a build option arms the canvas; it does not place anything.
 *
 * The design calls this a hands phase, and a hands phase means choosing
 * *where*. A menu that dropped a mill the instant you clicked its name would
 * be a coordinate form with nicer buttons.
 *
 * Every placement carries its own `reason` and `apply`, both of which call
 * straight into the sim. The ghost's colour and the click's outcome are
 * therefore the same predicate asked twice, not two rules that must agree.
 */
function pick(option: BuildOption): void {
  const world = session.world;

  if (option.kind === "module") {
    // A module goes on a bot, not on a tile, so there is nothing to aim at.
    fitModule(option.module);
    return;
  }

  inspector.placing = armFor(option);
  sidePanel.setActive(option.label);
}

/**
 * The armed mode an option puts the canvas into.
 *
 * Every branch is the same four answers — what it says, where it is allowed,
 * what the click does, what `R` does — so that the ghost, the banner and the
 * outcome cannot be three different opinions. Remove is a branch here rather
 * than an interaction of its own, per Decision 9 of the milestone 7 plan.
 */
/**
 * The facing the player last chose, kept across re-arming.
 *
 * Milestone 8's finding 1: the ghost started facing north every time, so laying
 * the natural shape — a line rightward — put down six dead ends before anybody
 * thought about `R`. The banner said "facing north" the whole time and was not
 * read, because the thing the hand is doing is drag a line to the right and the
 * thing the screen is saying is a compass bearing.
 *
 * Deliberately *not* inferred from the direction of the second click, which was
 * the other candidate: guessing means the first belt of every line is still
 * wrong, and a wrong guess that corrects itself is worse than a default that
 * stays put.
 */
let lastFacing: Direction = "north";

function armFor(option: Exclude<BuildOption, { kind: "module" }>): Placement {
  const world = session.world;

  if (option.kind === "machine") {
    const placing: Placement = {
      option: option.label,
      label: `Place ${option.label}`,
      mode: "place",
      // Only a kind with a front carries one, so `R` does nothing to a crate
      // rather than silently turning something with no direction.
      facing: FACES[option.machine] ? lastFacing : null,
      reason: (tile) => world.canPlace(option.machine, tile),
      apply: (tile) => void world.placeMachine(option.machine, tile, placing.facing ?? "north"),
      rotate: (turn) => {
        const table = turn === "ccw" ? COUNTER_CLOCKWISE : CLOCKWISE;
        if (!placing.facing) return;
        placing.facing = table[placing.facing];
        lastFacing = placing.facing;
      },
    };
    return placing;
  }

  if (option.kind === "remove") {
    return {
      option: option.label,
      label: "Remove",
      mode: "remove",
      facing: null,
      // The sim's refusals, unedited: "the Research Console cannot be removed"
      // is more use than anything this file could invent. `"hands"` is the
      // caller saying which of the two rule sets it is — the hands may destroy
      // what a machine holds and the builder arm may not, which is what stops a
      // cage of loaded belts from bricking a world.
      reason: (tile) => world.canRemove(tile, "hands"),
      apply: (tile) => {
        const lost = world.removeMachine(tile);
        // Said after the fact as well as before it. The tooltip named the cost
        // while the cursor was over the tile; this is what the player can still
        // read once the tile is bare and the tooltip has moved on.
        const spilled = Object.entries(lost)
          .filter(([, n]) => (n ?? 0) > 0)
          .map(([item, n]) => `${n} ${item}`);
        statusEl.textContent = spilled.length
          ? `removed — ${spilled.join(", ")} destroyed`
          : "removed";
      },
      rotate: () => {},
    };
  }

  return {
    option: option.label,
    label: "Deploy bot",
    mode: "place",
    facing: null,
    reason: (tile) => world.canDeploy(tile),
    // Selecting the new bot is the point: milestone 5 gives it its own script,
    // and the player almost certainly wants to write that next.
    apply: (tile) => {
      selectedBotId = world.deployBot(tile).id;
    },
    rotate: () => {},
  };
}

inspector.onPlace = (tile) => {
  const placing = inspector.placing;
  // Clicking an illegal tile does nothing at all. It does not cancel, because
  // misclicking the edge of a crate should not cost the player their placement.
  if (!placing || placing.reason(tile) !== null) return;
  placing.apply(tile);
  // Stays armed, so a player can lay down three crates without re-picking. The
  // option running out is self-limiting: `reason` starts refusing every tile
  // and the ghost goes red everywhere.
};

function fitModule(module: ModuleName): void {
  if (selectedBotId === null) {
    statusEl.textContent = "select a bot first, then fit the module";
    return;
  }
  try {
    session.world.installModule(selectedBotId, module);
    statusEl.textContent = `fitted ${module} to bot ${selectedBotId}`;
  } catch (e) {
    statusEl.textContent = e instanceof Error ? e.message : String(e);
  }
}

const panel = createConsolePanel(document.querySelector("#log")!, statusEl);
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;

/**
 * What the game has to say about how things are going, and the book it says it
 * out of.
 *
 * Runs are recorded only from `run`, which is the player pressing Run or Ctrl+S.
 * A bot the fabricator started is deliberately not recorded: its source is in no
 * buffer, so a chip offered about it would be inserted into some other bot's
 * script. World events are not filtered that way — a spawned bot pressed against
 * a wall is still the player's problem, and the chip that fixes it goes in the
 * script that spawned it.
 */
const suggester = createSuggester();
const codebook = createCodebook(
  document.querySelector<HTMLElement>("#codebook")!,
  editor,
  (id) => suggester.retire(id),
);

/**
 * Which run each bot's panel belongs to. Restarting settles the outgoing script
 * as "stopped", and that callback lands *after* the new one has started —
 * without this the player would press Ctrl+S and watch their fresh run be
 * labelled stopped by its predecessor.
 *
 * Per bot since milestone 5. A single counter meant starting bot 2's script
 * silently discarded every log bot 1 produced afterwards, because bot 1's
 * callbacks no longer matched the current generation.
 */
const generations = new Map<number, number>();

async function run(): Promise<void> {
  const botId = selectedBotId;
  if (scripts.editingLibrary) {
    // The library is not a script and has nobody to run it. Saving is enough:
    // every bot picks it up the next time its own script starts.
    scripts.stash(editor.getValue());
    statusEl.textContent = "library saved — bots pick it up when they next start";
    return;
  }
  if (botId === null) {
    statusEl.textContent = "select a bot to run its script";
    return;
  }
  const mine = (generations.get(botId) ?? 0) + 1;
  generations.set(botId, mine);
  // Read once. The buffer is editable while the script runs, and the two reads
  // this used to do could disagree about what was stashed and what was started.
  const source = editor.getValue();
  scripts.stash(source);
  panel.start(botId);
  suggester.started(botId, source);
  clearRuntimeErrors(editor);

  await session.runScript(botId, source, {
    onLog: (m) => { if (mine === generations.get(botId)) panel.log(botId, m); },
    onSettle: (outcome) => {
      if (mine !== generations.get(botId)) return;
      panel.settle(botId, outcome);
      // The source that actually ran, not `editor.getValue()` — by the time a
      // long script settles the player may well have typed a loop into the
      // buffer, and suggesting one then would be the game reading a screen it
      // was not looking at.
      suggester.ran(botId, source, outcome.status);
      // Only mark the editor if it is still showing the bot that failed.
      if (outcome.status === "error" && selectedBotId === botId) {
        markRuntimeError(editor, outcome.line, outcome.message ?? "error");
      }
    },
  });
  // A script that never ends never gets here; that is the normal case.
}

document.querySelector("#book-toggle")!.addEventListener("click", () => codebook.toggle());
libraryButton.addEventListener("click", () => editLibrary());

document.querySelector("#run")!.addEventListener("click", () => void run());
document.querySelector("#stop")!.addEventListener("click", () => {
  if (selectedBotId !== null) void session.stopScript(selectedBotId);
});
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
/**
 * Milestone 2 already gave every bot its own worker and its own channel, so
 * running one has never disturbed another. The page was simply hardcoded to
 * bot 1 until there was a second bot to address.
 */
const scripts = new ScriptStore(session.firstBotId);
// Every worker starts with whatever is in the library buffer right now — but
// only once it has been researched, so a beginner's error lines are untouched by
// a feature they have not bought (and cannot yet see).
session.library = () =>
  session.world.research.unlocked.has("library") ? scripts.library() : "";

/**
 * A bot built by a script gets the same console panel a bot started from the
 * editor gets.
 *
 * Milestone 9's playtest: a spawned bot whose script threw on its first line
 * reported nothing anywhere — the parent said it had succeeded, because it had,
 * and the fleet list said "idle", because the sim had no other word for a bot
 * whose script is dead. The error existed and had nowhere to go.
 *
 * No generation check, unlike `run` below: nothing can restart a spawned bot's
 * script, so there is no previous run whose callbacks could arrive late and
 * label this one stopped.
 */
session.onSpawned = (botId) => {
  panel.start(botId);
  return {
    onLog: (m) => panel.log(botId, m),
    onSettle: (outcome) => panel.settle(botId, outcome),
  };
};
let selectedBotId: number | null = session.firstBotId;

inspector.onSelect = (botId) => {
  // Not `botId === selectedBotId` alone: while the library is on screen the
  // selected bot has not changed, and clicking it has to bring its script back.
  if (botId === selectedBotId && !scripts.editingLibrary) return;
  const next = scripts.select(botId, editor.getValue());
  selectedBotId = botId;
  if (next !== null) {
    editor.setValue(next);
    clearRuntimeErrors(editor);
    panel.focus(botId!);
  }
  showLibraryState();
};

/**
 * Point the editor at the shared library.
 *
 * Its own target rather than a pretend bot: it has no position, no inventory and
 * no worker, and `Run` means nothing here. `selectedBotId` is left alone so that
 * going back is a click on the bot the player was already on.
 */
function editLibrary(): void {
  if (scripts.editingLibrary) {
    // A toggle, because the button is the only way back for a player who has no
    // second bot to click on the map.
    const back = scripts.select(selectedBotId, editor.getValue());
    if (back !== null) editor.setValue(back);
  } else {
    editor.setValue(scripts.select(LIBRARY, editor.getValue()) ?? "");
  }
  clearRuntimeErrors(editor);
  showLibraryState();
}

function showLibraryState(): void {
  const on = scripts.editingLibrary;
  libraryButton.classList.toggle("build-active", on);
  libraryButton.textContent = on ? "Close library" : "Library";
  statusEl.textContent = on
    ? "editing the shared library — every bot sees it when its script next starts"
    : statusEl.textContent;
}

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
  const now = performance.now();
  snap = session.world.snapshot();
  // Crops change on a tick and never between ticks.
  if (snap.time !== drawnTick) {
    tiles.update(snap);
    drawnTick = snap.time;
  }
  // Wind, every frame and on the wall clock. Per Decision 4 it does not speed
  // up at 4x, for the same reason a mark's decay does not: a human's eye is
  // the audience and it is not running at 4x either.
  tiles.animate(now);
  // Actors every frame: the whole point of alpha is that they move between ticks.
  actors.update(snap, session.clock.alpha, selectedBotId);
  // The belt tread, which is the one thing in the renderer that truly redraws.
  animated.update(snap, now);
  // Drained every frame, not every tick: an undrained event is a lost signal,
  // and marks decay against the wall clock rather than the sim's.
  //
  // Drained **once**, into both readers. Two calls to `drainEvents` would give
  // the second one an empty list, and whichever layer ran second would silently
  // never see anything.
  const events = session.world.drainEvents();
  marks.update(events, heldMarks(snap), now, stage.geometry);
  effects.update(events, snap, now, stage.geometry);
  // A third reader of the same drain, for the same reason there are two: calling
  // `drainEvents` again would hand this an empty list and the bump nobody
  // counted would be the bump that mattered.
  suggester.saw(events);
  inspector.update(snap, stage.geometry);
  hud.update(snap, {
    paused: session.clock.paused,
    speed: session.clock.speed,
    perf: SHOW_PERF
      ? `pass ${mean(passMs).toFixed(2)}ms  draw ${mean(drawMs).toFixed(2)}ms  frame ${mean(frameMs).toFixed(1)}ms`
      : undefined,
  });
  sidePanel.update(snap, selectedBotId);
  syncApiSurface();
  suggester.world(snap);
  codebook.update({
    // Nothing is *suggested* while the library is on screen: a chip inserted
    // there would be advice about one bot, written into every bot. The book
    // itself stays — it is a book, and the library is where you reach for one.
    suggestion:
      selectedBotId === null || scripts.editingLibrary ? null : suggester.suggest(selectedBotId),
    offered: suggester.offered(),
    vocabulary: suggester.vocabulary(),
    // The chassis whose script is open, matching what autocomplete is offering.
    // The library sees the fleet's union, for the reason `syncApiSurface` gives.
    modules: new Set(
      (scripts.editingLibrary ? snap.bots : snap.bots.filter((b) => b.id === selectedBotId))
        .flatMap((b) => b.modules),
    ),
    machines: new Set(snap.machines.map((m) => m.kind)),
  });
  // The research is the only gate: the button appears when the buffer becomes
  // real, and the prelude stays empty until then.
  libraryButton.hidden = !snap.research.unlocked.includes("library");
  sidePanel.setActive(inspector.placing?.option ?? null);
  // Milestone 5's finding 2: armed and inspecting were two modes with no
  // difference the player could see without hovering a tile and reading the
  // wording of a tooltip. This is on screen whether or not they are hovering,
  // and it is the only place that says Escape is the way out.
  placingEl.textContent = armedMessage(inspector.placing);
  placingEl.hidden = inspector.placing === null;
}

/**
 * Keep autocomplete in step with the hardware the player actually owns.
 *
 * The design says namespaces are the tutorial and that autocomplete on `bot.`
 * lists what you have. It did not: the whole `.d.ts` went in at boot, so a new
 * save offered `bot.builder` and `colony.fabricator` to a chassis carrying a
 * harvester. Fitting a scanner now makes `bot.scanner` appear as you watch.
 *
 * Driven from `draw` rather than from an event, for the same reason every other
 * panel here is: the things it depends on — a module fitted, a research landing,
 * a different bot selected — arrive through three different paths, and a
 * snapshot read every frame cannot miss one. The cost of being wrong is a lying
 * completion list, so this is the one place to prefer polling.
 *
 * Idempotent by the key, and idempotent again inside `setApiSurface`.
 */
let apiKey = "";

function syncApiSurface(): void {
  // The library is every bot's prelude, so it sees the union of the fleet's
  // hardware. Gating it to one chassis would squiggle a helper in the file it is
  // written in while it compiles perfectly in the bot that runs it.
  const chassis = scripts.editingLibrary
    ? snap.bots
    : snap.bots.filter((b) => b.id === selectedBotId);
  const owned = ownedGates(chassis.flatMap((b) => b.modules), snap.research.unlocked);
  const key = [...owned].sort().join(",");
  if (key === apiKey) return;
  apiKey = key;
  setApiSurface(owned);
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
    editor,
    scripts,
    frame,
    // Task 9 asks whether the vignette was doing anything, which needs it off.
    overlay,
    perf: () => ({ pass: mean(passMs), draw: mean(drawMs), frame: mean(frameMs) }),
    // Milestone 10: what the editor thinks this bot can do, and what it objects
    // to. `api().has("scanner")` before and after fitting one is the check.
    api: () => {
      const lib = apiLib();
      return {
        gates: apiKey,
        has: (name: string) => lib.includes(`${name}?: {`),
        complaints: () => apiComplaints(editor),
      };
    },
  });
}

panel.focus(session.firstBotId);
statusEl.textContent = "ready";
