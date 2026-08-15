import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpGatewayRuntime, MCP_PROTOCOL_VERSION, type McpGatewayRuntime } from "../app.js";

const metadata = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientInfo": { name: "hestia-test", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};

describe("MCP 2026-07-28 gateway", () => {
  let runtime: McpGatewayRuntime | undefined;

  afterEach(async () => {
    await runtime?.close();
    runtime = undefined;
  });

  it("serves self-describing stateless discovery and tools", async () => {
    runtime = createRuntime();
    const discover = await modernRequest(runtime, "server/discover", {
      _meta: metadata,
    }).expect(200);
    expect(discover.body.result.supportedVersions).toContain(MCP_PROTOCOL_VERSION);

    const tools = await modernRequest(runtime, "tools/list", { _meta: metadata }).expect(200);
    expect(tools.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "hestia.system.status",
    ]);

    const call = await modernRequest(
      runtime,
      "tools/call",
      { name: "hestia.system.status", arguments: {}, _meta: metadata },
      "hestia.system.status",
    ).expect(200);
    expect(call.body.result.structuredContent).toEqual({
      service: "mcp-gateway",
      protocolVersion: MCP_PROTOCOL_VERSION,
      execution: "policy-mediated",
    });
  });

  it("rejects unauthenticated and cross-origin requests", async () => {
    runtime = createRuntime();
    await request(runtime.app)
      .post("/mcp")
      .set("origin", "http://localhost:3009")
      .set("mcp-protocol-version", MCP_PROTOCOL_VERSION)
      .set("mcp-method", "tools/list")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: metadata } })
      .expect(401);

    await request(runtime.app)
      .post("/mcp")
      .set("authorization", "Bearer test-token")
      .set("origin", "https://attacker.example")
      .set("mcp-protocol-version", MCP_PROTOCOL_VERSION)
      .set("mcp-method", "tools/list")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: metadata } })
      .expect(403);
  });

  it("rejects header/body mismatches and tampered requestState", async () => {
    runtime = createRuntime();
    const mismatch = await modernRequest(runtime, "tools/list", {
      _meta: { ...metadata, "io.modelcontextprotocol/protocolVersion": "2025-11-25" },
    }).expect(400);
    expect(mismatch.body.error.code).toBe(-32020);

    const tampered = await modernRequest(
      runtime,
      "tools/call",
      {
        name: "hestia.system.status",
        arguments: {},
        requestState: "v1.tampered.invalid",
        _meta: metadata,
      },
      "hestia.system.status",
    );
    expect(tampered.body.error.code).toBe(-32602);
    expect(tampered.body.error.message).toBe("Invalid or expired requestState");
  });

  function createRuntime(): McpGatewayRuntime {
    return createMcpGatewayRuntime({
      authToken: "test-token",
      requestStateKey: new Uint8Array(32).fill(7),
      allowedHostnames: ["127.0.0.1", "localhost"],
      allowedOriginHostnames: ["localhost"],
    });
  }

  function modernRequest(
    target: McpGatewayRuntime,
    method: string,
    params: Record<string, unknown>,
    name?: string,
  ): request.Test {
    const call = request(target.app)
      .post("/mcp")
      .set("authorization", "Bearer test-token")
      .set("origin", "http://localhost:3009")
      .set("mcp-protocol-version", MCP_PROTOCOL_VERSION)
      .set("mcp-method", method)
      .send({ jsonrpc: "2.0", id: 1, method, params });
    return name ? call.set("mcp-name", name) : call;
  }
});
