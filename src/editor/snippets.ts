import { BOT_CAPACITY } from "../sim/config.ts";
import type { Primitive } from "./source.ts";

/**
 * The codebook's contents, as ladders rather than as a flat list.
 *
 * The design doc promises this in "The abstraction rhythm": *"A snippet library
 * exists for beginners to copy from; veterans ignore it."* Every rung here is
 * one of the patterns that doc already names — this is not a curriculum invented
 * alongside it.
 *
 * **Milestone 10 found that several chips were the same program, three times.**
 * "Harvest in a loop", "Stay on the field" and "Sweep the whole field" are not
 * three patterns; they are one pattern growing up, and presenting them as
 * siblings hid the only interesting thing about them. So a ladder is a line of
 * descent, each rung a complete runnable script, and the player climbs it as
 * they earn it:
 *
 * - `introduces` is what a rung **adds** — two or three ideas, not every line in
 *   it. A rung asking for all eight of its lines would unlock only for somebody
 *   who could already write it.
 * - A rung is unlocked by having used everything it and every rung beneath it
 *   introduces, **or** by the game having offered that chip. Being taught
 *   something counts as learning it, which is what stops the loop chip from
 *   requiring a loop the player has not written yet.
 * - Hardware gates the whole ladder, because there is no rung of the scanner
 *   ladder worth reading without a scanner.
 *
 * This is still not the Shared Library — that arrived in milestone 9 as a buffer
 * of its own. If this file starts growing toward a module system, stop.
 */

export interface Rung {
  title: string;
  /** One line on what it is for, and what it teaches. */
  blurb: string;
  code: string;
  /** What this rung adds to the one below it. Empty for nothing new. */
  introduces: Primitive[];
  /**
   * A rung that teaches no new primitive, only how tiring the last one is.
   *
   * The opening needs these and nothing else does. The design's abstraction
   * rhythm is that a hands phase's *pain is tedium* and the mind phase that
   * follows automates it — so the step that says "now do that three more times"
   * is not filler, it is the thing that makes the loop feel like a relief
   * instead of a trick. Marked rather than inferred, so that a rung which
   * introduces nothing by accident still fails the test.
   */
  practice?: true;
  /** What the game says when it offers this rung, if it ever offers it. */
  prompt?: string;
}

export interface Ladder {
  id: string;
  /** What the line of descent is called, above the rungs. */
  name: string;
  /** A module the starting chassis does not have, if this ladder needs one. */
  requires?: "planter" | "scanner" | "radio" | "builder";
  /** A machine that has to exist in the world, if this ladder needs one. */
  needsMachine?: "crate";
  rungs: Rung[];
}

export const LADDERS: Ladder[] = [
  /**
   * The opening, handed over one line at a time.
   *
   * **Why this exists, and why the loop is last.** The first playtest found a
   * beginner had no path from "my loop works" to "something got researched" —
   * research needs wheat in the console, the only way in is `deposit`, and the
   * chip teaching `deposit` was hidden behind a crate that needs research. Every
   * signpost pointed away from the only door.
   *
   * The deeper problem was that the loop arrived on the *second* Run, which
   * skipped the hands phase entirely. The design's abstraction rhythm says the
   * mind phase automates the tedium of the hands phase — so a loop handed over
   * before there is any tedium is a trick rather than a relief. This ladder is
   * the hands phase: move, collect, move, collect, until the player's own
   * fingers are bored, and *then* the loop.
   *
   * Two loops, in the right order. The walk home comes first because a loop that
   * **stops** is an easier idea than one that does not, and it stops at a number
   * the player can see and click on the map. `while (true)` is the finale.
   *
   * The walk home is two axes and not "west until something blocks you", which
   * is what it was until a playtest ran it: the sweep goes west past the
   * Console's column on the rows below it, so "until blocked" walked *away* from
   * home to the world's edge and deposited into nothing.
   */
  {
    id: "getting-started",
    name: "Getting started",
    rungs: [
      {
        title: "Move",
        blurb: "One tile, one call. East is to the right.",
        prompt: "Start here. Take this line and press Run.",
        introduces: ["move"],
        code: `bot.move("east");`,
      },
      {
        title: "Collect",
        blurb: "Takes the wheat on the tile you are standing on. Nothing else.",
        prompt: "The bot moved. Now take what is under it.",
        introduces: ["harvest"],
        code: `bot.harvester.harvest();`,
      },
      {
        title: "Again, and again",
        blurb: "Collect, step, collect, step. Exactly what you just did, three times over.",
        prompt: "Two lines is a bot that does one thing. Try a few in a row.",
        practice: true,
        introduces: [],
        code: `bot.harvester.harvest();
bot.move("east");
bot.harvester.harvest();
bot.move("east");
bot.harvester.harvest();
bot.move("east");`,
      },
      {
        title: "Turn at the end of a row",
        blurb: "Nothing new — just south, then back the other way. Getting tiring yet?",
        prompt: "The row runs out. Go down one and come back along the next.",
        practice: true,
        introduces: [],
        code: `bot.harvester.harvest();
bot.move("east");
bot.harvester.harvest();
bot.move("south");
bot.harvester.harvest();
bot.move("west");
bot.harvester.harvest();
bot.move("west");
bot.harvester.harvest();`,
      },
      {
        title: "Go home and hand it over",
        blurb:
          "17,17 is the tile below the Console — alt-click any tile to drop its address into your code. Two walks, one per axis, and one step north to arrive beside it.",
        prompt: "Wheat in the bot buys nothing. The Research Console is west of you.",
        introduces: ["while", "pos", "deposit"],
        code: `while (bot.pos().y !== 17) bot.move(bot.pos().y > 17 ? "north" : "south");
while (bot.pos().x !== 17) bot.move(bot.pos().x > 17 ? "west" : "east");
bot.move("north");
bot.deposit("west", "wheat", 10);`,
      },
      {
        title: "Only when you are full",
        blurb: "A bot carries 10 in total. Check before you walk all the way home.",
        prompt: "Walking home after every single grain is a waste. Go when you are full.",
        introduces: ["if", "inventory"],
        code: `bot.harvester.harvest();
bot.move("east");
if ((bot.inventory().wheat ?? 0) >= 10) {
  while (bot.pos().y !== 17) bot.move(bot.pos().y > 17 ? "north" : "south");
  while (bot.pos().x !== 17) bot.move(bot.pos().x > 17 ? "west" : "east");
  bot.move("north");
  bot.deposit("west", "wheat", 10);
}`,
      },
      {
        title: "Ask for something",
        blurb: "The Console spends what you give it. Queue a planter and keep feeding it.",
        prompt: "The Console has wheat now. Tell it what to build.",
        introduces: ["queue"],
        code: `colony.research.queue("planter");
bot.harvester.harvest();
bot.move("east");
if ((bot.inventory().wheat ?? 0) >= 10) {
  while (bot.pos().y !== 17) bot.move(bot.pos().y > 17 ? "north" : "south");
  while (bot.pos().x !== 17) bot.move(bot.pos().x > 17 ? "west" : "east");
  bot.move("north");
  bot.deposit("west", "wheat", 10);
}`,
      },
      {
        title: "Now do all of it, forever",
        blurb:
          "Everything above, wrapped in a loop that never ends. This is the last time you press Run for one trip.",
        prompt: "You have written the same four lines five times. Let the bot do that part.",
        practice: true,
        introduces: [],
        // The turn has to flip the direction as well as drop a row. Without the
        // flip this walked east into the world's edge and then straight down it
        // forever — `stuck — 722 commands got nowhere`, research frozen at 7/10.
        // Found by running the finale, which is the one chip a player is most
        // likely to leave running and least likely to read.
        code: `colony.research.queue("planter");
let goingEast = true;
while (true) {
  bot.harvester.harvest();
  if (!bot.move(goingEast ? "east" : "west")) {
    bot.move("south");
    goingEast = !goingEast;
  }
  if ((bot.inventory().wheat ?? 0) >= 10) {
    while (bot.pos().y !== 17) bot.move(bot.pos().y > 17 ? "north" : "south");
    while (bot.pos().x !== 17) bot.move(bot.pos().x > 17 ? "west" : "east");
    bot.move("north");
    bot.deposit("west", "wheat", 10);
  }
}`,
      },
    ],
  },
  {
    id: "field-loop",
    name: "The field loop",
    rungs: [
      {
        title: "Harvest in a loop",
        blurb: "Cycle one. The first thing to reach for when pressing Run gets old.",
        introduces: ["while", "harvest", "move"],
        code: `while (true) {
  bot.harvester.harvest();
  bot.move("east");
}`,
      },
      {
        title: "Stay on the field",
        blurb: "move() returns false when something is in the way. Turn around instead of pushing into it.",
        introduces: ["if"],
        // A `let dir = "east"` variable widens to `string`, which the editor then
        // refuses to pass to move(). Choosing the direction inline keeps it a
        // literal, and spares a beginner an error they did nothing to deserve.
        code: `let goingEast = true;
while (true) {
  bot.harvester.harvest();
  if (!bot.move(goingEast ? "east" : "west")) {
    goingEast = !goingEast;
  }
}`,
      },
      {
        title: "Sweep the whole field",
        blurb: "Serpentine: run a row, drop down, run the next one back the other way. Stops when full.",
        introduces: ["inventory"],
        code: `let goingEast = true;
while ((bot.inventory().wheat ?? 0) < ${BOT_CAPACITY}) {
  bot.harvester.harvest();
  if (!bot.move(goingEast ? "east" : "west")) {
    bot.move("south");
    goingEast = !goingEast;
  }
}
bot.log("full — somewhere to put this would help");`,
      },
    ],
  },
  {
    id: "knowing",
    name: "Knowing where you are",
    rungs: [
      {
        title: "Where am I?",
        blurb: "Position and inventory are free to read — they cost no simulated time.",
        introduces: ["pos", "log"],
        code: `const here = bot.pos();
bot.log("at " + here.x + "," + here.y);
bot.log("carrying " + (bot.inventory().wheat ?? 0) + " wheat");`,
      },
      {
        title: "Don't overfill",
        // The number is imported rather than typed, and the sentence changed with
        // milestone 10: a full harvest used to throw and now answers false, so a
        // chip promising an exception was teaching a control flow that no longer
        // exists. The `.d.ts` hover says the same thing, from the same constant.
        blurb: `A bot carries ${BOT_CAPACITY} in total. harvest() just answers false once it is full, so stop and go somewhere.`,
        introduces: ["inventory", "while"],
        code: `while ((bot.inventory().wheat ?? 0) < ${BOT_CAPACITY}) {
  bot.harvester.harvest();
  bot.move("east");
}
bot.log("full at " + bot.pos().x + "," + bot.pos().y);`,
      },
    ],
  },
  {
    id: "research",
    name: "Buying the next thing",
    rungs: [
      {
        title: "Queue some research",
        blurb: "Research is spent wheat. Queue it and keep farming.",
        introduces: ["queue"],
        code: `colony.research.queue("planter");`,
      },
      {
        title: "Wait for a research",
        blurb: "status() is how a script knows a thing arrived, instead of guessing at a wait.",
        introduces: ["status", "wait", "while"],
        code: `colony.research.queue("conveyor");
while (!colony.research.status().unlocked.includes("conveyor")) {
  bot.wait(20);
}
bot.log("belts unlocked");`,
      },
    ],
  },
  {
    id: "hauling",
    name: "Somewhere to put it",
    needsMachine: "crate",
    rungs: [
      {
        title: "Empty into a crate",
        blurb: "Deposit into the machine on one side of you. Fails if nothing is there.",
        introduces: ["deposit", "inventory", "if"],
        code: `const carried = bot.inventory().wheat ?? 0;
if (carried > 0) {
  bot.deposit("north", "wheat", carried);
}`,
      },
    ],
  },
  {
    id: "growing",
    name: "Growing it back",
    requires: "planter",
    rungs: [
      {
        title: "Harvest, then replant",
        blurb: "Planting costs one wheat from your own inventory, so harvest first.",
        introduces: ["plant", "if", "while"],
        code: `while (true) {
  if (bot.harvester.harvest()) {
    bot.planter.plant("wheat");
  }
  bot.move("east");
}`,
      },
    ],
  },
  {
    id: "seeing",
    name: "Looking around",
    requires: "scanner",
    rungs: [
      {
        title: "Look before you move",
        blurb: "Scan returns the tiles around you, each with its crop, bot and machine.",
        introduces: ["scan", "for"],
        code: `for (const tile of bot.scanner.scan(2)) {
  if (tile.crop) {
    bot.log("crop at " + tile.x + "," + tile.y);
  }
}`,
      },
    ],
  },
  {
    id: "building",
    name: "Laying it out",
    requires: "builder",
    rungs: [
      {
        title: "Lay a line of belts",
        blurb: "Cycle three. place() faces the belt the way you are walking, so a line is a loop.",
        introduces: ["place", "for"],
        code: `for (let i = 0; i < 5; i++) {
  bot.builder.place("conveyor", "north");
  bot.move("north");
}`,
      },
      {
        title: "Stamp a layout",
        blurb:
          "Cycle four. Write this in the Library, not in a bot, and every bot can stamp it.",
        // The design's blueprints, and deliberately **not** an engine feature:
        // research hands out primitives and capacity, and every higher-level
        // function is player-authored. `bot.builder.place` is the primitive; this
        // is what a player builds on top of it, and the only thing milestone 9
        // added was somewhere to put it so that more than one bot can call it.
        introduces: ["function"],
        code: `function stamp(layout) {
  for (const step of layout) {
    bot.builder.place(step.machine, step.dir, step.facing);
    bot.move(step.dir);
  }
}

// Then, from any bot:
// stamp([
//   { machine: "conveyor", dir: "east", facing: "east" },
//   { machine: "conveyor", dir: "east", facing: "east" },
// ]);`,
      },
    ],
  },
  {
    id: "talking",
    name: "Taking orders",
    requires: "radio",
    rungs: [
      {
        title: "Take orders by radio",
        blurb: "receive() blocks this bot until a message arrives. Others keep running.",
        introduces: ["receive", "while"],
        code: `while (true) {
  const order = bot.radio.receive("haul");
  bot.log("order from bot " + order.from);
}`,
      },
    ],
  },
];

/**
 * Everything a rung and the rungs beneath it introduce.
 *
 * Cumulative, which is what "the chip builds on itself" means: rung three of the
 * field loop is not reachable by somebody who has used `inventory()` and never
 * written a loop, because rung three *is* rungs one and two plus a condition.
 */
export function needsFor(ladder: Ladder, index: number): Primitive[] {
  const needed = new Set<Primitive>();
  for (const rung of ladder.rungs.slice(0, index + 1)) {
    for (const p of rung.introduces) needed.add(p);
  }
  return [...needed];
}

export interface Snippet {
  title: string;
  blurb: string;
  code: string;
  requires?: Ladder["requires"];
  needsMachine?: Ladder["needsMachine"];
}

/**
 * Every rung, flat.
 *
 * Derived rather than maintained: the suggestion rules look a chip up by title,
 * and the test that compiles every chip against the shipped API wants one list.
 * Neither should have to know that the book has a shape.
 */
export const SNIPPETS: Snippet[] = LADDERS.flatMap((ladder) =>
  ladder.rungs.map((rung) => ({
    title: rung.title,
    blurb: rung.blurb,
    code: rung.code,
    requires: ladder.requires,
    needsMachine: ladder.needsMachine,
  })),
);
