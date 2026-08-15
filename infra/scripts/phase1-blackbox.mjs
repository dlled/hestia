#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const composeFile = "infra/compose/docker-compose.prod.yml";
const envFile = "infra/compose/.env.example";
const project = `hestia-phase1-${process.pid}`;
const [haPort, edgePort, webPort] = await Promise.all([availablePort(), availablePort(), availablePort()]);
const accessToken = `phase1-test-${process.pid}`;
const composeEnv = {
  ...process.env,
  POSTGRES_PASSWORD: "phase1-postgres-test",
  HESTIA_DB_PASSWORD: "phase1-hestia-test",
  TEMPORAL_DB_PASSWORD: "phase1-temporal-test",
  MINIO_ROOT_USER: "phase1-minio",
  MINIO_ROOT_PASSWORD: "phase1-minio-test",
  WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  EDGE_API_PORT: String(edgePort),
  WEB_PORT: String(webPort),
  HOME_ID: "home_primary",
  HA_BASE_URL: `http://host.docker.internal:${haPort}`,
  HA_ACCESS_TOKEN: accessToken,
  HA_INSTANCE_ID: "ha_blackbox",
};

const fakeHomeAssistant = createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${accessToken}`) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ message: "unauthorized" }));
    return;
  }
  response.setHeader("content-type", "application/json");
  if (request.url === "/api/") {
    response.end(JSON.stringify({ message: "API running." }));
    return;
  }
  if (request.url === "/api/states") {
    response.end(JSON.stringify([homeAssistantState()]));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ message: "not found" }));
});
const fakeHomeAssistantWebSocket = new WebSocketServer({
  server: fakeHomeAssistant,
  path: "/api/websocket",
});

fakeHomeAssistantWebSocket.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "auth_required", ha_version: "2026.8.0" }));
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "auth") {
      if (message.access_token !== accessToken) {
        socket.send(JSON.stringify({ type: "auth_invalid", message: "invalid token" }));
        return;
      }
      socket.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.8.0" }));
      return;
    }
    const results = {
      "config/area_registry/list": [{ area_id: "bedroom", name: "Bedroom" }],
      "config/device_registry/list": [
        {
          id: "device-1",
          name: "Bedside bulb",
          area_id: "bedroom",
          manufacturer: "Acme",
          model: "A1",
          primary_config_entry: "hue",
        },
      ],
      "config/entity_registry/list": [
        {
          entity_id: "light.bedroom",
          name: null,
          platform: "hue",
          device_id: "device-1",
          area_id: null,
          disabled_by: null,
        },
      ],
    };
    if (message.type in results) {
      socket.send(
        JSON.stringify({
          id: message.id,
          type: "result",
          success: true,
          result: results[message.type],
        }),
      );
      return;
    }
    if (message.type === "subscribe_events") {
      socket.send(JSON.stringify({ id: message.id, type: "result", success: true, result: null }));
    }
  });
});

await new Promise((resolve) => fakeHomeAssistant.listen(haPort, "0.0.0.0", resolve));

let stackStarted = false;
try {
  stackStarted = true;
  await compose(["up", "--detach", "--build", "--wait", "--wait-timeout", "150"]);

  const edge = `http://127.0.0.1:${edgePort}`;
  const sync = await json(`${edge}/api/v1/home/sync`, { method: "POST" });
  assert(sync.discovered === 1 && sync.published === 1, "sync result is incomplete");
  assert(sync.topology === "available", "registry discovery is degraded");
  assert(sync.areas === 1 && sync.devices === 1, "topology counts are incomplete");
  const checkpoint = await json(`${edge}/api/v1/home/integration-status`);
  assert(checkpoint.rest && checkpoint.topology, "integration checkpoint is incomplete");
  assert(checkpoint.discoveredEntities === 1, "integration checkpoint entity count is missing");

  const first = await waitForEntity(edge, "on");
  assert(first.externalRef.entityId === "light.bedroom", "canonical external reference is missing");
  assert(first.externalRef.instanceId === "ha_blackbox", "integration identity was not preserved");
  const topology = await waitForTopology(edge);
  assert(first.areaId === topology.areas[0].id, "entity area association is missing");
  assert(first.deviceId === topology.devices[0].id, "entity device association is missing");
  const sleepContext = await json(`${edge}/api/v1/home/contexts/sleep`);
  assert(sleepContext.summary.relevant === 1, "sleep context did not include the light");

  await compose(["restart", "home-core"]);
  const persisted = await waitForEntity(edge, "on");
  assert(persisted.id === first.id, "stable entity identity changed after restart");
  const persistedTopology = await waitForTopology(edge);
  assert(persistedTopology.areas[0].id === topology.areas[0].id, "area identity changed after restart");

  await compose(["restart", "integration-hub"]);
  const persistedCheckpoint = await waitForCheckpoint(edge);
  assert(persistedCheckpoint.instanceId === "ha_blackbox", "checkpoint identity changed");

  console.log(
    `phase 1 black box valid (HA REST/WS -> JetStream -> Postgres -> edge, entity ${first.id} and topology persisted)`,
  );
} catch (error) {
  if (stackStarted) {
    await compose(["logs", "--no-color", "integration-hub", "home-core", "nats", "postgres"], false)
      .catch(() => undefined);
  }
  throw error;
} finally {
  if (stackStarted) await compose(["down", "--volumes", "--remove-orphans"], true);
  await new Promise((resolve) => fakeHomeAssistantWebSocket.close(resolve));
  await new Promise((resolve) => fakeHomeAssistant.close(resolve));
}

async function waitForCheckpoint(edge) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await json(`${edge}/api/v1/home/integration-status`);
      if (last.lastSuccessfulSyncAt && last.discoveredEntities === 1) return last;
    } catch {
      // integration-hub may still be reconnecting after an intentional restart.
    }
    await delay(250);
  }
  throw new Error(`integration checkpoint was not restored: ${JSON.stringify(last)}`);
}

async function waitForTopology(edge) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await json(`${edge}/api/v1/home/topology`);
      if (last.areas?.length === 1 && last.devices?.length === 1) return last;
    } catch {
      // The topology event and HTTP service may still be converging.
    }
    await delay(250);
  }
  throw new Error(`topology was not materialized: ${JSON.stringify(last)}`);
}

function compose(args, quiet = false) {
  return run(
    "docker",
    ["compose", "-p", project, "--env-file", envFile, "-f", composeFile, ...args],
    quiet,
  );
}

function run(command, args, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: composeEnv,
      stdio: quiet ? "ignore" : "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function waitForEntity(edge, expectedValue) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      const body = await json(`${edge}/api/v1/home/entities`);
      last = body;
      const entity = body.entities?.find(
        (candidate) => candidate.externalRef?.entityId === "light.bedroom",
      );
      if (entity?.observedState?.value === expectedValue) return entity;
    } catch {
      // home-core may still be reconnecting after an intentional restart.
    }
    await delay(250);
  }
  throw new Error(`entity was not materialized: ${JSON.stringify(last)}`);
}

async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

function homeAssistantState() {
  return {
    entity_id: "light.bedroom",
    state: "on",
    attributes: { friendly_name: "Bedroom lamp", supported_features: 1 },
    last_changed: "2026-08-14T20:00:00.000Z",
    last_updated: "2026-08-14T20:00:00.000Z",
    context: { id: "context-blackbox", parent_id: null, user_id: null },
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("failed to allocate a port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
