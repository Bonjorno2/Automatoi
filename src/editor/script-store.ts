import { OPENING_SCRIPT } from "./opening-script.ts";

/**
 * One source string per bot, and which bot the editor is pointed at.
 *
 * A module rather than three lines in `main.ts` because the interesting part is
 * a rule, not a Map: **the buffer on screen belongs to the selected bot until
 * the selection moves, at which point it must be written back before the new
 * one is read.** Getting that wrong loses a player's work silently, which is
 * the worst kind of bug an editor can have, so it is worth a test that drives
 * the real thing rather than a restatement of it.
 */
export class ScriptStore {
  private readonly sources = new Map<number, string>();
  private selected: number | null;

  constructor(firstBotId: number) {
    this.selected = firstBotId;
    this.sources.set(firstBotId, OPENING_SCRIPT);
  }

  get selectedBotId(): number | null {
    return this.selected;
  }

  /**
   * A bot with no script yet opens on the opening script rather than an empty
   * buffer. An empty editor is a worse prompt than two lines that do something.
   */
  sourceFor(botId: number): string {
    return this.sources.get(botId) ?? OPENING_SCRIPT;
  }

  /** Write the on-screen text back to whichever bot currently owns it. */
  stash(currentText: string): void {
    if (this.selected !== null) this.sources.set(this.selected, currentText);
  }

  /**
   * Point the editor at another bot.
   *
   * @param currentText what is on screen right now, stashed before the switch
   * @returns the text to show, or null when nothing is selected
   */
  select(botId: number | null, currentText: string): string | null {
    this.stash(currentText);
    this.selected = botId;
    return botId === null ? null : this.sourceFor(botId);
  }
}
