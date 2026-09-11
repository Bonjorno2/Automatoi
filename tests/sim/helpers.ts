import type { World } from "../../src/sim/world";
import type { Command, CommandResult } from "../../src/sim/types";

/** Issue a command and tick until it resolves. Throws if it never does. */
export function run(world: World, botId: number, cmd: Command): CommandResult {
  world.issue(botId, cmd);
  const immediate = world.takeResult(botId);
  if (immediate) return immediate;
  for (let i = 0; i < 10_000; i++) {
    world.tick();
    const r = world.takeResult(botId);
    if (r) return r;
  }
  throw new Error(`command ${cmd.kind} did not resolve within 10000 ticks`);
}

/** Tick n times. */
export function ticks(world: World, n: number): void {
  for (let i = 0; i < n; i++) world.tick();
}
