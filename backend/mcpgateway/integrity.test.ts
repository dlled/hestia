import type { ServerContext } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createHestiaRequestStateCodec } from "./integrity";

const context = (method: string, clientId: string): ServerContext =>
  ({
    mcpReq: { method },
    http: { authInfo: { token: "[redacted]", clientId, scopes: [] } },
  }) as unknown as ServerContext;

describe("MCP 2026-07-28 request-state integrity", () => {
  it("rejects tampering and principal or method changes", async () => {
    const codec = createHestiaRequestStateCodec(new Uint8Array(32).fill(7));
    const original = context("tools/call", "client-a");
    const payload = {
      operation: "hestia.automation.start" as const,
      planId: "plan-1",
      version: 2,
      requestedBy: "mcp-service-account",
      nonce: "nonce-1",
    };
    const state = await codec.mint(payload, original);
    await expect(codec.verify(state, original)).resolves.toEqual(payload);
    await expect(codec.verify(`${state}x`, original)).rejects.toThrow();
    await expect(codec.verify(state, context("tools/list", "client-a"))).rejects.toThrow("bind");
    await expect(codec.verify(state, context("tools/call", "client-b"))).rejects.toThrow("bind");
  });
});
