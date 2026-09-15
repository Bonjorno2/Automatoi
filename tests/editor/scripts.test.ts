import { ScriptStore } from "../../src/editor/script-store";
import { OPENING_SCRIPT } from "../../src/editor/opening-script";
import { World } from "../../src/sim/world";

describe("one script per bot", () => {
  it("starts the first bot on the opening script", () => {
    expect(new ScriptStore(1).sourceFor(1)).toBe(OPENING_SCRIPT);
  });

  it("gives a newly deployed bot the opening script, not an empty buffer", () => {
    // An empty editor is a worse prompt than two lines that do something.
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const second = w.deployBot({ x: 20, y: 20 });
    expect(new ScriptStore(1).sourceFor(second.id)).toBe(OPENING_SCRIPT);
  });

  it("keeps each bot's edits when the selection moves away and back", () => {
    // The rule this whole module exists for: losing a player's work silently is
    // the worst bug an editor can have.
    const store = new ScriptStore(1);
    const botOne = "while (true) bot.harvester.harvest();";
    const botTwo = 'while (true) bot.move("west");';

    expect(store.select(4, botOne)).toBe(OPENING_SCRIPT);
    expect(store.select(1, botTwo)).toBe(botOne);
    expect(store.sourceFor(4)).toBe(botTwo);
  });

  it("does not lose the current buffer when the selection is cleared", () => {
    const store = new ScriptStore(1);
    expect(store.select(null, "bot.wait(5);")).toBeNull();
    expect(store.selectedBotId).toBeNull();
    expect(store.sourceFor(1)).toBe("bot.wait(5);");
  });

  it("stashes without switching, which is what Run does before it starts", () => {
    const store = new ScriptStore(1);
    store.stash("edited in place");
    expect(store.sourceFor(1)).toBe("edited in place");
    expect(store.selectedBotId).toBe(1);
  });

  it("tracks which bot is selected", () => {
    const store = new ScriptStore(1);
    expect(store.selectedBotId).toBe(1);
    store.select(4, "");
    expect(store.selectedBotId).toBe(4);
  });
});
