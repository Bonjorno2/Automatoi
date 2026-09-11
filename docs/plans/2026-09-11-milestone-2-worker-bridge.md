# Milestone 2: Worker Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A real JavaScript player script, running in its own worker, drives a bot in the milestone-1 sim through blocking calls like `bot.move("east")` — verified entirely headlessly with Vitest, with no browser, no renderer and no editor.

**Architecture:** Every bot gets one `SharedArrayBuffer` channel. A blocking call writes a JSON request into the channel and parks on `Atomics.wait`. The host, which owns the `World`, decodes the request, hands it to `world.issue()`, advances time with `world.tick()`, and on `world.takeResult()` writes the result back and calls `Atomics.notify`, waking the script. Reads like `bot.pos()` never round-trip at all: the host republishes each bot's readable state into a seqlock-protected mirror region every tick, and the worker reads that region directly.

**Tech Stack:** TypeScript 5 (strict, ESM), Vitest 2, `node:worker_threads`. No runtime dependencies. **Node 22.18+ or 24+ required** — see "The Node version floor" below.

**Design reference:** `docs/plans/2026-09-11-automatori-design.md`, sections "API shape", "Architecture" and "Failure is content". **Milestone 1 reference:** `docs/plans/2026-09-11-milestone-1-sim-core.md`. The sim is complete and its public surface does not change in this milestone; if you find yourself wanting to change it, stop and say so — the milestone-1 plan calls that out as a design finding worth recording.

---

## Decisions already made

These were settled before this plan was written. Do not relitigate them mid-task.

1. **Headless Node only.** Tests drive real workers through `node:worker_threads`. `SharedArrayBuffer` and `Atomics.wait` work there natively with no COOP/COEP headers — that requirement is browser-only and arrives with milestone 3. There is no browser page, no dev server and no manual verification in this milestone.
2. **Reads are free.** `bot.pos()` and `bot.inventory()` cost zero ticks and do not round-trip. `colony.bots()` and `colony.time()` do round-trip, because they read across bots, but still cost zero ticks.
3. **A minimal watchdog ships in this milestone.** A worker that runs too long without a world call is terminated. Without it, one runaway test script hangs the whole Vitest run. The "hung" icon and the editor message belong to milestones 3 and 4; only the mechanism is in scope here.

---

## Two facts about the toolchain that this plan depends on

Both were verified empirically before this plan was written. They are not assumptions.

### The Node version floor

The worker entry point is a `.ts` file loaded directly by `new Worker(url)`. Node runs it by stripping types, which is unflagged only from **Node 22.18+ and 23.6+**. Milestone 1's plan said "Node 20+"; this milestone raises that floor. If Node 20 support ever matters, the fallback is to precompile the worker or write its entry in plain `.mjs` — do not do that now.

### The import rule, which is load-bearing

Node's TypeScript support does **not** resolve extensionless imports. `import { x } from "./rng"` fails under Node and works under Vite, so the sim's own files cannot be loaded by a worker.

Three rules follow. Getting these wrong produces `ERR_MODULE_NOT_FOUND` at worker startup, which surfaces as a confusing test hang rather than a clean error:

1. **Every import inside `src/bridge/` uses an explicit `.ts` extension.** This requires `allowImportingTsExtensions` in `tsconfig.json`, added in Task 1. Vite, `tsc` and Node all accept it.
2. **Files in the worker's import graph — `worker-entry.ts`, `api.ts`, `mirror.ts`, `protocol.ts` — must never runtime-import anything from `src/sim/`.** They may import *types* from it freely (next rule).
3. **`import type` is exempt.** Type-only imports are erased before Node ever tries to resolve them — verified against a module that does not exist on disk. So `import type { Command } from "../sim/types"` is fine anywhere, extensionless.

`host.ts` is *not* in the worker's import graph. It runs under Vitest and may import `../sim/world` extensionless like any other file.

---

## Conventions for every task

- Bridge source lives in `src/bridge/`. Tests live in `tests/bridge/` and mirror the source file name.
- Run one test file with `npx vitest run tests/bridge/<name>.test.ts`. Run everything with `npm test`.
- Run `npm run typecheck` before every commit. A commit with type errors is a failed step.
- Commit after each task with the message given. Do not batch tasks into one commit.
- **Every test that spawns a worker takes an explicit timeout** as the third argument to `it(...)`, and **terminates its worker in a `finally`**. A test that leaks a blocked worker hangs the suite.
- Never add a feature a later task does not ask for.

## Domain vocabulary

- **Channel.** One `SharedArrayBuffer` shared between the host and one bot's worker.
- **Frame.** A JSON payload written into a byte region of a channel, with its length in a control slot.
- **Mirror.** A frame the host rewrites every tick holding a bot's readable state. Read lock-free by the worker.
- **Seqlock.** A counter that is odd while a write is in progress. A reader that sees an odd value, or a value that changed across its read, tries again.
- **In flight.** A bot has an in-flight action when `bot.action !== null`, i.e. the sim is counting down a command.

## How time advances, and why it is demand-driven

**The host only calls `world.tick()` when at least one bot has an in-flight action.** While every script is merely computing, the world stands still.

This is deliberate and it is what makes the milestone testable: a script that reads `bot.pos()` a thousand times advances the clock by exactly zero, and the reference script in Task 12 reproduces milestone 1's measured tick counts exactly. Real-time pacing — ticking at 60 Hz whether or not anyone asked — is a milestone 3 and 4 concern, when there is a renderer whose frame budget makes it meaningful.

---

### Task 1: Toolchain for worker-loadable TypeScript

Proves a `.ts` worker can be spawned from inside a Vitest test and blocked on `Atomics.wait`, before any real code depends on it.

**Files:**
- Modify: `tsconfig.json`
- Modify: `package.json`
- Create: `src/bridge/handshake-worker.ts`
- Test: `tests/bridge/toolchain.test.ts`

**Step 1: Add `allowImportingTsExtensions` to `tsconfig.json`**

Add the one option to `compilerOptions`, leaving everything else alone:

```json
    "allowImportingTsExtensions": true
```

It is legal only alongside `noEmit`, which is already set.

**Step 2: Record the Node floor in `package.json`**

Add an `engines` block after `"private": true`:

```json
  "engines": {
    "node": ">=22.18"
  },
```

**Step 3: Write the failing test at `tests/bridge/toolchain.test.ts`**

```ts
import { Worker } from "node:worker_threads";

describe("worker toolchain", () => {
  it("spawns a .ts worker that blocks on Atomics.wait", async () => {
    const sab = new SharedArrayBuffer(8);
    const ctrl = new Int32Array(sab);
    const url = new URL("../../src/bridge/handshake-worker.ts", import.meta.url);
    const worker = new Worker(url, { workerData: { sab } });
    try {
      const got = await new Promise<number>((resolve, reject) => {
        worker.on("message", (m) => resolve(m.got));
        worker.on("error", reject);
        const timer = setInterval(() => {
          if (Atomics.load(ctrl, 0) === 1) {
            Atomics.store(ctrl, 1, Atomics.load(ctrl, 1) * 2);
            Atomics.store(ctrl, 0, 2);
            Atomics.notify(ctrl, 0);
            clearInterval(timer);
          }
        }, 1);
      });
      expect(got).toBe(84);
    } finally {
      await worker.terminate();
    }
  }, 15_000);
});
```

**Step 4: Run test to verify it fails**

Run: `npx vitest run tests/bridge/toolchain.test.ts`
Expected: FAIL — the worker file does not exist yet.

**Step 5: Create `src/bridge/handshake-worker.ts`**

```ts
import { parentPort, workerData } from "node:worker_threads";

const { sab } = workerData as { sab: SharedArrayBuffer };
const ctrl = new Int32Array(sab);

Atomics.store(ctrl, 1, 42);
Atomics.store(ctrl, 0, 1);
Atomics.notify(ctrl, 0);
while (Atomics.load(ctrl, 0) !== 2) Atomics.wait(ctrl, 0, 1);
parentPort!.postMessage({ got: Atomics.load(ctrl, 1) });
```

**Step 6: Run tests and typecheck**

Run: `npx vitest run tests/bridge/toolchain.test.ts`
Expected: `1 passed`

Run: `npm test`
Expected: 73 passed — milestone 1's 72 plus this one.

Run: `npm run typecheck`
Expected: exit 0

**Step 7: Commit**

```bash
git add tsconfig.json package.json src/bridge tests/bridge
git commit -m "chore(bridge): enable .ts worker loading and prove the handshake"
```

---

### Task 2: Channel layout and framing

The whole protocol's vocabulary. Pure functions over a buffer, no workers, no sim.

**Files:**
- Create: `src/bridge/protocol.ts`
- Test: `tests/bridge/protocol.test.ts`

**Step 1: Write the failing test**

```ts
import {
  CHANNEL_BYTES, CTRL_SLOTS, MIRROR_BYTES, REQ_BYTES, RES_BYTES,
  createChannel, ctrlOf, mirrorOf, readFrame, reqOf, resOf, writeFrame,
} from "../../src/bridge/protocol.ts";

describe("channel layout", () => {
  it("sizes the buffer to hold every region", () => {
    expect(CHANNEL_BYTES).toBe(CTRL_SLOTS * 4 + REQ_BYTES + RES_BYTES + MIRROR_BYTES);
    expect(createChannel().byteLength).toBe(CHANNEL_BYTES);
  });

  it("hands out non-overlapping views of the right size", () => {
    const sab = createChannel();
    expect(ctrlOf(sab)).toHaveLength(CTRL_SLOTS);
    expect(reqOf(sab)).toHaveLength(REQ_BYTES);
    expect(resOf(sab)).toHaveLength(RES_BYTES);
    expect(mirrorOf(sab)).toHaveLength(MIRROR_BYTES);
    // Writing one region must not disturb its neighbours.
    reqOf(sab).fill(1);
    expect(resOf(sab).every((b) => b === 0)).toBe(true);
    expect(mirrorOf(sab).every((b) => b === 0)).toBe(true);
    expect(ctrlOf(sab).every((v) => v === 0)).toBe(true);
  });
});

describe("frames", () => {
  it("round-trips an object", () => {
    const bytes = reqOf(createChannel());
    const value = { kind: "move", dir: "east", n: -3, deep: { a: [1, 2] } };
    const len = writeFrame(bytes, value);
    expect(readFrame(bytes, len)).toEqual(value);
  });

  it("round-trips null and undefined as null", () => {
    const bytes = reqOf(createChannel());
    expect(readFrame(bytes, writeFrame(bytes, null))).toBeNull();
    expect(readFrame(bytes, writeFrame(bytes, undefined))).toBeNull();
  });

  it("round-trips multi-byte characters", () => {
    const bytes = reqOf(createChannel());
    const len = writeFrame(bytes, { msg: "wheat — éè 中" });
    expect(readFrame(bytes, len)).toEqual({ msg: "wheat — éè 中" });
  });

  it("refuses a frame larger than its region", () => {
    const bytes = reqOf(createChannel());
    expect(() => writeFrame(bytes, { big: "x".repeat(REQ_BYTES) })).toThrow("frame too large");
  });

  it("does not hand back a view onto shared memory", () => {
    const sab = createChannel();
    const bytes = reqOf(sab);
    const len = writeFrame(bytes, { a: 1 });
    const first = readFrame(bytes, len);
    bytes.fill(0);
    expect(first).toEqual({ a: 1 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/protocol.test.ts`
Expected: FAIL, cannot find module

**Step 3: Create `src/bridge/protocol.ts`**

```ts
/**
 * One SharedArrayBuffer per bot. Byte layout:
 *
 *   [0, 32)         control slots, the Int32Array a worker parks on
 *   [32, 4128)      request frame  (worker -> host)
 *   [4128, 20512)   result frame   (host -> worker)
 *   [20512, 24608)  mirror frame   (host -> worker, read lock-free)
 *
 * Every region is a multiple of 4 bytes so the Int32Array view stays aligned.
 */

import type { Command, ResearchName } from "../sim/types";

export const CTRL_SLOTS = 8;
export const CTRL_BYTES = CTRL_SLOTS * 4;
export const REQ_BYTES = 4096;
/** A scan of radius 5 is 121 tiles of JSON; this leaves room to spare. */
export const RES_BYTES = 16384;
export const MIRROR_BYTES = 4096;

export const REQ_OFFSET = CTRL_BYTES;
export const RES_OFFSET = REQ_OFFSET + REQ_BYTES;
export const MIRROR_OFFSET = RES_OFFSET + RES_BYTES;
export const CHANNEL_BYTES = MIRROR_OFFSET + MIRROR_BYTES;

/** Control slot indices. */
export const STATE = 0;
export const REQ_LEN = 1;
export const RES_LEN = 2;
export const RES_OK = 3;
export const MIRROR_SEQ = 4;
export const MIRROR_LEN = 5;

/** Values the STATE slot takes. */
export const IDLE = 0;
export const REQUEST = 1;
export const RESULT = 2;

/** What a worker can ask the host for. */
export type HostRequest =
  | { kind: "command"; command: Command }
  | { kind: "colony"; call: "bots" | "time" }
  | { kind: "research"; name: ResearchName };

/** What the host publishes for a bot to read without asking. */
export interface MirrorState {
  time: number;
  pos: { x: number; y: number };
  inventory: Record<string, number | undefined>;
  modules: string[];
  busy: boolean;
}

export function createChannel(): SharedArrayBuffer {
  return new SharedArrayBuffer(CHANNEL_BYTES);
}

export function ctrlOf(sab: SharedArrayBuffer): Int32Array {
  return new Int32Array(sab, 0, CTRL_SLOTS);
}
export function reqOf(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, REQ_OFFSET, REQ_BYTES);
}
export function resOf(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, RES_OFFSET, RES_BYTES);
}
export function mirrorOf(sab: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(sab, MIRROR_OFFSET, MIRROR_BYTES);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Serialise into a frame region. Returns the byte length written. */
export function writeFrame(bytes: Uint8Array, value: unknown): number {
  const encoded = encoder.encode(JSON.stringify(value ?? null));
  if (encoded.length > bytes.length) {
    throw new Error(`frame too large: ${encoded.length} > ${bytes.length} bytes`);
  }
  bytes.set(encoded);
  return encoded.length;
}

/**
 * Read a frame back. The bytes are copied out of shared memory before being
 * decoded: Node tolerates decoding a shared view, but browsers have not always,
 * and milestones 3 and 4 run this code in one.
 */
export function readFrame(bytes: Uint8Array, len: number): unknown {
  return JSON.parse(decoder.decode(new Uint8Array(bytes.subarray(0, len))));
}
```

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bridge/protocol.test.ts`
Expected: `7 passed`

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/bridge/protocol.ts tests/bridge/protocol.test.ts
git commit -m "feat(bridge): channel layout and JSON framing over shared memory"
```

---

### Task 3: The seqlock mirror

Free reads depend entirely on this. A reader must never observe a half-written frame.

**Files:**
- Create: `src/bridge/mirror.ts`
- Test: `tests/bridge/mirror.test.ts`

**Step 1: Write the failing test**

```ts
import { createChannel, ctrlOf, mirrorOf, MIRROR_SEQ, MIRROR_LEN } from "../../src/bridge/protocol.ts";
import { publishMirror, readMirror } from "../../src/bridge/mirror.ts";

const state = { time: 4, pos: { x: 17, y: 16 }, inventory: { wheat: 2 }, modules: ["harvester"], busy: false };

describe("mirror", () => {
  it("round-trips published state", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual(state);
  });

  it("leaves the sequence even after a completed write", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    expect(Atomics.load(ctrlOf(sab), MIRROR_SEQ) % 2).toBe(0);
  });

  it("gives up rather than returning a frame written mid-flight", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    // An odd sequence is what a writer leaves behind while it is still writing.
    Atomics.store(ctrlOf(sab), MIRROR_SEQ, 1);
    expect(() => readMirror(ctrlOf(sab), mirrorOf(sab))).toThrow("mirror never settled");
  });

  it("recovers once the writer finishes", () => {
    const sab = createChannel();
    Atomics.store(ctrlOf(sab), MIRROR_SEQ, 1);
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual(state);
  });

  it("does not crash on a torn frame, it retries", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), state);
    // Truncating the length mid-JSON is what a half-written frame looks like.
    Atomics.store(ctrlOf(sab), MIRROR_LEN, 5);
    expect(() => readMirror(ctrlOf(sab), mirrorOf(sab))).toThrow("mirror never settled");
  });

  it("reads the newest state after repeated publishes", () => {
    const sab = createChannel();
    for (let t = 0; t < 5; t++) publishMirror(ctrlOf(sab), mirrorOf(sab), { ...state, time: t });
    expect(readMirror(ctrlOf(sab), mirrorOf(sab))).toEqual({ ...state, time: 4 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/mirror.test.ts`
Expected: FAIL, cannot find module

**Step 3: Create `src/bridge/mirror.ts`**

```ts
import { MIRROR_LEN, MIRROR_SEQ, readFrame, writeFrame } from "./protocol.ts";

/** How many times a reader retries before deciding the writer is wedged. */
const MAX_ATTEMPTS = 1000;

/**
 * Publish readable bot state. The sequence number is odd for the duration of
 * the write, so a reader can tell it saw a half-written frame and try again.
 */
export function publishMirror(ctrl: Int32Array, bytes: Uint8Array, value: unknown): void {
  Atomics.add(ctrl, MIRROR_SEQ, 1); // -> odd, writing
  const len = writeFrame(bytes, value);
  Atomics.store(ctrl, MIRROR_LEN, len);
  Atomics.add(ctrl, MIRROR_SEQ, 1); // -> even, settled
}

/**
 * Read published state without taking a lock. Retries while a write is in
 * flight; a torn frame fails to parse, which is just another reason to retry.
 */
export function readMirror(ctrl: Int32Array, bytes: Uint8Array): unknown {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const before = Atomics.load(ctrl, MIRROR_SEQ);
    if (before % 2 !== 0) continue;
    let value: unknown;
    try {
      value = readFrame(bytes, Atomics.load(ctrl, MIRROR_LEN));
    } catch {
      continue;
    }
    if (Atomics.load(ctrl, MIRROR_SEQ) === before) return value;
  }
  throw new Error("mirror never settled");
}
```

Note: the mirror is unreadable until the host has published once — length 0 decodes to an empty string, which is not valid JSON. Task 4 publishes on attach, which is why no test here reads a virgin channel.

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bridge/mirror.test.ts`
Expected: `6 passed`

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/bridge/mirror.ts tests/bridge/mirror.test.ts
git commit -m "feat(bridge): seqlock mirror for lock-free bot state reads"
```

---

### Task 4: The host, served without a worker

The host half of the protocol, tested by driving the channel from the test itself. No workers yet, so these tests are fast and fully deterministic.

**Files:**
- Create: `src/bridge/host.ts`
- Create: `tests/bridge/helpers.ts`
- Test: `tests/bridge/host.test.ts`

**Step 1: Create the test helper `tests/bridge/helpers.ts`**

```ts
import {
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  ctrlOf, reqOf, resOf, readFrame, writeFrame,
} from "../../src/bridge/protocol.ts";
import type { HostRequest } from "../../src/bridge/protocol.ts";

/** Stands in for a worker: posts a request into a channel, without blocking. */
export function postRequest(sab: SharedArrayBuffer, request: HostRequest): void {
  const ctrl = ctrlOf(sab);
  Atomics.store(ctrl, REQ_LEN, writeFrame(reqOf(sab), request));
  Atomics.store(ctrl, STATE, REQUEST);
}

/** Reads a resolved result and returns the channel to idle, as a worker would. */
export function takeReply(sab: SharedArrayBuffer): { ok: boolean; value: unknown } | null {
  const ctrl = ctrlOf(sab);
  if (Atomics.load(ctrl, STATE) !== RESULT) return null;
  const ok = Atomics.load(ctrl, RES_OK) === 1;
  const value = readFrame(resOf(sab), Atomics.load(ctrl, RES_LEN));
  Atomics.store(ctrl, STATE, IDLE);
  return { ok, value };
}
```

**Step 2: Write the failing test `tests/bridge/host.test.ts`**

```ts
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
    const { c, sab } = colony();
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
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run tests/bridge/host.test.ts`
Expected: FAIL, cannot find module `../../src/bridge/host.ts`

**Step 4: Create `src/bridge/host.ts`**

```ts
import { World } from "../sim/world";
import type { CommandResult } from "../sim/types";
import {
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE,
  ctrlOf, mirrorOf, readFrame, reqOf, resOf, writeFrame,
} from "./protocol.ts";
import type { HostRequest, MirrorState } from "./protocol.ts";
import { publishMirror } from "./mirror.ts";

export interface ColonyOptions {
  world: World;
}

interface Channel {
  botId: number;
  sab: SharedArrayBuffer;
  ctrl: Int32Array;
  req: Uint8Array;
  res: Uint8Array;
  mirror: Uint8Array;
}

export class Colony {
  readonly world: World;
  protected readonly channels = new Map<number, Channel>();

  constructor(opts: ColonyOptions) {
    this.world = opts.world;
  }

  /** Give a bot a channel. The mirror is published at once so a script may read before its first call. */
  attach(botId: number): SharedArrayBuffer {
    if (this.channels.has(botId)) throw new Error(`bot ${botId} already attached`);
    this.world.getBot(botId); // throws for an unknown bot
    const sab = new SharedArrayBuffer(CHANNEL_BYTES_PLACEHOLDER);
    const channel: Channel = {
      botId, sab,
      ctrl: ctrlOf(sab), req: reqOf(sab), res: resOf(sab), mirror: mirrorOf(sab),
    };
    this.channels.set(botId, channel);
    this.publish(channel);
    return sab;
  }

  /**
   * Serve pending requests and advance the world while anything is in flight.
   * Returns when every attached bot is idle. Time only moves when a command is
   * actually counting down, so computing and reading are free.
   */
  pump(maxTicks = 100_000): void {
    this.serve();
    let ticks = 0;
    while (this.anyInFlight()) {
      if (++ticks > maxTicks) throw new Error(`pump exceeded ${maxTicks} ticks`);
      this.world.tick();
      this.publishAll();
      this.deliver();
      this.serve();
    }
    this.publishAll();
  }

  protected anyInFlight(): boolean {
    for (const ch of this.channels.values()) {
      if (this.world.getBot(ch.botId).action) return true;
    }
    return false;
  }

  /** Decode whatever workers have posted and act on it. */
  protected serve(): void {
    for (const ch of this.channels.values()) {
      if (Atomics.load(ch.ctrl, STATE) !== REQUEST) continue;
      const request = readFrame(ch.req, Atomics.load(ch.ctrl, REQ_LEN)) as HostRequest;
      const immediate = this.dispatch(ch, request);
      if (immediate) this.reply(ch, immediate);
    }
  }

  /** Returns a result to reply with now, or null to wait for the sim. */
  private dispatch(ch: Channel, request: HostRequest): CommandResult | null {
    try {
      switch (request.kind) {
        case "command": {
          this.world.issue(ch.botId, request.command);
          return this.world.takeResult(ch.botId); // non-null only for immediate failures
        }
        case "colony":
          return { ok: true, value: request.call === "time" ? this.world.time : this.botViews() };
        case "research":
          this.world.queueResearch(request.name);
          return { ok: true, value: null };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Hand back results the sim has finished with. */
  protected deliver(): void {
    for (const ch of this.channels.values()) {
      if (Atomics.load(ch.ctrl, STATE) !== REQUEST) continue;
      const result = this.world.takeResult(ch.botId);
      if (result) this.reply(ch, result);
    }
  }

  private reply(ch: Channel, result: CommandResult): void {
    const payload = result.ok ? result.value : result.error;
    Atomics.store(ch.ctrl, RES_LEN, writeFrame(ch.res, payload));
    Atomics.store(ch.ctrl, RES_OK, result.ok ? 1 : 0);
    Atomics.store(ch.ctrl, STATE, RESULT);
    Atomics.notify(ch.ctrl, STATE);
  }

  protected publishAll(): void {
    for (const ch of this.channels.values()) this.publish(ch);
  }

  private publish(ch: Channel): void {
    const bot = this.world.getBot(ch.botId);
    const state: MirrorState = {
      time: this.world.time,
      pos: { ...bot.pos },
      inventory: { ...bot.inventory },
      modules: [...bot.modules],
      busy: bot.action !== null,
    };
    publishMirror(ch.ctrl, ch.mirror, state);
  }

  private botViews(): MirrorState[] {
    return [...this.world.bots.values()].map((bot) => ({
      time: this.world.time,
      pos: { ...bot.pos },
      inventory: { ...bot.inventory },
      modules: [...bot.modules],
      busy: bot.action !== null,
    }));
  }
}
```

Two things to fix while typing this in, both deliberate:

1. Replace `CHANNEL_BYTES_PLACEHOLDER` with a call to `createChannel()` imported from `./protocol.ts`, and drop the raw `new SharedArrayBuffer`. The placeholder is there so a copy-paste without reading fails loudly at compile time rather than silently allocating the wrong size.
2. `botViews()` returns `MirrorState[]` but a colony read needs each bot's **id**. Add `id: bot.id` to the objects it builds and widen the return type to `Array<MirrorState & { id: number }>`. The test asserts on `bots[0].id`, so this will not pass until you do.

**Step 5: Run tests and typecheck**

Run: `npx vitest run tests/bridge/host.test.ts`
Expected: `10 passed`

Run: `npm run typecheck`
Expected: exit 0

**Step 6: Commit**

```bash
git add src/bridge/host.ts tests/bridge/helpers.ts tests/bridge/host.test.ts
git commit -m "feat(bridge): Colony host servicing commands, colony reads and research"
```

---

### Task 5: The worker-side API

The `bot` and `colony` globals a player script sees. Tested against a hand-driven channel, still without a worker.

**Files:**
- Create: `src/bridge/api.ts`
- Test: `tests/bridge/api.test.ts`

**Step 1: Write the failing test**

```ts
import { createChannel, ctrlOf, mirrorOf, reqOf, resOf, readFrame, writeFrame,
  IDLE, REQUEST, RESULT, REQ_LEN, RES_LEN, RES_OK, STATE } from "../../src/bridge/protocol.ts";
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

/** Answer the next request the moment it appears, as the host would. */
function answerWith(sab: SharedArrayBuffer, ok: boolean, value: unknown): void {
  const ctrl = ctrlOf(sab);
  const timer = setInterval(() => {
    if (Atomics.load(ctrl, STATE) !== REQUEST) return;
    Atomics.store(ctrl, RES_LEN, writeFrame(resOf(sab), value));
    Atomics.store(ctrl, RES_OK, ok ? 1 : 0);
    Atomics.store(ctrl, STATE, RESULT);
    Atomics.notify(ctrl, STATE);
    clearInterval(timer);
  }, 1);
}

function lastRequest(sab: SharedArrayBuffer): HostRequest {
  return readFrame(reqOf(sab), Atomics.load(ctrlOf(sab), REQ_LEN)) as HostRequest;
}

describe("free reads", () => {
  it("reads pos and inventory from the mirror without posting a request", () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), MIRROR);
    const { bot } = makeApi(sab, 1);
    expect(bot.pos()).toEqual({ x: 17, y: 16 });
    expect(bot.inventory()).toEqual({ wheat: 3 });
    expect(Atomics.load(ctrlOf(sab), STATE)).toBe(IDLE);
  });
});

describe("blocking calls", () => {
  it("move posts a move command and returns the host's answer", async () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), MIRROR);
    const { bot } = makeApi(sab, 1);
    answerWith(sab, true, true);
    const moved = await Promise.resolve().then(() => bot.move("east"));
    expect(moved).toBe(true);
    expect(lastRequest(sab)).toEqual({ kind: "command", command: { kind: "move", dir: "east" } });
    expect(Atomics.load(ctrlOf(sab), STATE)).toBe(IDLE);
  }, 10_000);

  it("throws the host's message when a call fails", async () => {
    const sab = createChannel();
    publishMirror(ctrlOf(sab), mirrorOf(sab), MIRROR);
    const { bot } = makeApi(sab, 1);
    answerWith(sab, false, "Bot 1 has no Scanner module");
    expect(() => bot.scanner.scan(1)).toThrow("Bot 1 has no Scanner module");
  }, 10_000);

  it("names each namespaced verb correctly", async () => {
    const cases: Array<[() => unknown, HostRequest]> = [];
    const mk = () => {
      const sab = createChannel();
      publishMirror(ctrlOf(sab), mirrorOf(sab), MIRROR);
      answerWith(sab, true, null);
      return { sab, api: makeApi(sab, 1) };
    };
    const a = mk(); a.api.bot.harvester.harvest();
    expect(lastRequest(a.sab)).toEqual({ kind: "command", command: { kind: "harvest" } });
    const b = mk(); b.api.bot.planter.plant("wheat");
    expect(lastRequest(b.sab)).toEqual({ kind: "command", command: { kind: "plant", item: "wheat" } });
    const c = mk(); c.api.bot.radio.send("haul", { x: 1 });
    expect(lastRequest(c.sab)).toEqual({ kind: "command", command: { kind: "send", channel: "haul", payload: { x: 1 } } });
    const d = mk(); d.api.colony.research.queue("planter");
    expect(lastRequest(d.sab)).toEqual({ kind: "research", name: "planter" });
  }, 10_000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/api.test.ts`
Expected: FAIL, cannot find module `../../src/bridge/api.ts`

**Step 3: Create `src/bridge/api.ts`**

```ts
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
```

A note on module gating, which the design doc is specific about. `bot.scanner` is **always present**, even with no scanner installed, and the call fails with the sim's own message — "Bot 1 has no Scanner module". Making the namespace literally `undefined` at runtime would produce `Cannot read properties of undefined` instead, which is exactly the unhelpful error the design set out to avoid. The `undefined` typing lives in the `.d.ts` shipped to Monaco in milestone 3; it is a compile-time story, not a runtime one.

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bridge/api.test.ts`
Expected: `4 passed`

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/bridge/api.ts tests/bridge/api.test.ts
git commit -m "feat(bridge): bot and colony script API over the channel"
```

---

### Task 6: The worker entry, and a script that really runs

First end-to-end task: a string of player JavaScript moves a real bot in a real `World`.

**Files:**
- Create: `src/bridge/worker-entry.ts`
- Modify: `src/bridge/host.ts`
- Test: `tests/bridge/scripts.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("running a player script", () => {
  it("moves a bot east twice", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `bot.move("east"); bot.move("east");`);
      expect(outcome.status).toBe("done");
      expect(c.world.getBot(1).pos).toEqual({ x: 19, y: 16 });
      expect(c.world.time).toBe(TICK_COST.move * 2);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("reads its own position back after moving", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        bot.move("east");
        bot.log("at " + bot.pos().x);
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual(["at 18"]);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("reports a script that throws, and leaves the world intact", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `bot.move("east"); throw new Error("boom");`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("boom");
      expect(c.world.getBot(1).pos).toEqual({ x: 18, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("surfaces a missing module as the sim's own message", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `bot.scanner.scan(1);`);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("Bot 1 has no Scanner module");
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("runs a loop with a real condition", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        while (bot.pos().x < 22) bot.move("east");
      `);
      expect(outcome.status).toBe("done");
      expect(c.world.getBot(1).pos).toEqual({ x: 22, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 20_000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/scripts.test.ts`
Expected: FAIL, `ScriptColony` is not exported

**Step 3: Create `src/bridge/worker-entry.ts`**

```ts
import { parentPort, workerData } from "node:worker_threads";
import { makeApi } from "./api.ts";

const { sab, botId, source } = workerData as {
  sab: SharedArrayBuffer;
  botId: number;
  source: string;
};

const port = parentPort!;
const { bot, colony } = makeApi(sab, botId, (m) => port.postMessage(m));

try {
  // Player scripts are ordinary JavaScript with two globals in scope.
  const fn = new Function("bot", "colony", `"use strict";\n${source}`);
  fn(bot, colony);
  port.postMessage({ kind: "done" });
} catch (err) {
  port.postMessage({ kind: "error", message: err instanceof Error ? err.message : String(err) });
}
```

**Step 4: Add `ScriptColony` to `src/bridge/host.ts`**

Add these imports at the top:

```ts
import { Worker } from "node:worker_threads";
import { createChannel } from "./protocol.ts";
```

Add below the `Colony` class:

```ts
export type ScriptStatus = "done" | "error" | "hung" | "stopped";

export interface ScriptOutcome {
  botId: number;
  status: ScriptStatus;
  message?: string;
  logs: string[];
}

/**
 * A Colony that can run player scripts in workers.
 *
 * The loop is demand-driven: requests are served the moment they appear, the
 * world only ticks while a command is counting down, and control is yielded to
 * the event loop in between so the worker can actually make progress.
 */
export class ScriptColony extends Colony {
  private readonly workers = new Map<number, Worker>();

  async run(botId: number, source: string): Promise<ScriptOutcome> {
    const sab = this.channels.get(botId)?.sab ?? this.attach(botId);
    const logs: string[] = [];
    let settled: { status: ScriptStatus; message?: string } | null = null;

    const worker = new Worker(new URL("./worker-entry.ts", import.meta.url), {
      workerData: { sab, botId, source },
    });
    this.workers.set(botId, worker);

    worker.on("message", (m: { kind: string; message?: string }) => {
      if (m.kind === "log") logs.push(String(m.message));
      else if (m.kind === "done") settled = { status: "done" };
      else if (m.kind === "error") settled = { status: "error", message: m.message };
    });
    worker.on("error", (err) => { settled = { status: "error", message: err.message }; });

    try {
      while (!settled) {
        this.serve();
        if (this.anyInFlight()) {
          this.world.tick();
          this.publishAll();
          this.deliver();
        }
        await new Promise((r) => setImmediate(r));
      }
      return { botId, logs, ...settled };
    } finally {
      await this.stop(botId);
    }
  }

  async stop(botId: number): Promise<void> {
    const worker = this.workers.get(botId);
    if (!worker) return;
    this.workers.delete(botId);
    await worker.terminate();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.workers.keys()].map((id) => this.stop(id)));
  }
}
```

Two things this needs that `Colony` does not yet expose: `channels` must be `protected` (it already is), and `attach` must return the `SharedArrayBuffer` (it already does). If `serve`, `deliver`, `anyInFlight` or `publishAll` are still `private` from Task 4, widen them to `protected`.

Also replace `CHANNEL_BYTES_PLACEHOLDER` in `attach` with `createChannel()` if you have not already.

**Step 5: Run tests and typecheck**

Run: `npx vitest run tests/bridge/scripts.test.ts`
Expected: `5 passed`

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 6: Commit**

```bash
git add src/bridge/worker-entry.ts src/bridge/host.ts tests/bridge/scripts.test.ts
git commit -m "feat(bridge): run player scripts in workers end to end"
```

---

### Task 7: Free reads really are free

The invariant the whole read design rests on. Worth its own task because it is the thing most likely to regress silently.

**Files:**
- Test: `tests/bridge/free-reads.test.ts`

**Step 1: Write the test**

```ts
import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("reads cost no ticks", () => {
  it("a thousand pos() reads advance the clock by zero", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        let sum = 0;
        for (let i = 0; i < 1000; i++) sum += bot.pos().x;
        bot.log(String(sum));
      `);
      expect(outcome.status).toBe("done");
      expect(outcome.logs).toEqual([String(17 * 1000)]);
      expect(c.world.time).toBe(0);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("a move loop costs exactly its moves and nothing more", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      await c.run(1, `
        while (bot.pos().x < 22) { bot.inventory(); bot.move("east"); }
      `);
      expect(c.world.getBot(1).pos.x).toBe(22);
      expect(c.world.time).toBe(5 * TICK_COST.move);
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("colony reads cost no ticks either", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const outcome = await c.run(1, `
        for (let i = 0; i < 20; i++) colony.bots();
        bot.log(String(colony.time()));
      `);
      expect(outcome.logs).toEqual(["0"]);
      expect(c.world.time).toBe(0);
    } finally {
      await c.stopAll();
    }
  }, 20_000);
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/bridge/free-reads.test.ts`
Expected: `3 passed`. If the clock is not zero, the host is ticking when nothing is in flight — fix `run`, not the assertion.

**Step 3: Commit**

```bash
git add tests/bridge/free-reads.test.ts
git commit -m "test(bridge): reads and computation cost no simulated time"
```

---

### Task 8: Two bots block independently

The design's promise that "one bot waiting on `receive()` never stalls another".

**Files:**
- Modify: `src/bridge/host.ts`
- Test: `tests/bridge/concurrency.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

function twoBotWorld(): World {
  const w = new World({ seed: 1 });
  w.research.spareChassis = 1;
  const other = w.deployBot({ x: 17, y: 18 });
  w.getBot(1).modules.add("radio");
  w.getBot(other.id).modules.add("radio");
  return w;
}

describe("independent blocking", () => {
  it("a bot parked on receive does not stall the other", async () => {
    const c = new ScriptColony({ world: twoBotWorld() });
    try {
      const listener = c.run(3, `
        const msg = bot.radio.receive();
        bot.log("got " + msg.channel);
      `);
      const sender = c.run(1, `
        bot.move("east");
        bot.move("east");
        bot.radio.send("go", null);
      `);
      const [a, b] = await Promise.all([listener, sender]);
      expect(b.status).toBe("done");
      expect(a.status).toBe("done");
      expect(a.logs).toEqual(["got go"]);
      expect(c.world.getBot(1).pos.x).toBe(19);
    } finally {
      await c.stopAll();
    }
  }, 30_000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/concurrency.test.ts`
Expected: FAIL or hang until the test timeout — `run` as written in Task 6 owns the tick loop, so two concurrent calls fight over it.

**Step 3: Fix the loop ownership in `src/bridge/host.ts`**

The bug: each `run()` drives its own pump loop, so two scripts double-tick the world.

Replace the per-call loop with a single shared one. Add to `ScriptColony`:

```ts
  private pending = 0;
  private looping = false;

  /** One shared drive loop, however many scripts are running. */
  private async drive(): Promise<void> {
    if (this.looping) return;
    this.looping = true;
    try {
      while (this.pending > 0) {
        this.serve();
        if (this.anyInFlight()) {
          this.world.tick();
          this.publishAll();
          this.deliver();
        }
        await new Promise((r) => setImmediate(r));
      }
    } finally {
      this.looping = false;
    }
  }
```

In `run`, replace the `while (!settled)` block with:

```ts
      this.pending++;
      void this.drive();
      while (!settled) await new Promise((r) => setImmediate(r));
      return { botId, logs, ...settled };
    } finally {
      this.pending--;
      await this.stop(botId);
    }
```

`anyInFlight` already walks every attached bot, so one loop serves all of them.

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bridge/concurrency.test.ts`
Expected: `1 passed`

Run: `npm test`
Expected: all passing — Task 7's tick-count assertions still hold, since a single loop ticks once per cycle.

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/bridge/host.ts tests/bridge/concurrency.test.ts
git commit -m "feat(bridge): one shared drive loop so bots block independently"
```

---

### Task 9: The watchdog

A script that loops without ever calling into the world must be killed, or it takes the test run with it.

**Files:**
- Modify: `src/bridge/host.ts`
- Test: `tests/bridge/watchdog.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("watchdog", () => {
  it("terminates a script that never calls into the world", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 100 });
    try {
      const outcome = await c.run(1, `while (true) {}`);
      expect(outcome.status).toBe("hung");
      expect(outcome.message).toContain("no world call");
    } finally {
      await c.stopAll();
    }
  }, 20_000);

  it("leaves a bot legitimately parked on receive alone", async () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const other = w.deployBot({ x: 17, y: 18 });
    w.getBot(1).modules.add("radio");
    w.getBot(other.id).modules.add("radio");
    const c = new ScriptColony({ world: w, hungMs: 100 });
    try {
      const listener = c.run(other.id, `bot.radio.receive(); bot.log("woke");`);
      const sender = c.run(1, `
        for (let i = 0; i < 40; i++) bot.wait(1);
        bot.radio.send("go", null);
      `);
      const [a] = await Promise.all([listener, sender]);
      expect(a.status).toBe("done");
      expect(a.logs).toEqual(["woke"]);
    } finally {
      await c.stopAll();
    }
  }, 30_000);

  it("does not fire on a script making steady progress", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 100 });
    try {
      const outcome = await c.run(1, `for (let i = 0; i < 30; i++) bot.wait(1);`);
      expect(outcome.status).toBe("done");
    } finally {
      await c.stopAll();
    }
  }, 20_000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/watchdog.test.ts`
Expected: the first test hangs until its 20-second timeout. That is the bug.

**Step 3: Implement**

The discriminator is exact and worth understanding before typing it in:

- A script in a bare infinite loop leaves `STATE` at `IDLE` forever — it never asks for anything.
- A script parked on `receive()` leaves `STATE` at `REQUEST` — it *has* asked; the sim simply has not answered yet.

So: **idle for longer than `hungMs` means hung. Pending never does, however long it lasts.**

Add `hungMs` to `ColonyOptions`:

```ts
export interface ColonyOptions {
  world: World;
  /** Idle time, in ms, after which a script is presumed stuck. */
  hungMs?: number;
}
```

Store it in `Colony`'s constructor as `protected readonly hungMs: number = opts.hungMs ?? 2000;`.

Track activity per channel. Add `lastActive: number` to the `Channel` interface, set to `Date.now()` in `attach`, and refresh it in `serve()` whenever a request is seen:

```ts
      ch.lastActive = Date.now();
```

In `ScriptColony`, add a check inside the drive loop, after `this.serve()`:

```ts
        for (const [botId, worker] of this.workers) {
          const ch = this.channels.get(botId);
          if (!ch) continue;
          if (Atomics.load(ch.ctrl, STATE) !== IDLE) continue;
          if (Date.now() - ch.lastActive <= this.hungMs) continue;
          this.onHung(botId);
          void worker.terminate();
        }
```

`onHung` settles that bot's outcome. Wire it by keeping a `Map<number, (o: {status: ScriptStatus; message?: string}) => void>` of settle callbacks populated in `run`, and have `onHung` call:

```ts
  private onHung(botId: number): void {
    this.settlers.get(botId)?.({
      status: "hung",
      message: `bot ${botId} made no world call for ${this.hungMs}ms`,
    });
  }
```

In `run`, register the settler before spawning and delete it in the `finally`. Replace the local `settled` assignments with a single `settle` function that ignores everything after the first call, so a worker's dying `error` message cannot overwrite a `hung` verdict.

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bridge/watchdog.test.ts`
Expected: `3 passed`, and the first one finishes in well under a second rather than timing out.

Run: `npm test`
Expected: all passing. If an unrelated test now reports "hung", its script is computing for longer than the 2000 ms default — raise that test's `hungMs`, do not raise the default.

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/bridge/host.ts tests/bridge/watchdog.test.ts
git commit -m "feat(bridge): watchdog terminating scripts that make no world calls"
```

---

### Task 10: Stopping and restarting a script

The foundation for milestone 3's hot reload. Restarting mid-command must not leave a channel in a state the next worker misreads.

**Files:**
- Modify: `src/bridge/host.ts`
- Test: `tests/bridge/lifecycle.test.ts`

**Step 1: Write the failing test**

```ts
import { World } from "../../src/sim/world";
import { ScriptColony } from "../../src/bridge/host.ts";

describe("script lifecycle", () => {
  it("stopping mid-command reports stopped and leaves the world usable", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      const running = c.run(1, `for (let i = 0; i < 5000; i++) bot.wait(1);`);
      await new Promise((r) => setTimeout(r, 150));
      await c.stop(1);
      const outcome = await running;
      expect(outcome.status).toBe("stopped");
      const after = await c.run(1, `bot.move("east");`);
      expect(after.status).toBe("done");
      expect(c.world.getBot(1).pos).toEqual({ x: 18, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 30_000);

  it("a restarted script starts from a clean channel", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      await c.run(1, `bot.move("east");`);
      const second = await c.run(1, `bot.log("x=" + bot.pos().x); bot.move("east");`);
      expect(second.status).toBe("done");
      expect(second.logs).toEqual(["x=18"]);
      expect(c.world.getBot(1).pos).toEqual({ x: 19, y: 16 });
    } finally {
      await c.stopAll();
    }
  }, 30_000);

  it("reattaching the same bot reuses its channel", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }) });
    try {
      await c.run(1, `bot.wait(1);`);
      await c.run(1, `bot.wait(1);`);
      expect(c.world.time).toBe(2);
    } finally {
      await c.stopAll();
    }
  }, 30_000);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bridge/lifecycle.test.ts`
Expected: FAIL — `stop` does not settle the outcome, so the first test hangs.

**Step 3: Implement**

Two changes:

1. `stop(botId)` settles that bot's outcome as `stopped` before terminating, via the same settler map the watchdog uses.
2. After terminating, reset the channel so the next worker is not handed a half-finished exchange:

```ts
  private resetChannel(botId: number): void {
    const ch = this.channels.get(botId);
    if (!ch) return;
    const bot = this.world.getBot(botId);
    bot.action = null;   // abandon any in-flight command
    bot.result = null;
    bot.blockedOn = null;
    Atomics.store(ch.ctrl, STATE, IDLE);
    ch.lastActive = Date.now();
  }
```

Call it at the end of `stop`.

Clearing `bot.action` reaches into the sim's state directly. That is deliberate and it is the only place the bridge does it: a terminated worker will never collect the result of a command it issued, so leaving the action counting down would block that bot forever. If this feels wrong, it is worth raising — a `world.cancel(botId)` method would be the cleaner home for it, and that *would* be a change to the sim's public surface, which the milestone-1 plan asks you to flag rather than make quietly.

**Step 4: Run tests and typecheck**

Run: `npx vitest run tests/bridge/lifecycle.test.ts`
Expected: `3 passed`

Run: `npm test`
Expected: all passing

Run: `npm run typecheck`
Expected: exit 0

**Step 5: Commit**

```bash
git add src/bridge/host.ts tests/bridge/lifecycle.test.ts
git commit -m "feat(bridge): stop and restart a bot's script without corrupting its channel"
```

---

### Task 11: The reference script, as a real player script

Milestone 1 measured a hand-rolled harvest loop at 155–180 ticks across seeds. The same loop, now written as genuine player JavaScript running in a worker, must land in the same band. If it does not, the bridge is spending time the sim never asked for.

**Files:**
- Test: `tests/bridge/reference-script.test.ts`

**Step 1: Write the test**

```ts
import { World } from "../../src/sim/world";
import { BOT_CAPACITY } from "../../src/sim/config";
import { ScriptColony } from "../../src/bridge/host.ts";

/** The loop from milestone 1's balance test, as a player would actually write it. */
const BEGINNER_LOOP = `
  let dir = "east";
  while (true) {
    bot.harvester.harvest();
    if (bot.move(dir) === false) {
      bot.move("south");
      dir = dir === "east" ? "west" : "east";
    }
  }
`;

describe("reference script through the bridge", () => {
  it("fills the inventory and stops on the sim's own error", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      const outcome = await c.run(1, BEGINNER_LOOP);
      expect(outcome.status).toBe("error");
      expect(outcome.message).toContain("inventory full");
      expect(c.world.getBot(1).inventory).toEqual({ wheat: BOT_CAPACITY });
    } finally {
      await c.stopAll();
    }
  }, 60_000);

  it("costs the same simulated time as driving the sim directly", async () => {
    const c = new ScriptColony({ world: new World({ seed: 1 }), hungMs: 5000 });
    try {
      await c.run(1, BEGINNER_LOOP);
      // Milestone 1 measured seed 1 at 155 ticks driving World directly.
      expect(c.world.time).toBe(155);
    } finally {
      await c.stopAll();
    }
  }, 60_000);
});
```

**Step 2: Run the test**

Run: `npx vitest run tests/bridge/reference-script.test.ts`
Expected: `2 passed`.

If the tick count is not exactly 155, **do not adjust the number**. It means the host advanced the world when nothing was in flight, which is the one invariant this milestone exists to establish. Find the extra tick.

If the first test reports `hung` instead of `error`, the loop is spending more than 5 s of wall clock between world calls, which would be surprising — investigate rather than raising `hungMs` further.

**Step 3: Run everything**

Run: `npm test`
Expected: all passing, no skipped tests.

Run: `npm run typecheck`
Expected: exit 0

**Step 4: Commit**

```bash
git add tests/bridge/reference-script.test.ts
git commit -m "test(bridge): reference harvest loop matches milestone 1 tick for tick"
```

---

## Done criteria for milestone 2

- `npm test` passes. Milestone 1's 72 tests still pass untouched.
- `npm run typecheck` is clean.
- `src/sim/` is **unmodified**, with one deliberate exception: if Task 10's `bot.action` reset was promoted to a `world.cancel()` method, that is a change to the sim's public surface and must be recorded as a design finding.
- A player script written as plain JavaScript drives a bot end to end, blocks on world calls, reads its own state for free, and reports errors with the sim's own messages.
- The reference harvest loop costs exactly the simulated time it cost in milestone 1.
- No file outside `src/bridge/`, `tests/bridge/`, `tsconfig.json` and `package.json` was created or modified.

## What milestone 3 will build on this

Monaco edits a script string; hot reload is `stop(botId)` then `run(botId, newSource)`, which Task 10 already makes safe. The `.d.ts` shipped to the editor is generated from `BotApi` and `ColonyApi` in `api.ts` — that is why they are declared as explicit interfaces rather than inferred. `bot.log` already posts out of band, which is what feeds the per-bot console panel.

Two things deliberately deferred, both needing a renderer to be meaningful:

- **Real-time pacing.** This milestone's host only ticks when a command is in flight. A real game ticks at a fixed rate regardless. Foundry's loop in `js/main.js` — accumulator, 8-step catch-up cap, interpolation alpha passed to the renderer — is a worked example worth reading first.
- **The COOP/COEP requirement.** `Atomics.wait` in a browser needs cross-origin isolation headers. Nothing in this milestone needs them; the first page that loads this code does.
