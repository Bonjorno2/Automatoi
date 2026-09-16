import { SNIPPETS } from "../../src/editor/snippets.ts";
import { OPENING_SCRIPT } from "../../src/editor/opening-script.ts";
import {
  SUGGESTED_CHIPS,
  createSuggester,
  hasLoop,
} from "../../src/editor/suggestions.ts";

/**
 * When the game speaks, and when it keeps quiet.
 *
 * The second half matters more than the first. A suggestion that fires too
 * eagerly is the tutorial popup the design rules out, wearing a different hat.
 */
describe("suggestions", () => {
  it("points every rule at a chip the book actually has", () => {
    const titles = SNIPPETS.map((s) => s.title);
    for (const chip of SUGGESTED_CHIPS) expect(titles).toContain(chip);
  });

  describe("wrap it in a loop", () => {
    it("says nothing before a single run", () => {
      expect(createSuggester().suggest(1)).toBeNull();
    });

    it("says nothing after one run that ended", () => {
      // The design *wants* the first script to run out. That is the moment the
      // player is meant to feel, and talking over it is the whole failure mode.
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("offers the loop after the second", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      const suggestion = s.suggest(1);
      expect(suggestion?.id).toBe("wrap-it-in-a-loop");
      expect(suggestion?.chip).toBe("Harvest in a loop");
      expect(suggestion?.code).toContain("while (true)");
    });

    it("says nothing to a script that already loops", () => {
      const s = createSuggester();
      const looping = "while (true) { bot.harvester.harvest(); }";
      s.ran(1, looping, "done");
      s.ran(1, looping, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("says nothing about a run that errored or was stopped", () => {
      // An error has the editor's own line marker and the console panel. A stop
      // is the player deciding, and the game answering a decision with advice
      // is the thing that makes a hint system feel like nagging.
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "error");
      s.ran(1, OPENING_SCRIPT, "error");
      expect(s.suggest(1)).toBeNull();

      const t = createSuggester();
      t.ran(1, OPENING_SCRIPT, "stopped");
      t.ran(1, OPENING_SCRIPT, "stopped");
      expect(t.suggest(1)).toBeNull();
    });

    it("needs the two runs to be consecutive", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, "while (true) { bot.move('east'); }", "stopped");
      expect(s.suggest(1)).toBeNull();
    });

    it("counts each bot separately", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(2, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
      expect(s.suggest(2)).toBeNull();
    });

    it("stays retired once refused", () => {
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).not.toBeNull();

      s.retire("wrap-it-in-a-loop");
      expect(s.suggest(1)).toBeNull();
      // And it does not come back on the next run that would have raised it.
      s.ran(1, OPENING_SCRIPT, "done");
      expect(s.suggest(1)).toBeNull();
    });

    it("retires for every bot, not just the one that refused it", () => {
      // "No thanks" is a statement about the advice, not about bot 1.
      const s = createSuggester();
      s.ran(1, OPENING_SCRIPT, "done");
      s.ran(1, OPENING_SCRIPT, "done");
      s.retire("wrap-it-in-a-loop");
      s.ran(2, OPENING_SCRIPT, "done");
      s.ran(2, OPENING_SCRIPT, "done");
      expect(s.suggest(2)).toBeNull();
    });
  });

  describe("hasLoop", () => {
    it("sees the loops a player writes", () => {
      expect(hasLoop("while (true) {}")).toBe(true);
      expect(hasLoop("for (let i = 0; i < 5; i++) {}")).toBe(true);
      expect(hasLoop("for (const t of bot.scanner.scan(2)) {}")).toBe(true);
      expect(hasLoop("do { bot.move('east'); } while (true);")).toBe(true);
    });

    it("is not fooled by prose", () => {
      // The reason this function is a scanner and not a regex over the source.
      expect(hasLoop("bot.move('east'); // go east for one tile")).toBe(false);
      expect(hasLoop("/* harvest while there is wheat */\nbot.harvester.harvest();")).toBe(false);
      expect(hasLoop('bot.log("waiting for the mill");')).toBe(false);
      expect(hasLoop("bot.log('do not overfill');")).toBe(false);
    });

    it("is not fooled by a comment marker inside a string, or the reverse", () => {
      expect(hasLoop('bot.log("// for");')).toBe(false);
      expect(hasLoop("// a quote ' and then\nwhile (true) {}")).toBe(true);
    });

    it("does not mistake a longer word for a loop", () => {
      expect(hasLoop("const format = 1; const doing = 2; const forward = 3;")).toBe(false);
    });

    it("says the opening script does not loop", () => {
      // The fact the whole rule rests on.
      expect(hasLoop(OPENING_SCRIPT)).toBe(false);
    });
  });
});
