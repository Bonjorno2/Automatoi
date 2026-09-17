import { defineConfig } from "vite";

/**
 * `Atomics.wait` and `SharedArrayBuffer` are only available to a cross-origin
 * isolated page. Both the dev server and `vite preview` need these headers:
 * setting only the first produces a build that works in dev and dies in
 * preview, which is a miserable thing to debug later.
 */
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  /**
   * Relative, so the same `dist` works wherever it is unpacked.
   *
   * A GitHub Pages project site lives under `/<repo>/`, and an absolute base
   * would bake the repository's name into every asset URL — rename the repo,
   * or open `dist/index.html` from disk, and the page loads nothing. There is
   * one page and no router here, so relative costs nothing.
   */
  base: "./",
  build: {
    /**
     * `main.ts` awaits `createStage` at the top level, which esbuild's default
     * target (chrome87 and friends) cannot express. Every browser that can run
     * this game at all has `SharedArrayBuffer` and top-level await; es2022 is
     * simply the truth about what the bridge already requires.
     */
    target: "es2022",
    rollupOptions: {
      output: {
        /**
         * Everything from `node_modules` in one chunk, which is what keeps the
         * built page from deadlocking on its own first frame.
         *
         * Pixi asks for its renderer with `await import(...)` inside
         * `app.init()`. Rollup gives that import its own chunk, and by default
         * that chunk takes the shared Pixi code it needs from whichever chunk
         * already holds it — the *entry*, which is `main.ts`, which at that
         * moment is suspended on `await createStage`. A module with an
         * unsettled top-level await has not finished evaluating, so the
         * renderer chunk waits for the entry, the entry waits for `app.init`,
         * and `app.init` waits for the renderer chunk. The page fetches every
         * asset, logs no error, and sits on "starting…" forever.
         *
         * Only the built page can hit it. The dev server hands over unbundled
         * modules, so Pixi's import resolves against Pixi instead of against
         * us, which is why this survived ten milestones: nobody had ever run
         * `npm run build` and opened the result.
         *
         * Putting the libraries in their own chunk takes our entry out of the
         * path entirely — the renderer chunk now imports from `vendor`, which
         * has no top-level await and nothing to wait for. Inlining every
         * dynamic import instead does remove the deadlock, and replaces it with
         * `Cannot access '...' before initialization`: those imports are how
         * Pixi breaks its own initialisation cycles, and collapsing them fuses
         * the cycle back together.
         */
        manualChunks: (id) => (id.includes("node_modules") ? "vendor" : undefined),
      },
    },
  },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
