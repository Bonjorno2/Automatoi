import { Colony, ScriptColony as NeutralScriptColony } from "./colony.ts";
import type { ColonyOptions, ScriptColonyOptions } from "./colony.ts";
import { spawnNode } from "./spawn.node.ts";

/**
 * The Node-flavoured entry point to the bridge.
 *
 * All the logic lives in `colony.ts`, which imports nothing platform-specific.
 * This file exists only to supply the Node worker spawner as a default, so the
 * whole test suite can keep writing `new ScriptColony({ world })`.
 *
 * The split is load-bearing rather than cosmetic: a browser bundle that reached
 * `colony.ts` through this file would drag `node:worker_threads` in with it.
 * The page imports `colony.ts` and `spawn.web.ts` directly and never touches
 * this module.
 */
export class ScriptColony extends NeutralScriptColony {
  constructor(opts: ColonyOptions & Partial<ScriptColonyOptions>) {
    super({ ...opts, spawnWorker: opts.spawnWorker ?? spawnNode });
  }
}

export { Colony };
export type { BotView, ColonyOptions, ScriptColonyOptions, ScriptOutcome, ScriptStatus } from "./colony.ts";
