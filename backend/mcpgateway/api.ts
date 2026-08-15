import { json } from "node:stream/consumers";
import { hostHeaderValidation, originValidation, toNodeHandler } from "@modelcontextprotocol/node";
import {
  type AuthInfo,
  acceptedContent,
  createMcpHandler,
  inputRequired,
  McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { api } from "encore.dev/api";
import { z } from "zod";
import { automation, homecore, notifications } from "~encore/clients";
import { authenticateMcpBearer, hasMcpScope } from "./auth";
import { type AutomationRequestState, createHestiaRequestStateCodec } from "./integrity";
import { consumeRequestStateNonce } from "./nonce";
import { McpAutomationAuthToken, McpReadAuthToken, McpRequestStateKey } from "./secrets";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

let requestStateCodec: ReturnType<typeof createHestiaRequestStateCodec> | undefined;

function codec(): ReturnType<typeof createHestiaRequestStateCodec> {
  requestStateCodec ??= createHestiaRequestStateCodec(
    Buffer.from(McpRequestStateKey(), "base64url"),
  );
  return requestStateCodec;
}

const handler = createMcpHandler(
  () => {
    const server = new McpServer(
      { name: "hestia-encore", version: "0.1.0" },
      {
        capabilities: { tools: {} },
        instructions:
          "HESTIA tools are read-only or policy-mediated. Raw device access is prohibited.",
        requestState: { verify: (...args) => codec().verify(...args) },
      },
    );

    registerSystemStatus(server);
    registerHomeEntities(server);
    registerIncidents(server);
    registerAutomationStart(server);
    return server;
  },
  { legacy: "reject" },
);

const nodeHandler = toNodeHandler(handler);
const validateHost = hostHeaderValidation(
  commaSeparated(process.env.MCP_ALLOWED_HOSTS, [
    "localhost",
    "127.0.0.1",
    "[::1]",
    "hestia-encore",
  ]),
);
const validateOrigin = originValidation(
  commaSeparated(process.env.MCP_ALLOWED_ORIGINS, ["localhost", "127.0.0.1"]),
);

export const mcp = api.raw(
  { expose: true, method: "POST", path: "/mcp", sensitive: true },
  async (request, response) => {
    if (!validateHost(request, response) || !validateOrigin(request, response)) return;
    const auth = authenticateMcpBearer(request.headers.authorization, {
      read: McpReadAuthToken(),
      automation: McpAutomationAuthToken(),
    });
    if (!auth) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="hestia-mcp"');
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_token" }));
      return;
    }
    (request as typeof request & { auth?: AuthInfo }).auth = auth;
    await nodeHandler(request, response, await json(request));
  },
);

function registerSystemStatus(server: McpServer): void {
  server.registerTool(
    "hestia.system.status",
    {
      title: "HESTIA system status",
      description: "Returns the Encore architecture and safety posture without exposing secrets.",
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        runtime: z.literal("encore.ts"),
        protocolVersion: z.literal(MCP_PROTOCOL_VERSION),
        temporal: z.literal("external"),
        events: z.literal("nats-jetstream"),
        execution: z.literal("policy-mediated"),
      }),
      annotations: readOnlyAnnotations(),
    },
    async (_input, context) => {
      requireScope(context, "hestia:read");
      return complete({
        runtime: "encore.ts" as const,
        protocolVersion: MCP_PROTOCOL_VERSION,
        temporal: "external" as const,
        events: "nats-jetstream" as const,
        execution: "policy-mediated" as const,
      });
    },
  );
}

function registerHomeEntities(server: McpServer): void {
  server.registerTool(
    "hestia.home.entities",
    {
      title: "List home entities",
      description: "Returns the canonical Home Core entity views for one home.",
      inputSchema: z.strictObject({ homeId: z.string().min(1) }),
      annotations: readOnlyAnnotations(),
    },
    async ({ homeId }, context) => {
      requireScope(context, "hestia:read");
      return complete(await homecore.listEntities({ homeId }));
    },
  );
}

function registerIncidents(server: McpServer): void {
  server.registerTool(
    "hestia.incidents.list",
    {
      title: "List incidents",
      description: "Returns local incident records for one home.",
      inputSchema: z.strictObject({ homeId: z.string().min(1) }),
      annotations: readOnlyAnnotations(),
    },
    async ({ homeId }, context) => {
      requireScope(context, "hestia:read");
      return complete(await notifications.listIncidents({ homeId }));
    },
  );
}

function registerAutomationStart(server: McpServer): void {
  const inputSchema = z.strictObject({
    planId: z.string().min(1),
    version: z.number().int().positive(),
    requestedBy: z.string().min(1).default("mcp-service-account"),
  });
  const confirmationSchema = z.strictObject({ confirm: z.literal(true) });

  server.registerTool(
    "hestia.automation.start",
    {
      title: "Start a policy-mediated automation",
      description:
        "Requests explicit confirmation, then submits an immutable plan version to Temporal.",
      inputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async (input, context) => {
      requireScope(context, "hestia:automation:submit");
      const state = context.mcpReq.requestState<AutomationRequestState>();
      if (!state) {
        const requestState = await codec().mint(
          {
            operation: "hestia.automation.start",
            ...input,
            nonce: globalThis.crypto.randomUUID(),
          },
          context,
        );
        return inputRequired({
          inputRequests: {
            confirmation: inputRequired.elicit({
              message: `Start immutable automation plan ${input.planId} version ${input.version}?`,
              requestedSchema: confirmationSchema,
            }),
          },
          requestState,
        });
      }

      const confirmation = acceptedContent(
        context.mcpReq.inputResponses,
        "confirmation",
        confirmationSchema,
      );
      if (!confirmation?.confirm) throw new Error("Explicit automation confirmation is required");
      if (
        state.operation !== "hestia.automation.start" ||
        state.planId !== input.planId ||
        state.version !== input.version ||
        state.requestedBy !== input.requestedBy
      )
        throw new Error("Automation request does not match the integrity-protected state");

      await consumeRequestStateNonce({
        nonce: state.nonce,
        clientId: context.http?.authInfo?.clientId ?? "anonymous",
        operation: state.operation,
      });
      return complete(await automation.startPlan(input));
    },
  );
}

function requireScope(context: ServerContext, scope: string): void {
  if (!hasMcpScope(context.http?.authInfo, scope))
    throw new Error(`Missing required MCP scope: ${scope}`);
}

function complete<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function readOnlyAnnotations() {
  return { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
}

function commaSeparated(value: string | undefined, defaults: string[]): string[] {
  return (
    value
      ?.split(",")
      .map((entry) => entry.trim())
      .filter(Boolean) ?? defaults
  );
}
