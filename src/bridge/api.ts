import type { Direction, Item, Message, ResearchName, ScanTile } from "../sim/types";
import {
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  ctrlOf, mirrorOf, readFrame, reqOf, resOf, writeFrame,
} from "./protocol.ts";
import type { HostRequest, MirrorState } from "./protocol.ts";
import { readMirror } from "./mirror.ts";

export interface BotApi {
  move(dir: Direction): boolean;
  wait(ticks: number): void;
  pos(): { x: number; y: number };
  inventory(): Record<string, number | undefined>;
  log(message: string): void;
  deposit(dir: Direction, item: Item, count: number): number;
  withdraw(dir: Direction, item: Item, count: number): number;
  harvester: { harvest(): boolean };
  planter: { plant(item: Item): boolean };
  scanner: { scan(radius: number): ScanTile[] };
  radio: { send(channel: string, payload: unknown): number; receive(channel?: string): Message };
}

export interface ColonyApi {
  bots(): Array<MirrorState & { id: number }>;
  time(): number;
  research: { queue(name: ResearchName): void };
}

/** Posted to the host thread out of band; logging never blocks the script. */
export type LogMessage = { kind: "log"; botId: number; message: string };

export function makeApi(
  sab: SharedArrayBuffer,
  botId: number,
  onLog: (m: LogMessage) => void = () => {},
): { bot: BotApi; colony: ColonyApi } {
  const ctrl = ctrlOf(sab);
  const req = reqOf(sab);
  const res = resOf(sab);
  const mirror = mirrorOf(sab);

  /** Post a request and park until the host answers. */
  function call(request: HostRequest): unknown {
    Atomics.store(ctrl, REQ_LEN, writeFrame(req, request));
    Atomics.store(ctrl, STATE, REQUEST);
    Atomics.notify(ctrl, STATE);
    while (Atomics.load(ctrl, STATE) !== RESULT) Atomics.wait(ctrl, STATE, REQUEST);
    const ok = Atomics.load(ctrl, RES_OK) === 1;
    const value = readFrame(res, Atomics.load(ctrl, RES_LEN));
    Atomics.store(ctrl, STATE, IDLE);
    if (!ok) throw new Error(String(value));
    return value;
  }

  const read = (): MirrorState => readMirror(ctrl, mirror) as MirrorState;

  const bot: BotApi = {
    move: (dir) => call({ kind: "command", command: { kind: "move", dir } }) as boolean,
    wait: (ticks) => void call({ kind: "command", command: { kind: "wait", ticks } }),
    pos: () => read().pos,
    inventory: () => read().inventory,
    log: (message) => onLog({ kind: "log", botId, message }),
    deposit: (dir, item, count) =>
      call({ kind: "command", command: { kind: "deposit", dir, item, count } }) as number,
    withdraw: (dir, item, count) =>
      call({ kind: "command", command: { kind: "withdraw", dir, item, count } }) as number,
    harvester: {
      harvest: () => call({ kind: "command", command: { kind: "harvest" } }) as boolean,
    },
    planter: {
      plant: (item) => call({ kind: "command", command: { kind: "plant", item } }) as boolean,
    },
    scanner: {
      scan: (radius) => call({ kind: "command", command: { kind: "scan", radius } }) as ScanTile[],
    },
    radio: {
      send: (channel, payload) =>
        call({ kind: "command", command: { kind: "send", channel, payload } }) as number,
      receive: (channel) =>
        call({ kind: "command", command: { kind: "receive", channel } }) as Message,
    },
  };

  const colony: ColonyApi = {
    bots: () => call({ kind: "colony", call: "bots" }) as Array<MirrorState & { id: number }>,
    time: () => call({ kind: "colony", call: "time" }) as number,
    research: { queue: (name) => void call({ kind: "research", name }) },
  };

  return { bot, colony };
}
