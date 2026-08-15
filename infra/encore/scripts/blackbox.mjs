import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const baseUrl = process.env.HESTIA_BASE_URL ?? "http://127.0.0.1:4000";
const readToken = required("MCP_READ_AUTH_TOKEN");
const webhookKey = required("INTEGRATION_WEBHOOK_SIGNING_KEY");

const unauthorized = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
assert.equal(unauthorized.status, 401);

const metadata = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "hestia-blackbox", version: "1.0.0" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
const toolsResponse = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${readToken}`,
    origin: "http://localhost:5173",
    "content-type": "application/json",
    "mcp-protocol-version": "2026-07-28",
    "mcp-method": "tools/list",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: { _meta: metadata },
  }),
});
assert.equal(toolsResponse.status, 200);
const toolsBody = await toolsResponse.json();
const tools = toolsBody.result.tools.map((tool) => tool.name);
assert.deepEqual(tools, [
  "hestia.system.status",
  "hestia.home.entities",
  "hestia.incidents.list",
  "hestia.automation.start",
]);

const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
const entityId = "ent_blackbox_temperature";
const body = Buffer.from(
  JSON.stringify({
    eventId,
    eventType: "home.entity.state.changed",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    homeId: "home_primary",
    correlationId: `corr_${randomUUID().replaceAll("-", "")}`,
    source: { type: "webhook", instanceId: "blackbox" },
    subject: { entityId },
    data: {
      entity: {
        id: entityId,
        homeId: "home_primary",
        name: "Black-box temperature",
        domain: "sensor",
        capabilities: ["sensor.read"],
        externalRef: { system: "webhook", instanceId: "blackbox", entityId: "sensor/temperature" },
        observedState: {
          value: 21.5,
          unit: "C",
          timestamp: new Date().toISOString(),
          source: "webhook:blackbox",
          quality: "good",
          staleAfterSec: 300,
        },
      },
    },
  }),
);
const timestamp = String(Math.floor(Date.now() / 1_000));
const signature = createHmac("sha256", webhookKey)
  .update(timestamp)
  .update(".")
  .update(body)
  .digest("hex");
const ingestion = await fetch(`${baseUrl}/integrations/webhooks/entity-state`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-hestia-timestamp": timestamp,
    "x-hestia-signature": `v1=${signature}`,
  },
  body,
});
assert.equal(ingestion.status, 202, await ingestion.text());

const entitiesResponse = await fetch(`${baseUrl}/api/v1/homes/home_primary/entities`);
assert.equal(entitiesResponse.status, 200);
const entities = await entitiesResponse.json();
assert.ok(entities.entities.some((entity) => entity.id === entityId));

process.stdout.write("Encore self-host black-box checks passed\n");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
