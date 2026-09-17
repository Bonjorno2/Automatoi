/**
 * `dist`, served the way GitHub Pages serves it: no COOP, no COEP, nothing.
 *
 * `vite preview` sets both headers, which makes it useless for the one thing
 * that needs checking before a static deploy — whether the service worker can
 * put cross-origin isolation back on a host that will never send a header.
 * Run it, open the port, and `crossOriginIsolated` should be true on the
 * second load and every load after.
 *
 *   node scripts/serve-bare.ts [port]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../dist/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PORT = Number(process.argv[2] ?? 4178);

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

createServer(async (req, res) => {
  const path = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  const file = join(ROOT, normalize(path === "/" ? "/index.html" : path));
  try {
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => console.log(`bare static server on http://localhost:${PORT}`));
