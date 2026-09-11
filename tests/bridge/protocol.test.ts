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
