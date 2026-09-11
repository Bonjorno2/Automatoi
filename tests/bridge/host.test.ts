import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { Colony } from "../../src/bridge/host.ts";
import { ctrlOf, mirrorOf } from "../../src/bridge/protocol.ts";
import { readMirror } from "../../src/bridge/mirror.ts";
import { postRequest, takeReply } from "./helpers";

function colony(): { c: Colony; sab: SharedArrayBuffer } {
  const c = new Colony({ world: new World({ seed: 1 }) });
  return { c, sab: c.attach(1) };
}

describe("Colony request servicing", () => {
  it("resolves a move after exactly its tick cost", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "command", command: { kind: "move", dir: "east" } });
    c.pump();
    expect(takeReply(sab)).toEqual({ ok: true, value: true });
    expect(c.world.time).toBe(TICK_COST.move);
    expect(c.world.getBot(1).pos).toEqual({ x: 18, y: 16 });
  });

  it("does not advance time while nothing is in flight", () => {
    const { c } = colony();
    c.pump();
    c.pump();
    expect(c.world.time).toBe(0);
  });

  it("resolves an immediate module failure without spending a tick", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "command", command: { kind: "scan", radius: 1 } });
    c.pump();
    expect(takeReply(sab)).toEqual({ ok: false, value: "Bot 1 has no Scanner module" });
    expect(c.world.time).toBe(0);
  });

  it("answers a colony time query without spending a tick", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "command", command: { kind: "move", dir: "east" } });
    c.pump();
    takeReply(sab);
    postRequest(sab, { kind: "colony", call: "time" });
    c.pump();
    expect(takeReply(sab)).toEqual({ ok: true, value: TICK_COST.move });
    expect(c.world.time).toBe(TICK_COST.move);
  });

  it("answers a colony bots query with every bot's readable state", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "colony", call: "bots" });
    c.pump();
    const reply = takeReply(sab)!;
    expect(reply.ok).toBe(true);
    const bots = reply.value as Array<{ id: number; pos: { x: number; y: number } }>;
    expect(bots).toHaveLength(1);
    expect(bots[0]!.id).toBe(1);
    expect(bots[0]!.pos).toEqual({ x: 17, y: 16 });
  });

  it("queues research on request", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "research", name: "planter" });
    c.pump();
    expect(takeReply(sab)).toEqual({ ok: true, value: null });
    expect(c.world.research.queue).toEqual(["planter"]);
  });

  it("turns a thrown host error into a failed reply", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "research", name: "planter" });
    c.pump();
    takeReply(sab);
    postRequest(sab, { kind: "research", name: "planter" });
    c.pump();
    expect(takeReply(sab)).toEqual({ ok: false, value: "planter already queued" });
  });
});

describe("Colony mirror", () => {
  it("publishes readable state on attach, before any tick", () => {
    const { sab } = colony();
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual({
      time: 0,
      pos: { x: 17, y: 16 },
      inventory: {},
      modules: ["harvester"],
      busy: false,
    });
  });

  it("republishes as the world changes", () => {
    const { c, sab } = colony();
    postRequest(sab, { kind: "command", command: { kind: "move", dir: "east" } });
    c.pump();
    const m = readMirror(ctrlOf(sab), mirrorOf(sab)) as { time: number; pos: { x: number } };
    expect(m.pos.x).toBe(18);
    expect(m.time).toBe(TICK_COST.move);
  });

  it("throws rather than looping forever when a command never resolves", () => {
    const c = new Colony({ world: new World({ seed: 1 }) });
    const sab = c.attach(1);
    c.world.getBot(1).modules.add("radio");
    postRequest(sab, { kind: "command", command: { kind: "receive" } });
    expect(() => c.pump(50)).toThrow("pump exceeded 50 ticks");
  });
});
