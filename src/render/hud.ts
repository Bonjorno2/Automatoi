import { Container, Graphics, Text } from "pixi.js";
import { BOT_CAPACITY, RESEARCH_COST } from "../sim/config.ts";
import { total } from "../sim/inventory.ts";
import type { BotSnapshot, WorldSnapshot } from "../sim/types.ts";
import type { Geometry, Size } from "./geometry.ts";

/**
 * What the milestone 3 text readout used to say, moved to where it belongs.
 *
 * Its four lines are accounted for individually: `tick` and speed come here,
 * `pos` is gone because the bot is visible on the grid and the inspector names
 * it exactly, `wheat` becomes a capacity bar, and `state` is carried by the
 * bot's own brightness and by marks.
 */

/** One line per queued research, in queue order. */
export function researchLines(snapshot: WorldSnapshot): string[] {
  return snapshot.research.queue.map((name, i) => {
    const cost = RESEARCH_COST[name];
    // Only the head of the queue is being worked on; the rest are waiting, and
    // showing them all at 0/n would imply otherwise.
    const progress = i === 0 ? snapshot.research.progress : 0;
    return `${name} ${progress}/${cost}`;
  });
}

/**
 * What research has produced and nobody has installed.
 *
 * Milestone 4's finding 1: progress was visible and completion was not, so a
 * spare planter module could exist that no part of the screen ever mentioned.
 * A player who looked away for two seconds had no way to discover they owned
 * it. In Task 7 these lines become the thing you click to install.
 */
export function stockLines(snapshot: WorldSnapshot): string[] {
  const lines: string[] = [];
  for (const [module, n] of Object.entries(snapshot.research.spareModules)) {
    if ((n ?? 0) > 0) lines.push(n === 1 ? `${module} module` : `${module} module x${n}`);
  }
  const chassis = snapshot.research.spareChassis;
  if (chassis > 0) lines.push(chassis === 1 ? "spare chassis" : `spare chassis x${chassis}`);
  return lines;
}

/**
 * How full a bot is, in [0, 1].
 *
 * A number the player never saw before. The snippet book has a "Don't overfill"
 * chip and BOT_CAPACITY is 10, so a bar that visibly fills is what makes that
 * chip mean something.
 */
export function cargoFraction(bot: BotSnapshot | undefined): number {
  if (!bot) return 0;
  return Math.min(1, total(bot.inventory) / BOT_CAPACITY);
}

export interface Hud {
  update(snapshot: WorldSnapshot, state: { paused: boolean; speed: number; perf?: string }): void;
  resize(geometry: Geometry, pane: Size): void;
}

const LABEL_STYLE = {
  fill: 0xd9d9c8,
  fontFamily: "ui-monospace, Menlo, monospace",
  fontSize: 12,
} as const;

export function createHud(parent: Container, pane: Size): Hud {
  const layer = new Container();
  parent.addChild(layer);

  const veil = new Graphics();
  const clock = new Text({ text: "", style: LABEL_STYLE });
  const paused = new Text({ text: "PAUSED", style: { ...LABEL_STYLE, fill: 0xf0d878 } });
  const perf = new Text({ text: "", style: { ...LABEL_STYLE, fontSize: 11, fill: 0x8fbf6f } });
  clock.position.set(10, 8);
  paused.position.set(10, 24);
  perf.position.set(10, 40);
  layer.addChild(veil, clock, paused, perf);

  let size: Size = pane;

  function drawVeil(on: boolean): void {
    veil.clear();
    if (!on) return;
    // A flat veil rather than a desaturating filter. A filter over the whole
    // stage costs a full-screen pass every frame, and Task 8 is about to
    // measure the frame budget — this is not the milestone to spend it on an
    // effect whose entire job is to say "not running".
    veil.rect(0, 0, size.width, size.height).fill({ color: 0x0a0c08, alpha: 0.35 });
  }

  return {
    update(snapshot, state) {
      clock.text = `tick ${snapshot.time}   ${state.speed}x`;
      paused.visible = state.paused;
      perf.text = state.perf ?? "";
      perf.visible = Boolean(state.perf);
      drawVeil(state.paused);
    },
    resize(_geometry, nextPane) {
      size = nextPane;
      drawVeil(paused.visible);
    },
  };
}

function fillList(root: HTMLElement, lines: string[], empty: string | null): void {
  root.textContent = "";
  if (lines.length === 0) {
    if (empty === null) return;
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = empty;
    root.append(li);
    return;
  }
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    root.append(li);
  }
}

/** The DOM half: the side panel's cargo bar, research queue and stock. */
export interface SidePanel {
  update(snapshot: WorldSnapshot, selectedBotId: number | null): void;
}

export function createSidePanel(root: HTMLElement): SidePanel {
  root.innerHTML = `
    <div class="cargo">
      <span class="cargo-label">cargo</span>
      <span class="bar"><i></i></span>
      <span class="cargo-count"></span>
    </div>
    <ul class="research"></ul>
    <ul class="stock"></ul>`;

  const fill = root.querySelector<HTMLElement>(".bar i")!;
  const count = root.querySelector<HTMLElement>(".cargo-count")!;
  const label = root.querySelector<HTMLElement>(".cargo-label")!;
  const research = root.querySelector<HTMLElement>(".research")!;
  const stock = root.querySelector<HTMLElement>(".stock")!;

  return {
    update(snapshot, selectedBotId) {
      const bot = snapshot.bots.find((b) => b.id === selectedBotId);
      const carried = bot ? total(bot.inventory) : 0;
      label.textContent = bot ? `bot ${bot.id}` : "no bot";
      fill.style.width = `${cargoFraction(bot) * 100}%`;
      fill.classList.toggle("full", carried >= BOT_CAPACITY);
      count.textContent = `${carried}/${BOT_CAPACITY}`;

      fillList(research, researchLines(snapshot), "nothing researching");
      // No placeholder: an empty stock list is the normal state and a line
      // saying so would compete with the one thing here worth noticing.
      fillList(stock, stockLines(snapshot), null);
    },
  };
}
