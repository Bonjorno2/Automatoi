import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { composeApi, ownedGates, parseApiSurface } from "../../src/editor/api-surface.ts";

/**
 * What the player is allowed to autocomplete.
 *
 * Read against the committed `.d.ts` rather than a fixture: the thing being
 * tested is that the real file splits the way the editor assumes it does, and a
 * fixture would keep passing after the generator stopped emitting gates at all.
 */
const root = fileURLToPath(new URL("../..", import.meta.url));
const dts = readFileSync(join(root, "src/editor/generated/player-api.d.ts"), "utf8");
const surface = parseApiSurface(dts);

describe("the API surface", () => {
  it("gates every module and the fabricator", () => {
    expect([...surface.gates.keys()]).toEqual([
      "module:harvester",
      "module:planter",
      "module:scanner",
      "module:radio",
      "module:builder",
      "research:fabricator",
    ]);
  });

  it("keeps the always-present verbs out of every gate", () => {
    // These are the design's "machine verbs live on `bot` directly" rule, which
    // is settled and must not drift into being gated on owning a crate.
    for (const verb of ["move(", "wait(", "pos(", "inventory(", "log(", "deposit(", "withdraw("]) {
      expect(surface.base).toContain(verb);
    }
    expect(surface.base).toContain("interface ColonyApi");
    expect(surface.base).toContain("bots(");
    expect(surface.base).toContain("status(): ResearchStatus");
  });

  it("hides hardware nobody owns", () => {
    const bare = composeApi(surface, new Set());
    expect(bare).not.toContain("scanner?:");
    expect(bare).not.toContain("builder?:");
    expect(bare).not.toContain("fabricator?:");
    // And with it, the hover text — there is no point hiding a namespace while
    // leaving the paragraph that explains it in the file.
    expect(bare).not.toContain("Radius 6 is the largest that fits");
  });

  it("shows what a chassis carries, and nothing else", () => {
    const opening = composeApi(surface, ownedGates(["harvester"], []));
    expect(opening).toContain("harvester?:");
    expect(opening).not.toContain("planter?:");

    const fitted = composeApi(surface, ownedGates(["harvester", "scanner"], []));
    expect(fitted).toContain("scanner?:");
    expect(fitted).toContain("harvester?:");
    expect(fitted).not.toContain("radio?:");
  });

  it("follows the colony's research for colony verbs", () => {
    // A fabricator is owned by the colony, not bolted to a chassis, so no list
    // of modules can ever unlock it.
    expect(composeApi(surface, ownedGates(["builder"], []))).not.toContain("fabricator?:");
    expect(composeApi(surface, ownedGates([], ["fabricator"]))).toContain("fabricator?:");
  });

  it("ignores owned things that gate nothing", () => {
    // `colony.bots()` needs no research and the crate gates no namespace, so a
    // full research list must compose to the same text as the gates it meets.
    const everything = ownedGates([], ["crate", "mill", "oven", "library", "fabricator"]);
    expect(composeApi(surface, everything)).toBe(
      composeApi(surface, ownedGates([], ["fabricator"])),
    );
  });

  it("is stable, so an unchanged surface is the same string", () => {
    // What makes it safe to call every frame: Monaco's addExtraLib compares
    // content and does nothing when it matches, so composing must not depend on
    // the order the gates were owned in.
    const a = composeApi(surface, ownedGates(["scanner", "harvester"], ["fabricator"]));
    const b = composeApi(surface, ownedGates(["harvester", "scanner"], ["fabricator"]));
    expect(a).toBe(b);
  });

  it("composes back to the committed file when everything is owned", () => {
    const all = composeApi(surface, new Set(surface.gates.keys()));
    // Same declarations, in the same order — only the marker comments are gone.
    const strip = (s: string): string =>
      s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n").replace(/\n+/g, "\n").trim();
    expect(strip(all)).toBe(strip(dts));
  });

  describe("parsing", () => {
    it("refuses a gate that is never closed", () => {
      expect(() => parseApiSurface("//#gate module:x\ninterface A {}")).toThrow("never closed");
    });

    it("refuses an endgate with nothing open", () => {
      expect(() => parseApiSurface("//#endgate")).toThrow("no //#gate");
    });

    it("refuses two blocks on one gate", () => {
      const twice = "//#gate module:x\na\n//#endgate\n//#gate module:x\nb\n//#endgate";
      expect(() => parseApiSurface(twice)).toThrow("two blocks");
    });
  });
});
