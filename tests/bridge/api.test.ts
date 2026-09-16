import { Worker } from "node:worker_threads";
import { createChannel, ctrlOf, mirrorOf, reqOf, readFrame,
  IDLE, REQ_LEN, STATE } from "../../src/bridge/protocol.ts";
import type { HostRequest } from "../../src/bridge/protocol.ts";
import { publishMirror } from "../../src/bridge/mirror.ts";
import { makeApi } from "../../src/bridge/api.ts";

const MIRROR = {
  time: 9,
  pos: { x: 17, y: 16 },
  inventory: { wheat: 3 },
  modules: ["harvester"],
  busy: false,
};

/**
 * Start a worker that answers the next `replies` requests, as the host would.
 * Resolves once the worker is loaded, so the caller may safely block afterwards.
 */
async function answerWith(
  sab: SharedArrayBuffer,
  ok: boolean,
  value: unknown,
  replies = 1,
): Promise<Worker> {
  const worker = new Worker(new URL("./responder-worker.ts", import.meta.url), {
    workerData: { sab, ok, value, replies },
  });
  await new Promise<void>((resolve, reject) => {
    worker.once("message", () => resolve());
    worker.once("error", reject);
  });
  return worker;
}

function lastRequest(sab: SharedArrayBuffer): HostRequest {
  return readFrame(reqOf(sab), Atomics.load(ctrlOf(sab), REQ_LEN)) as HostRequest;
}

/** A channel with its mirror already published, as `Colony.attach` leaves it. */
function channel(): SharedArrayBuffer {
  const sab = createChannel();
  publishMirror(ctrlOf(sab), mirrorOf(sab), MIRROR);
  return sab;
}

describe("free reads", () => {
  it("reads pos and inventory from the mirror without posting a request", () => {
    const sab = channel();
    const { bot } = makeApi(sab, 1);
    expect(bot.pos()).toEqual({ x: 17, y: 16 });
    expect(bot.inventory()).toEqual({ wheat: 3 });
    expect(Atomics.load(ctrlOf(sab), STATE)).toBe(IDLE);
  });
});

describe("blocking calls", () => {
  it("move posts a move command and returns the host's answer", async () => {
    const sab = channel();
    const { bot } = makeApi(sab, 1);
    const worker = await answerWith(sab, true, true);
    try {
      expect(bot.move("east")).toBe(true);
      expect(lastRequest(sab)).toEqual({ kind: "command", command: { kind: "move", dir: "east" } });
      expect(Atomics.load(ctrlOf(sab), STATE)).toBe(IDLE);
    } finally {
      await worker.terminate();
    }
  }, 10_000);

  it("throws the host's message when a call fails", async () => {
    const sab = channel();
    const { bot } = makeApi(sab, 1);
    const worker = await answerWith(sab, false, "Bot 1 has no Scanner module");
    try {
      expect(() => bot.scanner!.scan(1)).toThrow("Bot 1 has no Scanner module");
    } finally {
      await worker.terminate();
    }
  }, 10_000);

  it("names each namespaced verb correctly", async () => {
    const workers: Worker[] = [];
    const mk = async () => {
      const sab = channel();
      workers.push(await answerWith(sab, true, null));
      return { sab, api: makeApi(sab, 1) };
    };
    try {
      const a = await mk(); a.api.bot.harvester!.harvest();
      expect(lastRequest(a.sab)).toEqual({ kind: "command", command: { kind: "harvest" } });
      const b = await mk(); b.api.bot.planter!.plant("wheat");
      expect(lastRequest(b.sab)).toEqual({ kind: "command", command: { kind: "plant", item: "wheat" } });
      const c = await mk(); c.api.bot.radio!.send("haul", { x: 1 });
      expect(lastRequest(c.sab)).toEqual({ kind: "command", command: { kind: "send", channel: "haul", payload: { x: 1 } } });
      const d = await mk(); d.api.colony.research.queue("planter");
      expect(lastRequest(d.sab)).toEqual({ kind: "research", name: "planter" });
      const e = await mk(); e.api.bot.builder!.place("conveyor", "north");
      expect(lastRequest(e.sab)).toEqual({
        kind: "command",
        command: { kind: "place", machine: "conveyor", dir: "north", facing: undefined },
      });
      const f = await mk(); f.api.bot.builder!.place("conveyor", "north", "east");
      expect(lastRequest(f.sab)).toEqual({
        kind: "command",
        command: { kind: "place", machine: "conveyor", dir: "north", facing: "east" },
      });
      const g = await mk(); g.api.bot.builder!.remove("south");
      expect(lastRequest(g.sab)).toEqual({
        kind: "command",
        command: { kind: "remove", dir: "south" },
      });
      // Its own request kind rather than a shape change to `research`, which
      // would have rippled through every test in this file.
      const h = await mk(); h.api.colony.research.status();
      expect(lastRequest(h.sab)).toEqual({ kind: "research-status" });
    } finally {
      await Promise.all(workers.map((w) => w.terminate()));
    }
  }, 10_000);
});

describe("module namespaces", () => {
  it("exist at runtime even when the chassis lacks the module", () => {
    // MIRROR carries the harvester alone, as a freshly landed bot does.
    const { bot } = makeApi(channel(), 1);
    expect(bot.harvester).toBeDefined();
    expect(bot.scanner).toBeDefined();
    expect(bot.planter).toBeDefined();
    expect(bot.radio).toBeDefined();
    expect(bot.builder).toBeDefined();
  });

  it("lets the sim be the one that says a module is missing", async () => {
    // The asymmetry api.ts documents at length: optional in the type, present
    // at runtime, because a genuinely undefined namespace would replace the
    // design's promised message with a bare TypeError from the engine.
    const sab = channel();
    const { bot } = makeApi(sab, 1);
    const worker = await answerWith(sab, false, "Bot 1 has no Builder module");
    try {
      expect(() => bot.builder!.place("conveyor", "north")).toThrow(
        "Bot 1 has no Builder module",
      );
    } finally {
      await worker.terminate();
    }
  }, 10_000);
});
