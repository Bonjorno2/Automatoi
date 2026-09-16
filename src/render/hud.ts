import { Container, Graphics, Text } from "pixi.js";
import { BOT_CAPACITY, CROP_GROWTH, RESEARCH_COST } from "../sim/config.ts";
import { total } from "../sim/inventory.ts";
import type { BotSnapshot, Item, ResearchName, WorldSnapshot } from "../sim/types.ts";
import { buildOptions, type BuildOption } from "../editor/build-menu.ts";
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
  return researchRows(snapshot).map((row) => `${row.name} ${row.progress}/${row.cost}`);
}

/** One queued research, with enough to draw a bar rather than a sentence. */
export interface ResearchRow {
  name: ResearchName;
  progress: number;
  cost: number;
  /** Only the head of the queue is being worked on. */
  active: boolean;
}

/**
 * The queue as numbers rather than as text.
 *
 * Milestone 7's Task 8 wanted the research panel to read as progress instead of
 * as a list, and a bar needs the fraction rather than the sentence. The text
 * version above is derived from this one so the two can never disagree about
 * what is being worked on.
 */
export function researchRows(snapshot: WorldSnapshot): ResearchRow[] {
  return snapshot.research.queue.map((name, i) => ({
    name,
    cost: RESEARCH_COST[name],
    // Showing every entry at its own progress would imply the whole queue is
    // being worked at once.
    progress: i === 0 ? snapshot.research.progress : 0,
    active: i === 0,
  }));
}

/**
 * What is standing in the field, per plantable item: ripe now, and coming.
 *
 * Milestone 5's finding 3. The wild field holds 119 wheat, the chain eats it at
 * roughly ten per bread, and it empties at about tick 5015 — one hauling round
 * after the chassis research completes, which is exactly when a new player is
 * most pleased with themselves. This milestone makes that arrive sooner, because
 * belts spend the field faster than a bot walking can.
 *
 * **This is a read-out and not a fix.** The fix is the planter and a script that
 * replants, and the design is right that running out is what teaches it. What is
 * being removed is the surprise, not the cliff.
 *
 * One line per plantable item rather than one line per item present, so the
 * count reads "none ready" instead of disappearing. A field that has run out
 * looks exactly like a field somebody else already harvested, and a read-out
 * that went silent at zero would go silent at the only moment it is needed.
 */
export function fieldLines(snapshot: WorldSnapshot): string[] {
  const ready = new Map<Item, number>();
  const growing = new Map<Item, number>();
  for (const tile of snapshot.tiles) {
    const crop = tile.crop;
    // A crop of something unplantable cannot be grown or harvested, so counting
    // it would be counting scenery.
    const ripe = crop ? CROP_GROWTH[crop.item] : undefined;
    if (!crop || ripe === undefined) continue;
    const bucket = crop.growth >= ripe ? ready : growing;
    bucket.set(crop.item, (bucket.get(crop.item) ?? 0) + 1);
  }

  return (Object.keys(CROP_GROWTH) as Item[]).map((item) => {
    const n = ready.get(item) ?? 0;
    const coming = growing.get(item) ?? 0;
    const head = `${item} — ${n > 0 ? `${n} ready` : "none ready"}`;
    return coming > 0 ? `${head}, ${coming} growing` : head;
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

/** The DOM half: the side panel's cargo bar, research queue and build menu. */
export interface SidePanel {
  update(snapshot: WorldSnapshot, selectedBotId: number | null): void;
  /** Highlight the option currently being placed, or none. */
  setActive(label: string | null): void;
}

export function createSidePanel(root: HTMLElement, onPick: (option: BuildOption) => void): SidePanel {
  let activeLabel: string | null = null;
  // Headings, added by milestone 7's Task 8. Nothing here is a control and
  // nothing moved: the four groups were always in this order and were simply
  // unlabelled, which made the panel one undifferentiated column of small text.
  root.innerHTML = `
    <section class="group">
      <h2 class="group-title">bot</h2>
      <div class="cargo">
        <span class="cargo-label">cargo</span>
        <span class="bar"><i></i></span>
        <span class="cargo-count"></span>
      </div>
    </section>
    <section class="group">
      <h2 class="group-title">field</h2>
      <ul class="field"></ul>
    </section>
    <section class="group">
      <h2 class="group-title">research</h2>
      <ul class="research"></ul>
    </section>
    <section class="group">
      <h2 class="group-title">build</h2>
      <ul class="build"></ul>
    </section>`;

  const fill = root.querySelector<HTMLElement>(".bar i")!;
  const count = root.querySelector<HTMLElement>(".cargo-count")!;
  const label = root.querySelector<HTMLElement>(".cargo-label")!;
  const field = root.querySelector<HTMLElement>(".field")!;
  const research = root.querySelector<HTMLElement>(".research")!;
  const build = root.querySelector<HTMLElement>(".build")!;

  return {
    update(snapshot, selectedBotId) {
      const bot = snapshot.bots.find((b) => b.id === selectedBotId);
      const carried = bot ? total(bot.inventory) : 0;
      label.textContent = bot ? `bot ${bot.id}` : "no bot";
      fill.style.width = `${cargoFraction(bot) * 100}%`;
      fill.classList.toggle("full", carried >= BOT_CAPACITY);
      count.textContent = `${carried}/${BOT_CAPACITY}`;

      fillList(field, fieldLines(snapshot), null);
      renderResearch(research, researchRows(snapshot));
      renderBuild(build, snapshot, onPick, activeLabel);
    },
    setActive(label) {
      activeLabel = label;
    },
  };
}

/**
 * The research queue as bars.
 *
 * The same numbers `researchLines` states in words, which is what a player
 * mostly wants from this panel: not "planter 3/6" read as a sentence, but how
 * far along it is, seen at a glance. The words stay inside the bar so nothing
 * is lost when the fraction is small enough to be a sliver.
 *
 * Rebuilt only when it changed, for the same reason the build menu is: the
 * panel is redrawn every frame, and replacing DOM sixty times a second under a
 * player's pointer is how a click gets eaten.
 */
function renderResearch(root: HTMLElement, rows: ResearchRow[]): void {
  const key = rows.map((r) => `${r.name}:${r.progress}/${r.cost}`).join("|");
  if (root.dataset.key === key) return;
  root.dataset.key = key;

  root.textContent = "";
  if (rows.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "nothing researching";
    root.append(li);
    return;
  }

  for (const row of rows) {
    const li = document.createElement("li");
    li.className = row.active ? "research-row active" : "research-row";
    const bar = document.createElement("span");
    bar.className = "research-bar";
    const fill = document.createElement("i");
    fill.style.width = `${Math.min(1, row.cost > 0 ? row.progress / row.cost : 0) * 100}%`;
    const text = document.createElement("span");
    text.className = "research-text";
    text.textContent = `${row.name} ${row.progress}/${row.cost}`;
    bar.append(fill, text);
    li.append(bar);
    root.append(li);
  }
}

/**
 * The build menu: stock that can be clicked rather than stock that can only be
 * read. This is the line milestone 3's finding 1 has been waiting three
 * milestones for.
 *
 * Rebuilt only when its contents change. A player is aiming at these buttons
 * while a ghost follows their cursor, and replacing the DOM under a pointer
 * every frame would cancel their own click.
 */
function renderBuild(
  root: HTMLElement,
  snapshot: WorldSnapshot,
  onPick: (option: BuildOption) => void,
  activeLabel: string | null,
): void {
  const options = buildOptions(snapshot);
  const key = `${options.map((o) => o.label).join("|")}::${activeLabel ?? ""}`;
  if (root.dataset.key === key) return;
  root.dataset.key = key;

  root.textContent = "";
  for (const option of options) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label;
    // Remove is not stock, and a menu of amber offers with a destructive one in
    // the middle of it would read as one more thing to spend.
    button.className = [
      option.kind === "remove" ? "build-remove" : "",
      option.label === activeLabel ? "build-active" : "",
    ]
      .filter(Boolean)
      .join(" ");
    button.addEventListener("click", () => onPick(option));
    li.append(button);
    root.append(li);
  }
}
