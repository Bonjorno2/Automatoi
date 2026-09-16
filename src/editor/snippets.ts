/**
 * The snippet book's contents.
 *
 * The design doc promises this in "The abstraction rhythm": *"A snippet library
 * exists for beginners to copy from; veterans ignore it."* Every chip here is
 * one of the patterns that doc already names as cycle 1 or cycle 2 — this is
 * not a curriculum invented alongside it.
 *
 * It copies text. It is not the Shared Library upgrade, which brings `import`
 * between scripts, arrives deliberately late, and is out of first-playable
 * scope. If this file starts growing toward a module system, stop.
 */
export interface Snippet {
  title: string;
  /** One line on what it is for, and what it teaches. */
  blurb: string;
  code: string;
  /** A module the starting chassis does not have, if this chip needs one. */
  requires?: "planter" | "scanner" | "radio" | "builder";
  /** A machine that has to be standing next to the bot, if this chip needs one. */
  needsMachine?: "crate";
}

export const SNIPPETS: Snippet[] = [
  {
    title: "Harvest in a loop",
    blurb: "Cycle one. The first thing to reach for when pressing Run gets old.",
    code: `while (true) {
  bot.harvester.harvest();
  bot.move("east");
}`,
  },
  {
    title: "Stay on the field",
    blurb: "move() returns false when something is in the way. Turn around instead of pushing into it.",
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
    title: "Don't overfill",
    blurb: "A bot carries 10. harvest() throws once it is full, so stop before that.",
    code: `while ((bot.inventory().wheat ?? 0) < 10) {
  bot.harvester.harvest();
  bot.move("east");
}
bot.log("full at " + bot.pos().x + "," + bot.pos().y);`,
  },
  {
    title: "Sweep the whole field",
    blurb: "Serpentine: run a row, drop down, run the next one back the other way. Stops when full.",
    code: `let goingEast = true;
while ((bot.inventory().wheat ?? 0) < 10) {
  bot.harvester.harvest();
  if (!bot.move(goingEast ? "east" : "west")) {
    bot.move("south");
    goingEast = !goingEast;
  }
}
bot.log("full — somewhere to put this would help");`,
  },
  {
    title: "Where am I?",
    blurb: "Position and inventory are free to read — they cost no simulated time.",
    code: `const here = bot.pos();
bot.log("at " + here.x + "," + here.y);
bot.log("carrying " + (bot.inventory().wheat ?? 0) + " wheat");`,
  },
  {
    title: "Queue some research",
    blurb: "Research is spent wheat. Queue it and keep farming.",
    code: `colony.research.queue("planter");`,
  },
  {
    title: "Harvest, then replant",
    blurb: "Planting costs one wheat from your own inventory, so harvest first.",
    requires: "planter",
    code: `while (true) {
  if (bot.harvester.harvest()) {
    bot.planter.plant("wheat");
  }
  bot.move("east");
}`,
  },
  {
    title: "Look before you move",
    blurb: "Scan returns the tiles around you, each with its crop, bot and machine.",
    requires: "scanner",
    code: `for (const tile of bot.scanner.scan(2)) {
  if (tile.crop) {
    bot.log("crop at " + tile.x + "," + tile.y);
  }
}`,
  },
  {
    title: "Empty into a crate",
    blurb: "Deposit into the machine on one side of you. Fails if nothing is there.",
    needsMachine: "crate",
    code: `const carried = bot.inventory().wheat ?? 0;
if (carried > 0) {
  bot.deposit("north", "wheat", carried);
}`,
  },
  {
    title: "Lay a line of belts",
    blurb: "Cycle three. place() faces the belt the way you are walking, so a line is a loop.",
    requires: "builder",
    code: `for (let i = 0; i < 5; i++) {
  bot.builder.place("conveyor", "north");
  bot.move("north");
}`,
  },
  {
    title: "Wait for a research",
    blurb: "status() is how a script knows a thing arrived, instead of guessing at a wait.",
    code: `colony.research.queue("conveyor");
while (!colony.research.status().unlocked.includes("conveyor")) {
  bot.wait(20);
}
bot.log("belts unlocked");`,
  },
  {
    title: "Take orders by radio",
    blurb: "receive() blocks this bot until a message arrives. Others keep running.",
    requires: "radio",
    code: `while (true) {
  const order = bot.radio.receive("haul");
  bot.log("order from bot " + order.from);
}`,
  },
];
