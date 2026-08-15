import { describe, expect, it } from "vitest";
import { authenticateMcpBearer, hasMcpScope } from "./auth";

const tokens = { read: "read-secret-token", automation: "automation-secret-token" };

describe("MCP bearer authentication", () => {
  it("keeps read and effectful scopes separate", () => {
    const reader = authenticateMcpBearer("Bearer read-secret-token", tokens, 100);
    const automation = authenticateMcpBearer("Bearer automation-secret-token", tokens, 100);
    expect(hasMcpScope(reader, "hestia:read")).toBe(true);
    expect(hasMcpScope(reader, "hestia:automation:submit")).toBe(false);
    expect(hasMcpScope(automation, "hestia:automation:submit")).toBe(true);
    expect(automation?.expiresAt).toBe(400);
  });

  it("rejects missing and invalid tokens", () => {
    expect(authenticateMcpBearer(undefined, tokens)).toBeUndefined();
    expect(authenticateMcpBearer("Basic nope", tokens)).toBeUndefined();
    expect(authenticateMcpBearer("Bearer wrong", tokens)).toBeUndefined();
  });
});
