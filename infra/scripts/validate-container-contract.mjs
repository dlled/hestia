#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const examples = new Map([
  [
    ".env.example",
    [
      "HESTIA_ENV",
      "DATABASE_URL",
      "NATS_URL",
      "TEMPORAL_ADDRESS",
      "HOME_ID",
      "AI_ORCHESTRATOR_URL",
      "OPENROUTER_MODEL_FAST",
    ],
  ],
  ["apps/web/.env.example", ["VITE_EDGE_API_URL"]],
  [
    "apps/edge-api/.env.example",
    [
      "PORT",
      "WEB_ORIGIN",
      "TEMPORAL_ADDRESS",
      "HOME_CORE_URL",
      "INTEGRATION_HUB_URL",
      "AUTOMATION_SERVICE_URL",
      "AI_ORCHESTRATOR_URL",
    ],
  ],
  ["apps/home-core/.env.example", ["PORT", "HOME_ID", "DATABASE_URL", "NATS_URL"]],
  [
    "apps/integration-hub/.env.example",
    ["PORT", "HOME_ID", "DATABASE_URL", "HA_ACCESS_TOKEN", "HA_INSTANCE_ID"],
  ],
  ["apps/automation-service/.env.example", ["PORT", "DATABASE_URL", "TEMPORAL_ADDRESS"]],
  [
    "apps/ai-orchestrator/.env.example",
    [
      "PORT",
      "DATABASE_URL",
      "MODEL_GATEWAY_URL",
      "MODEL_GATEWAY_INTERNAL_TOKEN",
      "AUTOMATION_SERVICE_URL",
    ],
  ],
  [
    "apps/identity/.env.example",
    ["PORT", "DATABASE_URL", "WEBAUTHN_RP_ID", "IDENTITY_SESSION_KEY"],
  ],
  [
    "apps/model-gateway/.env.example",
    ["PORT", "OPENROUTER_API_KEY", "OPENROUTER_MODEL_FAST", "MODEL_GATEWAY_INTERNAL_TOKEN"],
  ],
  [
    "apps/mcp-gateway/.env.example",
    ["PORT", "MCP_BIND_ADDRESS", "MCP_GATEWAY_AUTH_TOKEN", "MCP_REQUEST_STATE_KEY"],
  ],
  ["apps/policy-service/.env.example", ["PORT", "DATABASE_URL", "NATS_URL"]],
  ["apps/notification-service/.env.example", ["PORT", "DATABASE_URL", "NATS_URL"]],
  ["apps/workers-automation/.env.example", ["TEMPORAL_ADDRESS", "TEMPORAL_TASK_QUEUE"]],
  [
    "apps/workers-device-io/.env.example",
    ["NATS_URL", "HOME_CORE_URL", "HA_ACCESS_TOKEN"],
  ],
  ["apps/workers-integrations/.env.example", ["DATABASE_URL", "NATS_URL"]],
  ["apps/workers-agent/.env.example", ["NATS_URL", "TEMPORAL_ADDRESS"]],
  [
    "apps/workers-notifications/.env.example",
    [
      "NATS_URL",
      "TEMPORAL_ADDRESS",
      "TEMPORAL_TASK_QUEUE",
      "HESTIA_WORKER_API_URL",
      "WORKER_SERVICE_TOKEN",
      "INCIDENT_EXTERNAL_WEBHOOK_URL",
      "INCIDENT_EXTERNAL_WEBHOOK_SIGNING_KEY",
    ],
  ],
  [
    "infra/compose/.env.example",
    ["POSTGRES_PASSWORD", "HESTIA_DB_PASSWORD", "TEMPORAL_DB_PASSWORD", "HOME_ID"],
  ],
]);

const secretKeys = new Set([
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "HESTIA_DB_PASSWORD",
  "TEMPORAL_DB_PASSWORD",
  "MINIO_ACCESS_KEY",
  "MINIO_SECRET_KEY",
  "MINIO_ROOT_PASSWORD",
  "OPENROUTER_API_KEY",
  "HA_ACCESS_TOKEN",
  "MODEL_GATEWAY_INTERNAL_TOKEN",
  "IDENTITY_SESSION_KEY",
  "MCP_GATEWAY_AUTH_TOKEN",
  "MCP_REQUEST_STATE_KEY",
  "WORKER_SERVICE_TOKEN",
  "INCIDENT_EXTERNAL_WEBHOOK_SIGNING_KEY",
]);

for (const [relativePath, requiredKeys] of examples) {
  const values = parseEnv(await readFile(path.join(root, relativePath), "utf8"));
  for (const key of requiredKeys) {
    assert(values.has(key), `${relativePath} is missing ${key}`);
  }
  for (const key of secretKeys) {
    if (values.has(key)) {
      assert(values.get(key) === "", `${relativePath} must keep ${key} empty`);
    }
  }
}

for (const relativePath of [
  ".dockerignore",
  "infra/docker/node.Dockerfile",
  "infra/docker/web.Dockerfile",
  "infra/docker/nginx.conf",
  "infra/compose/postgres/init.sh",
]) {
  await access(path.join(root, relativePath));
}

const nodeDockerfile = await readFile(path.join(root, "infra/docker/node.Dockerfile"), "utf8");
assert(nodeDockerfile.includes("FROM node:24"), "Node runtime must stay on the Node 24 line");
assert(nodeDockerfile.includes("USER node"), "Node runtime must run as the node user");

const webDockerfile = await readFile(path.join(root, "infra/docker/web.Dockerfile"), "utf8");
assert(webDockerfile.includes("USER nginx"), "Web runtime must run as the nginx user");

const compose = await readFile(path.join(root, "infra/compose/docker-compose.prod.yml"), "utf8");
for (const service of [
  "postgres",
  "nats",
  "minio",
  "temporal",
  "edge-api",
  "home-core",
  "integration-hub",
  "automation-service",
  "ai-orchestrator",
  "identity",
  "model-gateway",
  "mcp-gateway",
  "policy-service",
  "notification-service",
  "workers-automation",
  "workers-device-io",
  "workers-integrations",
  "workers-agent",
  "workers-notifications",
  "web",
]) {
  assert(new RegExp(`^  ${service}:$`, "m").test(compose), `production Compose is missing ${service}`);
}
assert(!compose.includes("init.sql"), "production Compose must use the credential-aware init.sh");

const aiEnvironment = compose.slice(
  compose.indexOf("  ai-orchestrator:"),
  compose.indexOf("  identity:"),
);
assert(
  !aiEnvironment.includes("OPENROUTER_API_KEY"),
  "ai-orchestrator must not receive the OpenRouter credential",
);

console.log(`container contract valid (${examples.size} env examples, 20 Compose services)`);

function parseEnv(input) {
  const result = new Map();
  for (const rawLine of input.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new Error(`invalid env example line: ${rawLine}`);
    }
    result.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
