import {
  MAX_CHIP_LINES,
  SavedChips,
  lineCount,
  suggestName,
} from "../../src/editor/saved-chips.ts";

/**
 * The player's own chips.
 *
 * The rule under test that is a *design* decision rather than bookkeeping is the
 * twelve-line cap: it is WoW's 255-character macro limit ported to the unit this
 * game shows, and its job is to send a program to the shared library rather than
 * to save storage. So the refusal's wording is asserted, not just its existence.
 */

/** The smallest `localStorage` that behaves like one, since Node has none. */
function stubStorage(): { store: Map<string, string>; restore: () => void } {
  const store = new Map<string, string>();
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return {
    store,
    restore: () => {
      if (before) Object.defineProperty(globalThis, "localStorage", before);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    },
  };
}

describe("chips the player saved", () => {
  it("saves a selection under a name", () => {
    const chips = new SavedChips();
    const result = chips.save("sweep", 'bot.harvester.harvest();\nbot.move("east");');
    expect(result.ok).toBe(true);
    expect(chips.list()).toHaveLength(1);
    expect(chips.list()[0]!.name).toBe("sweep");
  });

  it("refuses a program, and says where one belongs once the library exists", () => {
    const chips = new SavedChips();
    const program = Array.from({ length: MAX_CHIP_LINES + 1 }, (_, i) => `bot.log(${i});`).join("\n");

    const early = chips.save("big", program);
    expect(early.ok).toBe(false);
    expect(early.ok === false && early.reason).toContain("chips stop at");
    // Advice a player cannot take is worse than no advice: no library yet, so
    // the refusal does not mention one.
    expect(early.ok === false && early.reason).not.toContain("library");

    const later = chips.save("big", program, true);
    expect(later.ok === false && later.reason).toContain("shared library");
    expect(chips.list()).toHaveLength(0);
  });

  it("saves a chip of exactly the maximum length", () => {
    const chips = new SavedChips();
    const twelve = Array.from({ length: MAX_CHIP_LINES }, (_, i) => `bot.log(${i});`).join("\n");
    expect(chips.save("just fits", twelve).ok).toBe(true);
  });

  it("refuses an empty selection and an empty name", () => {
    const chips = new SavedChips();
    expect(chips.save("name", "   \n  ").ok).toBe(false);
    expect(chips.save("  ", "bot.move('east');").ok).toBe(false);
    expect(chips.list()).toHaveLength(0);
  });

  it("never reuses an id, so a bar slot cannot be inherited by a later chip", () => {
    // The whole reason a slot may hold a reference: `forget` clears the slots of
    // a deleted chip, and anything that slipped through must not resolve to
    // whatever was saved next.
    const chips = new SavedChips();
    const first = chips.save("one", "bot.wait(1);");
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    chips.remove(first.chip.id);
    const second = chips.save("two", "bot.wait(2);");
    expect(second.ok && second.chip.id).not.toBe(first.chip.id);
  });

  it("renames and deletes, and refuses a blank rename", () => {
    const chips = new SavedChips();
    const saved = chips.save("old", "bot.wait(1);");
    if (!saved.ok) throw new Error("save refused");
    expect(chips.rename(saved.chip.id, " new ")).toBe(true);
    expect(chips.get(saved.chip.id)!.name).toBe("new");
    expect(chips.rename(saved.chip.id, "  ")).toBe(false);
    expect(chips.remove(saved.chip.id)).toBe(true);
    expect(chips.list()).toHaveLength(0);
  });

  it("survives a reload, because losing saved code is what storage is for", () => {
    const storage = stubStorage();
    try {
      const chips = new SavedChips();
      chips.save("keep me", 'bot.planter.plant("wheat");');
      const reopened = new SavedChips();
      expect(reopened.list().map((c) => c.name)).toEqual(["keep me"]);
    } finally {
      storage.restore();
    }
  });

  it("opens on an empty book when storage holds nonsense", () => {
    const storage = stubStorage();
    try {
      globalThis.localStorage.setItem("automatori:chips", "{not json");
      expect(new SavedChips().list()).toEqual([]);
    } finally {
      storage.restore();
    }
  });
});

describe("naming a chip before the player does", () => {
  it("uses the verb the selection calls", () => {
    expect(suggestName('bot.harvester.harvest();\nbot.move("east");')).toBe("harvest");
    expect(suggestName("bot.scanner?.scan(2);")).toBe("scan");
    expect(suggestName("colony.research.queue('planter');")).toBe("queue");
  });

  it("ignores a verb that is only mentioned in a comment", () => {
    expect(suggestName("// bot.harvester.harvest();\nbot.move('east');")).toBe("move");
  });

  it("falls back to the first line, and never to nothing", () => {
    expect(suggestName("while (true) {\n  x++;\n}")).toBe("while (true) {");
    expect(suggestName("")).toBe("chip");
  });
});

describe("lines as the player sees them", () => {
  it("ignores trailing blank lines, which a selection usually has", () => {
    expect(lineCount("a\nb\n\n\n")).toBe(2);
    expect(lineCount("   ")).toBe(0);
  });
});
