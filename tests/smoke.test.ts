import { SIM_VERSION } from "../src/sim/index";

describe("toolchain", () => {
  it("imports source under test", () => {
    expect(SIM_VERSION).toBe(1);
  });
});
