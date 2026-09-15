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
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});
