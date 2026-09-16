import { Container, Graphics } from "pixi.js";
import { CROP_GROWTH, WHEAT_GROWTH_TICKS } from "../sim/config.ts";
import type { Direction, MachineKind, Vec, WorldSnapshot } from "../sim/types.ts";
import { toPixel, toTile, type Geometry, type Size } from "./geometry.ts";
import { COLOR } from "./palette.ts";
import { drawArrow } from "./actors.ts";

/**
 * What a machine is called, to a player. Per Decision 7 of the milestone 4
 * plan: the ternary this replaced silently called a mill a Storage Crate.
 */
const MACHINE_LABEL: Record<MachineKind, string> = {
  console: "Research Console",
  crate: "Storage Crate",
  mill: "Mill",
  oven: "Oven",
  conveyor: "Conveyor",
};

/**
 * What is on a tile, in display order: most specific first.
 *
 * Pure over a snapshot, which is the whole reason it is a separate function —
 * "hovering a mature crop under a bot carrying nine wheat says the right three
 * things" is a test, and "the tooltip looks right" is not.
 */
export function describeTile(snapshot: WorldSnapshot, tile: Vec): string[] {
  if (
    tile.x < 0 ||
    tile.y < 0 ||
    tile.x >= snapshot.width ||
    tile.y >= snapshot.height
  ) {
    return [];
  }

  const lines: string[] = [];
  const bot = snapshot.bots.find((b) => b.pos.x === tile.x && b.pos.y === tile.y);
  if (bot) {
    lines.push(`Bot ${bot.id} — ${bot.modules.join(", ") || "no modules"}`);
    lines.push(`  carrying ${describeInventory(bot.inventory)}`);
    lines.push(`  ${describeBotActivity(bot)}`);
  }

  const machine = snapshot.machines.find((m) => m.pos.x === tile.x && m.pos.y === tile.y);
  if (machine) {
    lines.push(MACHINE_LABEL[machine.kind]);
    // Before the contents, because for a belt it is the more important fact.
    // The facing is the only thing a player can get wrong about one, the arrow
    // is small at the sizes this renders at, and a belt pointed into a mill
    // instead of away from it looks exactly like one that works.
    if (machine.dir) lines.push(`  facing ${machine.dir}`);
    lines.push(`  holding ${describeInventory(machine.inventory)}`);
    if (machine.progress > 0) lines.push(`  working — ${Math.round(machine.progress * 100)}%`);
    // Jammed first: a machine that is both is stuck in the way feeding it will
    // not fix, and naming the fixable one first would send the player to the
    // wrong problem.
    if (machine.jammed) lines.push("  jammed — no room for the output");
    else if (machine.starved) lines.push("  starved — nothing to consume");
  }

  const t = snapshot.tiles[tile.y * snapshot.width + tile.x];
  if (t?.crop) {
    // Per crop, not per wheat. The same class of mistake as the machine-label
    // ternary above: correct today because there is one crop, and silently
    // wrong the moment there are two.
    const ripe = CROP_GROWTH[t.crop.item] ?? WHEAT_GROWTH_TICKS;
    const pct = Math.min(100, Math.round((t.crop.growth / ripe) * 100));
    lines.push(pct >= 100 ? `${t.crop.item} — ready` : `${t.crop.item} — ${pct}% grown`);
  }
  if (t) lines.push(t.terrain);

  return lines;
}

function describeInventory(inv: Record<string, number | undefined>): string {
  const parts = Object.entries(inv)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([item, n]) => `${n} ${item}`);
  return parts.length ? parts.join(", ") : "nothing";
}

function describeBotActivity(bot: WorldSnapshot["bots"][number]): string {
  if (bot.blockedOn === "bot") return "blocked by another bot";
  if (bot.blockedOn === "radio") return "waiting for a message";
  if (!bot.action) return "idle";
  const dir = bot.action.dir ? ` ${bot.action.dir}` : "";
  return `${bot.action.kind}${dir} — ${bot.action.remaining} of ${bot.action.total} ticks left`;
}

/**
 * What the player is currently holding over the map.
 *
 * `reason` is the sim's own refusal string for a tile, or null if the placement
 * would succeed — so the ghost's colour and the sim's answer are the same rule,
 * asked once. A renderer that worked out for itself where a mill fits would
 * drift from `canPlace` the first time a rule changed.
 */
export interface Placement {
  /** The build-menu option this came from, so the menu can show which is armed. */
  option: string;
  label: string;
  /** Which way it would go down, for a kind with a front. Null for the rest. */
  facing: Direction | null;
  reason(tile: Vec): string | null;
  /** Called only for a tile whose `reason` is null. */
  apply(tile: Vec): void;
  /** Turn it a quarter. Does nothing for a kind with no front. */
  rotate(): void;
}

/** The parts of a placement its text is made of. */
type ArmedText = { label: string; facing: Direction | null };

/**
 * What the tooltip says while the player is holding something over a tile.
 *
 * Milestone 5's finding 2, second half. Placement stays armed after a click —
 * that is what makes laying a line of belts bearable — but armed and inspecting
 * were two modes with no difference on screen except the tooltip's wording, and
 * the natural thing to do after placing a machine is to look at it. So the
 * tooltip now describes **both**: what would go here, and what is already here.
 *
 * Only for a tile something is standing on. Empty ground is left alone: a crop
 * report nobody asked for, while they are aiming at something, is noise.
 */
export function describePlacement(
  snapshot: WorldSnapshot,
  tile: Vec,
  placing: ArmedText & { reason: string | null },
): string[] {
  const head = [
    placing.facing ? `${placing.label} (facing ${placing.facing})` : placing.label,
    `  ${placing.reason ?? "click to place"}`,
  ];
  const occupied =
    snapshot.machines.some((m) => m.pos.x === tile.x && m.pos.y === tile.y) ||
    snapshot.bots.some((b) => b.pos.x === tile.x && b.pos.y === tile.y);
  return occupied ? [...head, ...describeTile(snapshot, tile)] : head;
}

/**
 * The banner that says the canvas is armed, and how to stop.
 *
 * Milestone 5's finding 2, first half: "armed" lived only in the wording of a
 * tooltip the player had to be hovering a tile to read, and nothing anywhere
 * said that Escape was the way out.
 */
export function armedMessage(placing: ArmedText | null): string {
  if (!placing) return "";
  const what = placing.label.replace(/^Place /, "");
  const facing = placing.facing ? ` (facing ${placing.facing})` : "";
  const turn = placing.facing ? "R to turn, " : "";
  return `placing ${what}${facing} — ${turn}Esc to stop`;
}

export interface Inspector {
  /** The tile under the cursor, or null. */
  readonly hovered: Vec | null;
  /** Non-null while the player is placing something. */
  placing: Placement | null;
  /** Redraw the hover outline, ghost and tooltip against the current snapshot. */
  update(snapshot: WorldSnapshot, geometry: Geometry): void;
  /** Called with the bot id clicked, or null when empty space was clicked. */
  onSelect: (botId: number | null) => void;
  /** Called with the tile clicked while placing. Placement stays active. */
  onPlace: (tile: Vec) => void;
}

export function createInspector(
  host: HTMLElement,
  layer: Container,
  grid: Size,
  geometry: Geometry,
): Inspector {
  let geo = geometry;
  let hovered: Vec | null = null;
  /** The latest snapshot, because a pointer event does not arrive with one. */
  let latest: WorldSnapshot | null = null;

  const outline = new Graphics();
  layer.addChild(outline);

  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  tooltip.hidden = true;
  host.append(tooltip);

  const inspector: Inspector = {
    get hovered() {
      return hovered;
    },
    placing: null,
    update(snapshot, geometry) {
      geo = geometry;
      latest = snapshot;
      outline.clear();
      if (!hovered) {
        tooltip.hidden = true;
        return;
      }

      const p = toPixel(geo, hovered);
      const placing = inspector.placing;
      const reason = placing ? placing.reason(hovered) : null;

      if (placing) {
        // A filled ghost, because the question is "what goes here", not "what
        // is here". Green means the click will work; red carries the reason.
        const colour = reason === null ? 0x6fbf5a : 0xe0584a;
        outline
          .rect(p.x + 1, p.y + 1, geo.size - 2, geo.size - 2)
          .fill({ color: colour, alpha: 0.35 })
          .stroke({ width: 2, color: colour });
        if (placing.facing) {
          // The same arrow the belt itself is drawn with, so what the ghost
          // promises and what lands are the same shape rather than two of them.
          outline.translateTransform(p.x + geo.size / 2, p.y + geo.size / 2);
          drawArrow(outline, geo.size, placing.facing, colour);
          outline.resetTransform();
        }
      } else {
        // An outline rather than a fill: a fill hides the crop being asked about.
        outline
          .rect(p.x + 0.5, p.y + 0.5, geo.size - 1, geo.size - 1)
          .stroke({ width: 1, color: COLOR.selection, alpha: 0.7 });
      }

      const lines = placing
        ? describePlacement(snapshot, hovered, { ...placing, reason })
        : describeTile(snapshot, hovered);
      tooltip.hidden = lines.length === 0;
      tooltip.textContent = lines.join("\n");
      // Offset from the tile, clamped inside the pane so an edge tile's
      // tooltip does not hang off the canvas where it cannot be read.
      const left = Math.min(p.x + geo.size + 8, host.clientWidth - tooltip.offsetWidth - 4);
      const top = Math.min(p.y, host.clientHeight - tooltip.offsetHeight - 4);
      tooltip.style.left = `${Math.max(4, left)}px`;
      tooltip.style.top = `${Math.max(4, top)}px`;
    },
    onSelect: () => {},
    onPlace: () => {},
  };

  const tileFromEvent = (e: PointerEvent): Vec | null => {
    const rect = host.getBoundingClientRect();
    return toTile(geo, grid, { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  host.addEventListener("pointermove", (e) => {
    hovered = tileFromEvent(e);
  });
  host.addEventListener("pointerleave", () => {
    hovered = null;
  });
  host.addEventListener("pointerdown", (e) => {
    const tile = tileFromEvent(e);

    if (inspector.placing) {
      // Right-click cancels, which is the convention every game in this genre
      // shares. Left-click on an illegal tile does nothing rather than
      // cancelling: misclicking the edge of a crate should not cost the player
      // their whole placement.
      if (e.button === 2) inspector.placing = null;
      else if (tile) inspector.onPlace(tile);
      return;
    }

    const bot =
      tile && latest
        ? latest.bots.find((b) => b.pos.x === tile.x && b.pos.y === tile.y)
        : undefined;
    // Clicking empty space clears the selection, which is why this is not
    // guarded on having found a bot.
    inspector.onSelect(bot?.id ?? null);
  });

  // Without this a right-click to cancel also opens the browser's menu.
  host.addEventListener("contextmenu", (e) => {
    if (inspector.placing) e.preventDefault();
  });

  window.addEventListener("keydown", (e) => {
    if (!inspector.placing) return;
    if (e.key === "Escape") inspector.placing = null;
    // Not while typing in the editor: Monaco is a different element, and a
    // player writing `bot.harvester` should not turn a belt they forgot about.
    else if (e.key.toLowerCase() === "r" && e.target === document.body) {
      inspector.placing.rotate();
    }
  });

  return inspector;
}
