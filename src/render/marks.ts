import { Container, Graphics } from "pixi.js";
import { DIR } from "../sim/world.ts";
import type { WorldEvent } from "../sim/events.ts";
import type { Vec, WorldSnapshot } from "../sim/types.ts";
import { toCentre, type Geometry } from "./geometry.ts";
import { COLOR } from "./palette.ts";

/**
 * Short-lived visuals for things that went wrong.
 *
 * Marks decay in **real** time rather than simulated time. A mark is feedback
 * to a human, and a human's eye does not speed up when the player presses 4x —
 * a tick-timed mark at high speed is a flicker nobody can read.
 *
 * Two shapes of mark, and the difference is the event's own shape. A `bump` is
 * an instant: it happened, it is over, it fades. A `blocked` or a `starved` is
 * a *state*: it persists until the world says otherwise, so it is held until an
 * update stops reporting it rather than timed out.
 */
export interface MarkLayer {
  /**
   * @param events drained from the world this frame
   * @param held   states currently true, rebuilt each frame by the caller
   * @param nowMs  real time, for decay
   */
  update(events: WorldEvent[], held: HeldMark[], nowMs: number, geometry: Geometry): void;
}

/** A state-shaped mark the caller re-asserts every frame it is still true. */
export interface HeldMark {
  key: string;
  pos: Vec;
  kind: "blockedBot" | "blockedRadio" | "starved";
}

/**
 * The state-shaped marks a snapshot implies, derived rather than tracked.
 *
 * Every one of these is a flag the sim already publishes, which is the point:
 * a renderer that worked out for itself when a bot is blocked would be
 * restating a sim rule, and restated rules drift.
 */
export function heldMarks(snapshot: WorldSnapshot): HeldMark[] {
  const out: HeldMark[] = [];
  for (const bot of snapshot.bots) {
    if (bot.blockedOn === "bot") {
      out.push({ key: `bot:${bot.id}:blocked`, pos: bot.pos, kind: "blockedBot" });
    } else if (bot.blockedOn === "radio") {
      out.push({ key: `bot:${bot.id}:radio`, pos: bot.pos, kind: "blockedRadio" });
    }
  }
  for (const machine of snapshot.machines) {
    if (machine.starved) {
      out.push({ key: `machine:${machine.id}:starved`, pos: machine.pos, kind: "starved" });
    }
  }
  return out;
}

const LIFETIME: Record<string, number> = {
  bump: 420,
  refused: 420,
  full: 700,
  research: 950,
};

interface Fading {
  g: Graphics;
  born: number;
  life: number;
}

/** Eased-out opacity for a mark of age `ageMs`. Clamped, never negative. */
export function markAlpha(ageMs: number, lifetimeMs: number): number {
  if (lifetimeMs <= 0) return 0;
  const t = ageMs / lifetimeMs;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  // Hold near-full for the first third, then fall away. A linear fade spends
  // most of its life too faint to notice, which wastes the mark.
  return t < 0.33 ? 1 : 1 - (t - 0.33) / 0.67;
}

export function createMarkLayer(parent: Container): MarkLayer {
  const layer = new Container();
  parent.addChild(layer);

  const fading: Fading[] = [];
  const held = new Map<string, Graphics>();

  /**
   * The fit these marks were drawn against.
   *
   * Marks bake tile coordinates into pixel positions and pixel-sized shapes at
   * the moment they are created, and unlike the tile and actor layers they were
   * never rebuilt on resize. The symptom was a starved console's ring stranded
   * eleven tiles from the console, still perfectly opaque, because the pane had
   * changed width after the mark was born. Held marks are rebuilt from the
   * caller's list on the very next frame, so dropping everything is enough.
   */
  let drawnFor: Geometry | null = null;

  function clearAll(): void {
    for (const f of fading) f.g.destroy();
    fading.length = 0;
    for (const [, g] of held) g.destroy();
    held.clear();
  }

  function spawn(event: WorldEvent, geo: Geometry, now: number): void {
    const life = LIFETIME[event.kind];
    if (life === undefined) return; // state-shaped events are handled as held marks
    const g = new Graphics();
    const size = geo.size;

    switch (event.kind) {
      case "bump": {
        // An arc punched outward on the blocked edge: it reads as "there is
        // something there", which is exactly what the bot just discovered.
        const d = DIR[event.dir];
        const c = toCentre(geo, event.pos);
        g.position.set(c.x + d.x * size * 0.5, c.y + d.y * size * 0.5);
        g.rotation = Math.atan2(d.y, d.x);
        for (const r of [size * 0.3, size * 0.45]) {
          g.arc(0, 0, r, -0.8, 0.8).stroke({ width: Math.max(1, size * 0.08), color: 0xff6b4a });
        }
        break;
      }
      case "refused": {
        const c = toCentre(geo, event.pos);
        g.position.set(c.x, c.y);
        const r = size * 0.3;
        g.moveTo(-r, 0).lineTo(r, 0).stroke({ width: Math.max(1, size * 0.1), color: 0xb0b0b0 });
        break;
      }
      case "full": {
        const c = toCentre(geo, event.pos);
        g.position.set(c.x, c.y - size * 0.55);
        g.roundRect(-size * 0.3, -size * 0.07, size * 0.6, size * 0.14, size * 0.07)
          .fill(COLOR.starved);
        break;
      }
      case "research": {
        // A ring expanding from the console. Scale is animated below.
        const c = toCentre(geo, event.pos);
        g.position.set(c.x, c.y);
        g.circle(0, 0, size * 0.5).stroke({ width: Math.max(1, size * 0.12), color: COLOR.progress });
        g.label = "research";
        break;
      }
      default:
        return;
    }

    layer.addChild(g);
    fading.push({ g, born: now, life });
  }

  function drawHeld(g: Graphics, mark: HeldMark, geo: Geometry): void {
    const size = geo.size;
    const c = toCentre(geo, mark.pos);
    g.position.set(c.x, c.y);
    switch (mark.kind) {
      case "blockedBot": {
        // The design's "red collision marker", held for as long as it is true.
        const r = size * 0.26;
        g.moveTo(0, -r).lineTo(r, 0).lineTo(0, r).lineTo(-r, 0).closePath()
          .fill({ color: 0xe04a3a, alpha: 0.85 });
        break;
      }
      case "blockedRadio": {
        g.position.set(c.x, c.y - size * 0.6);
        for (const r of [size * 0.16, size * 0.28]) {
          g.arc(0, 0, r, -2.4, -0.75).stroke({ width: Math.max(1, size * 0.07), color: 0xc07fd0 });
        }
        break;
      }
      case "starved": {
        // A hollow amber ring on a machine that wants input it has not got.
        //
        // Kept inside its own tile. The first version was radius 0.62 and
        // spilled over the neighbouring tile, where it merged with the selected
        // bot's ring into one ambiguous blob — two different meanings drawn as
        // one shape. Machines stand next to bots constantly; anything drawn
        // outside a tile will eventually be read as belonging to the wrong one.
        g.circle(0, 0, size * 0.42)
          .stroke({ width: Math.max(1, size * 0.11), color: COLOR.starved, alpha: 0.95 });
        break;
      }
    }
  }

  return {
    update(events, holdList, nowMs, geometry) {
      if (
        drawnFor === null ||
        drawnFor.size !== geometry.size ||
        drawnFor.originX !== geometry.originX ||
        drawnFor.originY !== geometry.originY
      ) {
        clearAll();
        drawnFor = geometry;
      }

      for (const e of events) spawn(e, geometry, nowMs);

      // Fade and retire.
      for (let i = fading.length - 1; i >= 0; i--) {
        const f = fading[i]!;
        const age = nowMs - f.born;
        if (age >= f.life) {
          f.g.destroy();
          fading.splice(i, 1);
          continue;
        }
        f.g.alpha = markAlpha(age, f.life);
        if (f.g.label === "research") {
          const t = age / f.life;
          f.g.scale.set(1 + t * 1.8);
        }
      }

      // Held marks: create what is newly true, drop what stopped being true.
      const live = new Set<string>();
      for (const mark of holdList) {
        live.add(mark.key);
        if (held.has(mark.key)) continue;
        const g = new Graphics();
        drawHeld(g, mark, geometry);
        layer.addChild(g);
        held.set(mark.key, g);
      }
      for (const [key, g] of held) {
        if (live.has(key)) continue;
        g.destroy();
        held.delete(key);
      }
    },
  };
}
