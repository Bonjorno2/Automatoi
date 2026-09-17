/**
 * The two headers GitHub Pages will not send, sent by the page to itself.
 *
 * Every bot's script runs in a worker and blocks on `Atomics.wait` against a
 * `SharedArrayBuffer` — that is the whole reason a player can write
 * `while (true)` and have the game stay responsive. A browser only hands out
 * `SharedArrayBuffer` to a *cross-origin isolated* page, and a page is only
 * isolated if the server sends `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp`. GitHub Pages serves static
 * files and offers no way to set a header on any of them.
 *
 * A service worker sits between the page and the network, so it can add the
 * headers to responses on their way in. The first visit has no worker yet and
 * so is not isolated; registering one and reloading once fixes that, and every
 * visit afterwards is isolated from the first byte. This is the same trick as
 * the widely used `coi-serviceworker`, written out here rather than vendored
 * because it is thirty lines and this is the load-bearing thirty lines of the
 * deployment.
 *
 * The file is loaded twice, in two different worlds: once by the page, which
 * takes the `else` branch and registers it, and once as the worker itself.
 */
if (typeof window === "undefined") {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    // A range request replayed through `fetch` loses its cache entry and the
    // browser errors. Left alone, it is served exactly as it would have been.
    if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;

    event.respondWith(
      fetch(request)
        .then((response) => {
          // An opaque response has no headers to copy and no body to read.
          if (response.status === 0) return response;

          const headers = new Headers(response.headers);
          headers.set("Cross-Origin-Embedder-Policy", "require-corp");
          headers.set("Cross-Origin-Opener-Policy", "same-origin");
          // Everything this page loads is its own, and `require-corp` refuses
          // any resource that does not say it is willing to be embedded.
          headers.set("Cross-Origin-Resource-Policy", "cross-origin");
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        })
        .catch((err) => {
          console.error("coi-serviceworker:", err);
          return new Response("offline", { status: 503, statusText: "offline" });
        }),
    );
  });
} else if (!window.crossOriginIsolated) {
  // Already isolated means a real server sent the headers — the dev server and
  // `vite preview` both do — and installing a worker would only add a reload.
  const src = document.currentScript.src;

  /**
   * Once per tab, and only ever once.
   *
   * A page that reloads itself whenever it is not isolated is a page that
   * reloads forever on any browser where this cannot work — which is exactly
   * the browser whose user can least afford it. The flag is cleared on the
   * load that succeeds, so a later failure still gets its one attempt.
   */
  const ONCE = "coi-reloaded";
  const reloadOnce = () => {
    if (sessionStorage.getItem(ONCE)) return;
    sessionStorage.setItem(ONCE, "1");
    window.location.reload();
  };

  if (!window.isSecureContext) {
    console.error("coi-serviceworker: needs https or localhost; SharedArrayBuffer will be missing");
  } else if (!navigator.serviceWorker) {
    console.error("coi-serviceworker: no service workers here; SharedArrayBuffer will be missing");
  } else {
    // The worker claims its clients as soon as it activates, so this fires on
    // the first visit — the load that installed it, which is not itself behind
    // it and so is not isolated. Reloading is what puts the page behind it.
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnce);
    navigator.serviceWorker.register(src).then(
      (registration) => {
        // Registered from a previous visit but not controlling this load: the
        // claim already happened, so no `controllerchange` is coming.
        if (registration.active && !navigator.serviceWorker.controller) reloadOnce();
      },
      (err) => console.error("coi-serviceworker: registration failed:", err),
    );
  }
} else {
  // Isolated. Whatever happened last time, the next failure gets a fresh try.
  sessionStorage.removeItem("coi-reloaded");
}
