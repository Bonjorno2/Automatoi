import type { ScriptOutcome, ScriptStatus } from "../bridge/colony.ts";

/**
 * One bot's console panel: its `bot.log` output and the verdict its script
 * reached.
 *
 * The design's failure table asks for a spark on an error and a spinner on a
 * hang. Those are world-side signals and belong to the renderer; until there is
 * one, a coloured badge carries the same information.
 */

const BADGE: Record<ScriptStatus | "running", { text: string; colour: string }> = {
  running: { text: "running", colour: "#9cdcfe" },
  done: { text: "done", colour: "#6a9955" },
  error: { text: "error", colour: "#f48771" },
  hung: { text: "hung", colour: "#dcdcaa" },
  stopped: { text: "stopped", colour: "#888888" },
};

export interface ConsolePanel {
  /** Begin a new run: clears output and shows the running badge. */
  start(): void;
  log(message: string): void;
  settle(outcome: ScriptOutcome): void;
}

export function createConsolePanel(logEl: Element, statusEl: HTMLElement): ConsolePanel {
  const append = (text: string, colour?: string): void => {
    const li = document.createElement("li");
    li.textContent = text;
    if (colour) li.style.color = colour;
    logEl.append(li);
    logEl.scrollTop = logEl.scrollHeight;
  };

  const badge = (status: ScriptStatus | "running", detail?: string): void => {
    const { text, colour } = BADGE[status];
    statusEl.textContent = detail ? `${text}: ${detail}` : text;
    statusEl.style.color = colour;
  };

  return {
    start() {
      logEl.replaceChildren();
      badge("running");
    },

    log(message) {
      append(message);
    },

    settle(outcome) {
      const { status, message, line } = outcome;
      badge(status, message);
      if (status === "error") {
        // The design's rule: only code errors get editor help, and they name
        // the line the player wrote rather than the one the engine saw.
        const where = line === undefined ? "" : ` (line ${line})`;
        append(`${message ?? "error"}${where}`, BADGE.error.colour);
      } else if (status === "hung") {
        append(message ?? "hung", BADGE.hung.colour);
      }
    },
  };
}
