import { mountEditor } from "./editor.ts";

/**
 * Cross-origin isolation is checked before anything else. Without it
 * `SharedArrayBuffer` is not constructible and the bridge fails deep inside
 * worker startup, where the error says nothing useful.
 */
const isolated = crossOriginIsolated && typeof SharedArrayBuffer === "function";

// Not `status`: that name is already taken by the DOM's global `window.status`.
const statusEl = document.querySelector("#status");
if (statusEl) {
  statusEl.textContent = isolated
    ? "cross-origin isolated"
    : "NOT ISOLATED — SharedArrayBuffer unavailable";
}

const container = document.querySelector<HTMLElement>("#editor");
if (container) mountEditor(container);
