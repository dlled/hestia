import { timingSafeEqual } from "node:crypto";
import { createServiceApp } from "@hestia/service-runtime";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  createMcpHandler,
  createRequestStateCodec,
  McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { Express, Request } from "express";
import { z } from "zod";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

export interface McpGatewayOptions {
  authToken?: string;
  requestStateKey: Uint8Array;
  requestStateTtlSeconds?: number;
  allowedHostnames?: string[];
  allowedOriginHostnames?: string[];
}

export interface McpGatewayRuntime {
  app: Express;
  close(): Promise<void>;
}

export function createMcpGatewayRuntime(options: McpGatewayOptions): McpGatewayRuntime {
  const stateCodec = createRequestStateCodec({
    key: options.requestStateKey,
    ttlSeconds: options.requestStateTtlSeconds ?? 300,
    bind: (context: ServerContext) =>
      `${context.mcpReq.method}\0${context.http?.authInfo?.clientId ?? "anonymous"}`,
  });

  const handler = createMcpHandler(
    () => {
      const server = new McpServer(
        { name: "hestia-mcp-gateway", version: "0.1.0" },
        {
          capabilities: { tools: {} },
          instructions: "Read-only HESTIA gateway. Physical effects require policy and approval.",
          requestState: { verify: stateCodec.verify },
          cacheHints: {
            "server/discover": { ttlMs: 60_000, cacheScope: "public" },
            "tools/list": { ttlMs: 30_000, cacheScope: "private" },
          },
        },
      );
      server.registerTool(
        "hestia.system.status",
        {
          title: "HESTIA system status",
          description: "Returns the gateway protocol and safety posture without exposing secrets.",
          inputSchema: z.strictObject({}),
          outputSchema: z.strictObject({
            service: z.literal("mcp-gateway"),
            protocolVersion: z.literal(MCP_PROTOCOL_VERSION),
            execution: z.literal("policy-mediated"),
          }),
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
        async () => {
          const output = {
            service: "mcp-gateway" as const,
            protocolVersion: MCP_PROTOCOL_VERSION,
            execution: "policy-mediated" as const,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        },
      );
      return server;
    },
    {
      legacy: "reject",
    },
  );

  const handleMcp = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(
    options.allowedHostnames ?? ["localhost", "127.0.0.1", "[::1]"],
  );
  const validateOrigin = originValidation(
    options.allowedOriginHostnames ?? ["localhost", "127.0.0.1", "[::1]"],
  );

  const app = createServiceApp({
    service: "mcp-gateway",
    readiness: async () => [
      {
        name: "mcp-2026-07-28",
        status: "ok",
        detail: "stateless self-describing requests with HMAC requestState verification",
      },
    ],
    register(expressApp) {
      expressApp.post("/mcp", async (request, response) => {
        if (!validateHost(request, response) || !validateOrigin(request, response)) return;
        const auth = authenticate(request, options.authToken);
        if (!auth) {
          response.setHeader("WWW-Authenticate", 'Bearer realm="hestia-mcp"');
          response.status(401).json({ error: "invalid_token" });
          return;
        }
        (request as Request & { auth?: AuthInfo }).auth = auth;
        await handleMcp(request, response, request.body);
      });
    },
  });

  return { app, close: () => handler.close() };
}

function authenticate(request: Request, expected: string | undefined): AuthInfo | undefined {
  if (!expected) {
    return localAuth("local-development");
  }
  const authorization = request.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const supplied = Buffer.from(authorization.slice(7));
  const configured = Buffer.from(expected);
  if (supplied.length !== configured.length || !timingSafeEqual(supplied, configured)) {
    return undefined;
  }
  return localAuth("hestia-local-service-account");
}

function localAuth(clientId: string): AuthInfo {
  return {
    token: "[redacted]",
    clientId,
    scopes: ["hestia:read"],
    expiresAt: Math.floor(Date.now() / 1_000) + 300,
  };
}
