/**
 * Milestone 3, Task 1: prove the page is cross-origin isolated before any
 * bridge code is loaded into it. Without isolation `SharedArrayBuffer` is not
 * constructible, and the failure surfaces as a confusing error deep inside
 * worker startup rather than here, where it is legible.
 */
const isolated = crossOriginIsolated && typeof SharedArrayBuffer === "function";

// Not `status`: that name is already taken by the DOM's global `window.status`.
const statusEl = document.querySelector("#status");
if (statusEl) {
  statusEl.textContent = isolated
    ? "cross-origin isolated"
    : "NOT ISOLATED — SharedArrayBuffer unavailable";
}
