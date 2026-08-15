import { randomBytes } from "node:crypto";
import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { listen } from "@hestia/service-runtime";
import { createMcpGatewayRuntime } from "./app.js";

const env = loadEnv();
const authToken = process.env.MCP_GATEWAY_AUTH_TOKEN ?? "";
const encodedStateKey = process.env.MCP_REQUEST_STATE_KEY ?? "";

if (env.HESTIA_ENV === "home-prod" && authToken.length === 0) {
  throw new Error("MCP_GATEWAY_AUTH_TOKEN is required in home-prod");
}
if (env.HESTIA_ENV === "home-prod" && encodedStateKey.length === 0) {
  throw new Error("MCP_REQUEST_STATE_KEY is required in home-prod");
}

const requestStateKey = encodedStateKey
  ? Buffer.from(encodedStateKey, "base64url")
  : randomBytes(32);
if (requestStateKey.byteLength < 32) {
  throw new Error("MCP_REQUEST_STATE_KEY must decode to at least 32 bytes");
}

const splitList = (value: string | undefined, fallback: string[]): string[] =>
  value
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : fallback;

const runtime = createMcpGatewayRuntime({
  authToken: authToken || undefined,
  requestStateKey,
  requestStateTtlSeconds: Number(process.env.MCP_REQUEST_STATE_TTL_SECONDS ?? "300"),
  allowedHostnames: splitList(process.env.MCP_ALLOWED_HOSTNAMES, [
    "localhost",
    "127.0.0.1",
    "[::1]",
  ]),
  allowedOriginHostnames: splitList(process.env.MCP_ALLOWED_ORIGIN_HOSTNAMES, [
    "localhost",
    "127.0.0.1",
    "[::1]",
  ]),
});

const shutdown = async (): Promise<void> => {
  await runtime.close();
  process.exit(0);
};
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

listen(
  runtime.app,
  "mcp-gateway",
  resolveServicePort("MCP_GATEWAY_PORT", ServicePorts.mcpGateway),
  process.env.MCP_BIND_ADDRESS ?? "127.0.0.1",
);
