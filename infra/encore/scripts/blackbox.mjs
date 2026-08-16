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

const leakSensorId = `ent_blackbox_moisture_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const leakEventId = `evt_${randomUUID().replaceAll("-", "")}`;
await ingestEntityState({
  eventId: leakEventId,
  entity: {
    id: leakSensorId,
    homeId: "home_primary",
    name: "Black-box utility room leak sensor",
    domain: "binary_sensor",
    deviceClass: "moisture",
    capabilities: ["sensor.read"],
    externalRef: {
      system: "webhook",
      instanceId: "blackbox",
      entityId: `binary_sensor/${leakSensorId}`,
    },
    observedState: {
      value: "on",
      timestamp: new Date().toISOString(),
      source: "webhook:blackbox",
      quality: "good",
      staleAfterSec: 300,
    },
  },
});

const leakIncident = await poll(async () => {
  const response = await fetch(`${baseUrl}/api/v1/homes/home_primary/incidents`);
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.incidents.find((incident) => incident.sourceEventId === leakEventId);
});
assert.equal(leakIncident.severity, "critical");
assert.equal(leakIncident.requiredAck, true);
assert.equal(leakIncident.playbookId, "playbook_leak_observe_only");
assert.ok(leakIncident.workflowId?.startsWith("hestia-incident-leak-"));

const auditTypes = await poll(async () => {
  const response = await fetch(`${baseUrl}/api/v1/incidents/${leakIncident.incidentId}/audit`);
  assert.equal(response.status, 200);
  const audit = await response.json();
  const eventTypes = audit.events.map((event) => event.eventType);
  return eventTypes.includes("notification.skipped") ? eventTypes : undefined;
});
assert.ok(auditTypes.includes("incident.created"));
assert.ok(auditTypes.includes("incident.signal.validated"));
assert.ok(auditTypes.includes("incident.mitigated"));
assert.ok(auditTypes.includes("notification.delivered"));
assert.ok(auditTypes.includes("notification.skipped"));

process.stdout.write("Encore self-host black-box checks passed\n");

async function ingestEntityState({ eventId: nextEventId, entity }) {
  const nextBody = Buffer.from(
    JSON.stringify({
      eventId: nextEventId,
      eventType: "home.entity.state.changed",
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      homeId: "home_primary",
      correlationId: `corr_${randomUUID().replaceAll("-", "")}`,
      source: { type: "webhook", instanceId: "blackbox" },
      subject: { entityId: entity.id },
      data: { entity },
    }),
  );
  const nextTimestamp = String(Math.floor(Date.now() / 1_000));
  const nextSignature = createHmac("sha256", webhookKey)
    .update(nextTimestamp)
    .update(".")
    .update(nextBody)
    .digest("hex");
  const response = await fetch(`${baseUrl}/integrations/webhooks/entity-state`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hestia-timestamp": nextTimestamp,
      "x-hestia-signature": `v1=${nextSignature}`,
    },
    body: nextBody,
  });
  assert.equal(response.status, 202, await response.text());
}

async function poll(read, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError ?? new Error("Timed out waiting for leak incident");
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
}
