import { mountEditor } from "./editor.ts";
import { GameSession } from "./session.ts";

/**
 * Cross-origin isolation is checked before anything else. Without it
 * `SharedArrayBuffer` is not constructible and the bridge fails deep inside
 * worker startup, where the error says nothing useful.
 */
const isolated = crossOriginIsolated && typeof SharedArrayBuffer === "function";

// Not `status`: that name is already taken by the DOM's global `window.status`.
const statusEl = document.querySelector("#status")!;
if (!isolated) {
  statusEl.textContent = "NOT ISOLATED — SharedArrayBuffer unavailable";
  throw new Error("cross-origin isolation required");
}

const editor = mountEditor(document.querySelector<HTMLElement>("#editor")!);
const session = new GameSession();
session.start();

const logEl = document.querySelector("#log")!;
const readoutEl = document.querySelector("#readout")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause")!;

function append(text: string, colour?: string): void {
  const li = document.createElement("li");
  li.textContent = text;
  if (colour) li.style.color = colour;
  logEl.append(li);
  logEl.scrollTop = logEl.scrollHeight;
}

/**
 * Which run the panel belongs to. Restarting settles the outgoing script as
 * "stopped", and that callback lands *after* the new one has started — without
 * this the player would press Ctrl+S and watch their fresh run be labelled
 * stopped by its predecessor.
 */
let generation = 0;

async function run(): Promise<void> {
  const mine = ++generation;
  logEl.replaceChildren();
  statusEl.textContent = "running";
  await session.runScript(editor.getValue(), {
    onLog: (m) => { if (mine === generation) append(m); },
    onSettle: (o) => {
      if (mine !== generation) return;
      statusEl.textContent = o.message ? `${o.status}: ${o.message}` : o.status;
      if (o.status === "error" || o.status === "hung") append(o.message ?? o.status, "#f48771");
    },
  });
  // A script that never ends never gets here; that is the normal case.
}

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
  const wheat = v.inventory.wheat ?? 0;
  readoutEl.textContent =
    `tick    ${v.time}\n` +
    `pos     ${v.pos.x}, ${v.pos.y}\n` +
    `wheat   ${wheat}\n` +
    `state   ${v.paused ? "paused" : v.busy ? "busy" : "idle"}  ${v.speed}x`;
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

statusEl.textContent = "ready";
