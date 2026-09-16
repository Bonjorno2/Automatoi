import { Container, Graphics, Text } from "pixi.js";
import { RESEARCH_COST, capacityOf } from "../sim/config.ts";
import { total } from "../sim/inventory.ts";
import { DIR } from "../sim/world.ts";
import type {
  BotSnapshot,
  Direction,
  MachineKind,
  MachineSnapshot,
  WorldSnapshot,
} from "../sim/types.ts";
import { toCentre, type Geometry } from "./geometry.ts";
import { COLOR, MACHINE, MIN_ID_SIZE, MODULE, botColor, cargoPips } from "./palette.ts";
import { actorPos } from "./actor-pos.ts";

/**
 * Bots and machines: the few things that move, or change often enough to be
 * worth touching every frame.
 *
 * Machines are drawn from a table keyed by `MachineKind` rather than a chain of
 * comparisons, per Decision 7 of the milestone 4 plan. A mill and an oven are
 * two more rows in that table, and the progress arc the console already uses to
 * show research is the same question a machine part-way through converting its
 * input has to answer — so the arc is a shared helper from the start.
 */
export interface ActorLayer {
  update(snapshot: WorldSnapshot, alpha: number, selectedBotId: number | null): void;
  resize(geometry: Geometry): void;
}

interface MachineStyle {
  /**
   * The block itself. Drawn **once**, when the sprite is created.
   *
   * It may therefore read anything about the machine that cannot change — a
   * conveyor's facing is fixed at placement, which is what makes the arrow
   * belong here rather than in the overlay. Anything that does change belongs
   * below, or it will be drawn once and then be wrong.
   */
  body(g: Graphics, size: number, m: MachineSnapshot): void;
  /**
   * What the machine is doing, redrawn when it changes. Return value says
   * whether anything was drawn, so an idle machine costs nothing.
   */
  overlay(g: Graphics, size: number, m: MachineSnapshot, snap: WorldSnapshot): void;
}

const MACHINE_STYLE: Record<MachineKind, MachineStyle> = {
  console: {
    body(g, size) {
      const s = size * 0.86;
      g.roundRect(-s / 2, -s / 2, s, s, size * 0.12).fill(MACHINE.console.body);
      g.rect(-s * 0.28, -s * 0.3, s * 0.56, s * 0.34).fill(MACHINE.console.trim);
    },
    overlay(g, size, _m, snap) {
      const queued = snap.research.queue[0];
      if (!queued) return;
      const cost = RESEARCH_COST[queued];
      drawArc(g, size * 0.52, snap.research.progress / cost, COLOR.progress, size * 0.1);
    },
  },
  crate: {
    body(g, size) {
      const s = size * 0.78;
      g.roundRect(-s / 2, -s / 2, s, s, size * 0.08).fill(MACHINE.crate.body);
      g.rect(-s / 2, -s * 0.1, s, s * 0.08).fill(MACHINE.crate.trim);
    },
    overlay(g, size, m) {
      const fill = Math.min(1, total(m.inventory) / capacityOf(m.kind));
      if (fill <= 0) return;
      const s = size * 0.78;
      g.rect(-s / 2, s / 2 - s * fill, s, s * fill).fill({ color: MACHINE.crate.trim, alpha: 0.5 });
    },
  },
  mill: {
    body(g, size) {
      const s = size * 0.84;
      g.roundRect(-s / 2, -s / 2, s, s, size * 0.1).fill(MACHINE.mill.body);
      // Two stones, because a mill grinds.
      g.circle(0, 0, s * 0.22).fill(MACHINE.mill.trim);
      g.circle(0, 0, s * 0.1).fill(MACHINE.mill.body);
    },
    overlay: conversionArc,
  },
  oven: {
    body(g, size) {
      const s = size * 0.84;
      g.roundRect(-s / 2, -s / 2, s, s, size * 0.1).fill(MACHINE.oven.body);
      // A mouth, because an oven bakes.
      g.roundRect(-s * 0.26, -s * 0.05, s * 0.52, s * 0.3, s * 0.06).fill(MACHINE.oven.trim);
    },
    overlay: conversionArc,
  },
  conveyor: {
    // A plate filling its tile, because a belt is floor rather than furniture:
    // a line of them should read as one continuous run, not as a row of boxes.
    body(g, size, m) {
      g.rect(-size / 2, -size / 2, size, size).fill(MACHINE.conveyor.body);
      drawArrow(g, size, m.dir ?? "north");
    },
    // What it is carrying. The overlay's key already includes the machine's item
    // total, so this is redrawn exactly when the cargo changes.
    overlay(g, size, m) {
      const pips = cargoPips(m.inventory, PIPS_PER_BELT);
      if (pips.length === 0) return;
      const r = size * 0.11;
      const gap = r * 2.4;
      const start = -((pips.length - 1) * gap) / 2;
      pips.forEach((colour, i) => {
        g.circle(start + i * gap, 0, r).fill(colour);
      });
    },
  },
};

/** How many items a belt draws before it stops counting. */
const PIPS_PER_BELT = 4;

/**
 * Which way a belt hands things on.
 *
 * Built from the sim's own direction vector rather than from four hand-drawn
 * triangles, so there is one place that knows what "east" means on screen and it
 * is the same place the sim gets it from.
 *
 * Exported because the placement ghost draws it too: what the ghost promises and
 * what lands on the tile should be the same shape, not two shapes that agree.
 */
export function drawArrow(
  g: Graphics,
  size: number,
  dir: Direction,
  colour: number = MACHINE.conveyor.trim,
): void {
  const v = DIR[dir];
  const across = { x: -v.y, y: v.x };
  const tip = size * 0.3;
  const back = size * 0.12;
  const half = size * 0.2;
  g.poly([
    v.x * tip,
    v.y * tip,
    -v.x * back + across.x * half,
    -v.y * back + across.y * half,
    -v.x * back - across.x * half,
    -v.y * back - across.y * half,
  ]).fill({ color: colour, alpha: 0.85 });
}

/**
 * How far through its conversion a machine is.
 *
 * The same question the console's research arc answers, which is why milestone
 * 4 wrote that arc as a shared helper on the explicit assumption that a mill
 * and an oven would want it. They do, unchanged.
 */
function conversionArc(g: Graphics, size: number, m: MachineSnapshot): void {
  if (m.progress <= 0) return;
  drawArc(g, size * 0.52, m.progress, COLOR.progress, size * 0.1);
}

/** A clockwise arc from twelve o'clock, used by anything that is part-way through something. */
function drawArc(g: Graphics, radius: number, fraction: number, color: number, width: number): void {
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return;
  const start = -Math.PI / 2;
  g.arc(0, 0, radius, start, start + f * Math.PI * 2).stroke({ width, color, cap: "round" });
}

interface BotSprite {
  root: Container;
  body: Graphics;
  ring: Graphics;
  /** The bot's own number, drawn on the chassis where the tile is big enough. */
  label: Text;
  /** What the body was last drawn for, so an unchanged bot skips the rebuild. */
  key: string;
  /** Held between moves: an idle bot keeps facing where it last went. */
  facing: Direction;
}

interface MachineSprite {
  root: Container;
  body: Graphics;
  overlay: Graphics;
  key: string;
}

export function createActorLayer(frameLayer: Container, geometry: Geometry): ActorLayer {
  let geo = geometry;
  const bots = new Map<number, BotSprite>();
  const machines = new Map<number, MachineSprite>();

  // Machines below bots: a bot standing beside a crate should never be hidden
  // by it, and milestone 5 lets bots stand next to a lot more of them.
  const machineContainer = new Container();
  const botContainer = new Container();
  frameLayer.addChild(machineContainer, botContainer);

  function drawBot(sprite: BotSprite, bot: BotSnapshot, active: boolean, index: number): void {
    const size = geo.size;
    const s = size * 0.66;
    const g = sprite.body;
    g.clear();
    g.roundRect(-s / 2, -s / 2, s, s, s * 0.26)
      .fill(botColor(index, active))
      .stroke({ width: Math.max(1, size * 0.06), color: COLOR.botOutline });

    // The number, where there is room for one. Colour says which bot at every
    // size; the digit is what a large enough window adds to it.
    sprite.label.text = String(bot.id);
    sprite.label.visible = size >= MIN_ID_SIZE;
    sprite.label.style.fontSize = Math.round(s * 0.62);

    // Facing notch. A square with no front is a box; a square with a front is
    // a thing that is going somewhere.
    const n = s * 0.26;
    const off = s * 0.42;
    const v = DIR[sprite.facing];
    g.roundRect(v.x * off - n / 2, v.y * off - n / 2, n, n, n * 0.3).fill(COLOR.botOutline);

    // Module pips along the bottom edge, one per installed module.
    const pip = Math.max(1, s * 0.11);
    const gap = pip * 2.1;
    const startX = -((bot.modules.length - 1) * gap) / 2;
    bot.modules.forEach((m, i) => {
      g.circle(startX + i * gap, s * 0.5 - pip * 0.2, pip).fill(MODULE[m]);
    });
  }

  function syncBots(snap: WorldSnapshot, alpha: number, selected: number | null): void {
    const seen = new Set<number>();
    // The index is the bot's place in the world's own list, which is what its
    // colour is drawn from — see BOT_BODY for why not the id.
    snap.bots.forEach((bot, index) => {
      seen.add(bot.id);
      let sprite = bots.get(bot.id);
      if (!sprite) {
        const root = new Container();
        const ring = new Graphics();
        const body = new Graphics();
        const label = new Text({
          text: "",
          style: { fill: COLOR.botOutline, fontFamily: "ui-monospace, Menlo, monospace" },
        });
        label.anchor.set(0.5);
        // A touch above centre: the module pips live along the bottom edge.
        label.position.set(0, -geo.size * 0.06);
        root.addChild(ring, body, label);
        botContainer.addChild(root);
        sprite = { root, body, ring, label, key: "", facing: "east" };
        bots.set(bot.id, sprite);
      }

      if (bot.action?.dir) sprite.facing = bot.action.dir;
      const active = bot.action !== null;
      const key = `${geo.size}|${active}|${sprite.facing}|${bot.modules.join(",")}|${index}|${bot.id}`;
      if (key !== sprite.key) {
        drawBot(sprite, bot, active, index);
        sprite.key = key;
      }

      const ringKey = `${geo.size}|${selected === bot.id}`;
      if (sprite.ring.label !== ringKey) {
        sprite.ring.clear();
        if (selected === bot.id) {
          // Inside the tile, for the same reason the starved ring is: a ring
          // that crosses a tile edge gets read as belonging to the neighbour.
          sprite.ring
            .circle(0, 0, geo.size * 0.46)
            .stroke({ width: Math.max(1, geo.size * 0.07), color: COLOR.selection });
        }
        sprite.ring.label = ringKey;
      }

      const p = toCentre(geo, actorPos(bot, alpha));
      sprite.root.position.set(p.x, p.y);
    });
    for (const [id, sprite] of bots) {
      if (seen.has(id)) continue;
      sprite.root.destroy({ children: true });
      bots.delete(id);
    }
  }

  function syncMachines(snap: WorldSnapshot): void {
    const seen = new Set<number>();
    for (const machine of snap.machines) {
      seen.add(machine.id);
      let sprite = machines.get(machine.id);
      const style = MACHINE_STYLE[machine.kind];
      if (!sprite) {
        const root = new Container();
        const body = new Graphics();
        const overlay = new Graphics();
        root.addChild(body, overlay);
        machineContainer.addChild(root);
        sprite = { root, body, overlay, key: "" };
        machines.set(machine.id, sprite);
        style.body(body, geo.size, machine);
      }

      const p = toCentre(geo, machine.pos);
      sprite.root.position.set(p.x, p.y);

      // The overlay is the only part that changes, and only when the number
      // behind it does.
      const key = `${geo.size}|${snap.research.queue[0] ?? ""}|${snap.research.progress}|${total(machine.inventory)}|${machine.progress.toFixed(3)}`;
      if (key !== sprite.key) {
        sprite.overlay.clear();
        style.overlay(sprite.overlay, geo.size, machine, snap);
        sprite.key = key;
      }
    }
    for (const [id, sprite] of machines) {
      if (seen.has(id)) continue;
      sprite.root.destroy({ children: true });
      machines.delete(id);
    }
  }

  return {
    update(snapshot, alpha, selectedBotId) {
      syncMachines(snapshot);
      syncBots(snapshot, alpha, selectedBotId);
    },
    resize(next) {
      geo = next;
      // Every sprite's geometry is in pixels, so a new fit invalidates all of
      // it. Cheap: there are a handful of actors, not a thousand tiles.
      for (const [, s] of bots) s.root.destroy({ children: true });
      for (const [, s] of machines) s.root.destroy({ children: true });
      bots.clear();
      machines.clear();
    },
  };
}
