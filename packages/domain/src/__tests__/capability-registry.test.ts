import { describe, expect, it } from "vitest";
import { getCapability, listCapabilities } from "../capability-registry.js";

describe("capability registry", () => {
  it("ships the Phase 0 capability set", () => {
    const ids = listCapabilities().map((item) => item.id);
    expect(ids).toContain("level.set");
    expect(ids).toContain("lock.unlock");
    expect(ids).toContain("security.disarm");
  });

  it("does not let the model invent a lower risk class", () => {
    expect(getCapability("lock.unlock").baseRisk).toBe("R3");
    expect(getCapability("security.disarm").baseRisk).toBe("R4");
    expect(getCapability("camera.snapshot").privacySensitive).toBe(true);
  });
});
