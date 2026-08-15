import { describe, expect, it } from "vitest";
import { loadEnv } from "../env.js";
import { resolveServicePort } from "../ports.js";

describe("environment contract", () => {
  it("provides safe local defaults for non-secret infrastructure", () => {
    const env = loadEnv({});

    expect(env.HESTIA_ENV).toBe("dev");
    expect(env.NATS_URL).toBe("nats://localhost:4222");
    expect(env.TEMPORAL_ADDRESS).toBe("localhost:7233");
    expect(env.MODEL_GATEWAY_URL).toBe("http://localhost:3008");
  });

  it("rejects unsupported deployment profiles", () => {
    expect(() => loadEnv({ HESTIA_ENV: "production" })).toThrow();
  });

  it("prefers the container-wide PORT over the local service variable", () => {
    expect(
      resolveServicePort("HOME_CORE_PORT", 3001, { PORT: "3000", HOME_CORE_PORT: "3001" }),
    ).toBe(3000);
  });

  it("rejects invalid or out-of-range port values", () => {
    expect(() => resolveServicePort("HOME_CORE_PORT", 3001, { PORT: "0" })).toThrow();
    expect(() => resolveServicePort("HOME_CORE_PORT", 3001, { PORT: "70000" })).toThrow();
    expect(() => resolveServicePort("HOME_CORE_PORT", 3001, { PORT: "not-a-port" })).toThrow();
  });
});
