export type Direction = "north" | "south" | "east" | "west";
export type Terrain = "grass" | "soil";
export type Item = "wheat";
export type ModuleName = "harvester" | "planter" | "scanner" | "radio";
export type MachineKind = "console" | "crate";
export type ResearchName = "planter" | "scanner" | "crate" | "chassis" | "radio";

export interface Vec {
  x: number;
  y: number;
}

export interface Crop {
  item: Item;
  /** Ticks grown so far. Mature when >= WHEAT_GROWTH_TICKS. */
  growth: number;
}

export interface Tile {
  terrain: Terrain;
  crop: Crop | null;
}

export type Inventory = Partial<Record<Item, number>>;

export interface Message {
  channel: string;
  payload: unknown;
  from: number;
}

export type Command =
  | { kind: "wait"; ticks: number }
  | { kind: "move"; dir: Direction }
  | { kind: "harvest" }
  | { kind: "plant"; item: Item }
  | { kind: "scan"; radius: number }
  | { kind: "deposit"; dir: Direction; item: Item; count: number }
  | { kind: "withdraw"; dir: Direction; item: Item; count: number }
  | { kind: "send"; channel: string; payload: unknown }
  | { kind: "receive"; channel?: string };

export type CommandResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export interface Action {
  command: Command;
  remaining: number;
  /**
   * Ticks this action started with. The sim never reads it; a renderer needs it
   * to know how far through a move a bot is, and `remaining` alone cannot say.
   */
  total: number;
}

export type BlockedOn = "bot" | "radio" | null;

export interface Bot {
  id: number;
  pos: Vec;
  inventory: Inventory;
  modules: Set<ModuleName>;
  action: Action | null;
  result: CommandResult | null;
  inbox: Message[];
  blockedOn: BlockedOn;
}

export interface Machine {
  id: number;
  kind: MachineKind;
  pos: Vec;
  inventory: Inventory;
}

export interface ScanTile {
  x: number;
  y: number;
  terrain: Terrain;
  crop: Crop | null;
  bot: number | null;
  machine: MachineKind | null;
}

export interface ResearchState {
  unlocked: Set<ResearchName>;
  queue: ResearchName[];
  progress: number;
  spareModules: Partial<Record<ModuleName, number>>;
  spareChassis: number;
}

/** What a bot is part-way through, for anything that has to draw it. */
export interface ActionSnapshot {
  kind: Command["kind"];
  /** Only a move has one. */
  dir: Direction | null;
  remaining: number;
  total: number;
}

export interface BotSnapshot {
  id: number;
  pos: Vec;
  inventory: Inventory;
  modules: ModuleName[];
  busy: boolean;
  blockedOn: BlockedOn;
  action: ActionSnapshot | null;
}

export interface MachineSnapshot {
  id: number;
  kind: MachineKind;
  pos: Vec;
  inventory: Inventory;
  /**
   * Wants input it has not got. A state rather than an event, so whatever is
   * drawing the world can show it for as long as it lasts without tracking
   * edges of its own.
   */
  starved: boolean;
}

export interface ResearchSnapshot {
  unlocked: ResearchName[];
  queue: ResearchName[];
  progress: number;
  spareModules: Partial<Record<ModuleName, number>>;
  spareChassis: number;
}

export interface WorldSnapshot {
  seed: number;
  width: number;
  height: number;
  time: number;
  tiles: Tile[];
  bots: BotSnapshot[];
  machines: MachineSnapshot[];
  research: ResearchSnapshot;
}
