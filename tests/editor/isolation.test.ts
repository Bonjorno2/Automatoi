import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("cross-origin isolation", () => {
  it("the dev server sends both isolation headers", async () => {
    const server = await createServer({ root, server: { port: 0 } });
    try {
      await server.listen();
      const url = server.resolvedUrls?.local[0];
      expect(url).toBeTruthy();

      const res = await fetch(url!);
      expect(res.headers.get("cross-origin-opener-policy")).toBe("same-origin");
      expect(res.headers.get("cross-origin-embedder-policy")).toBe("require-corp");
    } finally {
      await server.close();
    }
  }, 30_000);
});
