import type { ScriptOutcome, ScriptStatus } from "../bridge/colony.ts";

/**
 * One console per bot: its `bot.log` output and the verdict its script reached.
 *
 * Milestone 3 called this a per-bot panel and built it against a world with one
 * bot, so "per bot" cost nothing and meant nothing. Milestone 5 deploys a
 * second, and a single shared stream would have two scripts writing into one
 * list with no way to tell which said what — and, worse, a fresh run clearing
 * the other bot's history.
 *
 * Each bot therefore keeps its own buffer; the panel shows whichever bot the
 * player has selected. Logs from an unwatched bot are kept, not dropped, so
 * selecting it shows what it has been doing rather than an empty list.
 */

const BADGE: Record<ScriptStatus | "running" | "idle", { text: string; colour: string }> = {
  idle: { text: "ready", colour: "#888888" },
  running: { text: "running", colour: "#9cdcfe" },
  done: { text: "done", colour: "#6a9955" },
  error: { text: "error", colour: "#f48771" },
  hung: { text: "hung", colour: "#dcdcaa" },
  stopped: { text: "stopped", colour: "#888888" },
};

/** How many lines one bot keeps. A `while (true)` loop that logs is unbounded. */
const MAX_LINES = 500;

interface Line {
  text: string;
  colour?: string;
}

interface BotConsole {
  lines: Line[];
  status: ScriptStatus | "running" | "idle";
  detail?: string;
}

export interface ConsolePanel {
  /** Begin a new run for one bot: clears that bot's output only. */
  start(botId: number): void;
  log(botId: number, message: string): void;
  settle(botId: number, outcome: ScriptOutcome): void;
  /** Show this bot's console. Called when the selection changes. */
  focus(botId: number): void;
}

export function createConsolePanel(logEl: Element, statusEl: HTMLElement): ConsolePanel {
  const consoles = new Map<number, BotConsole>();
  let shown: number | null = null;

  const consoleFor = (botId: number): BotConsole => {
    let c = consoles.get(botId);
    if (!c) {
      c = { lines: [], status: "idle" };
      consoles.set(botId, c);
    }
    return c;
  };

  function render(botId: number): void {
    const c = consoleFor(botId);
    logEl.replaceChildren();
    for (const line of c.lines) {
      const li = document.createElement("li");
      li.textContent = line.text;
      if (line.colour) li.style.color = line.colour;
      logEl.append(li);
    }
    logEl.scrollTop = logEl.scrollHeight;

    const { text, colour } = BADGE[c.status];
    statusEl.textContent = c.detail ? `${text}: ${c.detail}` : text;
    statusEl.style.color = colour;
  }

  function push(botId: number, line: Line): void {
    const c = consoleFor(botId);
    c.lines.push(line);
    if (c.lines.length > MAX_LINES) c.lines.shift();
    // Only touch the DOM for the bot on screen. An off-screen bot logging in a
    // tight loop should cost nothing but memory.
    if (shown !== botId) return;
    const li = document.createElement("li");
    li.textContent = line.text;
    if (line.colour) li.style.color = line.colour;
    logEl.append(li);
    while (logEl.childElementCount > MAX_LINES) logEl.firstElementChild?.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  return {
    start(botId) {
      const c = consoleFor(botId);
      c.lines = [];
      c.status = "running";
      c.detail = undefined;
      if (shown === botId) render(botId);
    },

    log(botId, message) {
      push(botId, { text: message });
    },

    settle(botId, outcome) {
      const { status, message, line } = outcome;
      const c = consoleFor(botId);
      c.status = status;
      c.detail = message;
      if (status === "error") {
        // The design's rule: only code errors get editor help, and they name
        // the line the player wrote rather than the one the engine saw.
        const where = line === undefined ? "" : ` (line ${line})`;
        push(botId, { text: `${message ?? "error"}${where}`, colour: BADGE.error.colour });
      } else if (status === "hung") {
        push(botId, { text: message ?? "hung", colour: BADGE.hung.colour });
      }
      if (shown === botId) render(botId);
    },

    focus(botId) {
      shown = botId;
      render(botId);
    },
  };
}
