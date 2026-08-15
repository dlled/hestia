import { describe, expect, it } from "vitest";
import { validWorkerAuthorization } from "./auth";

describe("worker bridge authentication", () => {
  it("accepts only the complete bearer credential", () => {
    expect(validWorkerAuthorization("Bearer worker-secret", "worker-secret")).toBe(true);
    expect(validWorkerAuthorization("Bearer worker", "worker-secret")).toBe(false);
    expect(validWorkerAuthorization(undefined, "worker-secret")).toBe(false);
  });
});
