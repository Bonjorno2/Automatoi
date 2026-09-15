import { DIR } from "../sim/world.ts";
import type { BotSnapshot } from "../sim/types.ts";

/**
 * Where to draw a bot this frame, in tile coordinates, possibly fractional.
 *
 * A bot's `pos` only changes on the tick a move resolves, so drawing `pos`
 * directly makes a two-tick move look like a teleport every two ticks. This
 * spreads that jump across the ticks the move actually takes.
 */
export function actorPos(bot: BotSnapshot, alpha: number): { x: number; y: number } {
  const a = bot.action;

  // Standing still, or doing something that is not travel. Harvesting does not
  // slide, and neither does a bot with nothing to do.
  if (!a || a.kind !== "move" || !a.dir || a.total <= 0) return { ...bot.pos };

  // Blocked, whatever the action says. The sim's retry path resets `remaining`
  // to 1 every tick a bot waits for an occupied tile, so interpolating a
  // blocked move makes the bot lunge at the tile it cannot enter, once a tick,
  // for as long as it waits.
  if (bot.blockedOn !== null) return { ...bot.pos };

  const step = DIR[a.dir];
  // Clamped below 1, never to it: the sim puts the bot on the destination tile
  // the moment the move resolves, and a renderer that also reaches 1 draws that
  // tile twice and produces a one-frame double-step.
  const progress = clamp((a.total - a.remaining + alpha) / a.total, 0, 0.999);
  return {
    x: bot.pos.x + step.x * progress,
    y: bot.pos.y + step.y * progress,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}
