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
const project = `hestia-phase2-${process.pid}`;
const [haPort, edgePort, webPort] = await Promise.all([availablePort(), availablePort(), availablePort()]);
const accessToken = `phase2-test-${process.pid}`;
const agentic = process.env.HESTIA_PHASE3_BLACKBOX === "true";
const modelToken = `phase3-model-test-${process.pid}`;
const composeEnv = {
  ...process.env,
  POSTGRES_PASSWORD: "phase2-postgres-test",
  HESTIA_DB_PASSWORD: "phase2-hestia-test",
  TEMPORAL_DB_PASSWORD: "phase2-temporal-test",
  MINIO_ROOT_USER: "phase2-minio",
  MINIO_ROOT_PASSWORD: "phase2-minio-test",
  WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
  EDGE_API_PORT: String(edgePort),
  WEB_PORT: String(webPort),
  HOME_ID: "home_primary",
  HA_BASE_URL: `http://host.docker.internal:${haPort}`,
  HA_ACCESS_TOKEN: accessToken,
  HA_INSTANCE_ID: "ha_phase2_blackbox",
  OPENROUTER_API_KEY: agentic ? modelToken : "",
  OPENROUTER_MODEL_FAST: agentic ? "blackbox/intent-model" : "",
  OPENROUTER_BASE_URL: `http://host.docker.internal:${haPort}/openrouter/api/v1`,
  MODEL_GATEWAY_INTERNAL_TOKEN: "phase-blackbox-model-gateway-token",
  IDENTITY_SESSION_KEY: "phase-blackbox-identity-session-key",
  MCP_GATEWAY_AUTH_TOKEN: "phase-blackbox-mcp-token",
  MCP_REQUEST_STATE_KEY: Buffer.alloc(32, 7).toString("base64url"),
};

let lightState = "on";
let alarmState = "disarmed";
let stateChangedAt = new Date().toISOString();
let serviceCalls = 0;
let alarmServiceCalls = 0;
let transitionScheduled = false;
const subscriptions = new Map();

const fakeHomeAssistant = createServer(async (request, response) => {
  if (request.url === "/openrouter/api/v1/chat/completions") {
    assert(agentic, "model endpoint was called outside the Phase 3 black box");
    assert(request.headers.authorization === `Bearer ${modelToken}`, "wrong model credential");
    const body = JSON.parse(await readBody(request));
    assert(body.response_format?.json_schema?.strict === true, "model output was not strict");
    assert(body.provider?.zdr === true, "model request did not require ZDR");
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: "sleep",
                confidence: 0.99,
                summary: "Prepare the observed home for sleep",
                sleep: { climateTargetC: 18, closeCovers: true, armAlarm: true },
              }),
            },
          },
        ],
      }),
    );
    return;
  }
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
    response.end(
      JSON.stringify([
        homeAssistantState("light.bedroom"),
        homeAssistantState("alarm_control_panel.home"),
      ]),
    );
    return;
  }
  if (
    request.method === "POST" &&
    request.url === "/api/services/alarm_control_panel/alarm_arm_away"
  ) {
    const body = JSON.parse(await readBody(request));
    assert(
      body.entity_id === "alarm_control_panel.home",
      "device worker targeted the wrong HA alarm entity",
    );
    serviceCalls += 1;
    alarmServiceCalls += 1;
    setTimeout(() => {
      alarmState = "armed_away";
      stateChangedAt = new Date().toISOString();
      broadcastStateChanged("alarm_control_panel.home");
    }, 500);
    response.end(JSON.stringify({ changed_states: [] }));
    return;
  }
  if (request.method === "POST" && request.url === "/api/services/light/turn_off") {
    const body = JSON.parse(await readBody(request));
    assert(body.entity_id === "light.bedroom", "device worker targeted the wrong HA entity");
    serviceCalls += 1;
    if (!transitionScheduled) {
      transitionScheduled = true;
      setTimeout(() => {
        lightState = "off";
        stateChangedAt = new Date().toISOString();
        broadcastStateChanged("light.bedroom");
      }, 6_000);
    }
    response.end(JSON.stringify({ changed_states: [] }));
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
  socket.on("close", () => subscriptions.delete(socket));
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "auth") {
      socket.send(
        JSON.stringify(
          message.access_token === accessToken
            ? { type: "auth_ok", ha_version: "2026.8.0" }
            : { type: "auth_invalid", message: "invalid token" },
        ),
      );
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
        {
          id: "device-2",
          name: "Home alarm",
          area_id: "bedroom",
          manufacturer: "Acme",
          model: "Secure 1",
          primary_config_entry: "alarm",
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
        {
          entity_id: "alarm_control_panel.home",
          name: null,
          platform: "alarm",
          device_id: "device-2",
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
      subscriptions.set(socket, message.id);
      socket.send(JSON.stringify({ id: message.id, type: "result", success: true, result: null }));
    }
  });
});

await new Promise((resolve) => fakeHomeAssistant.listen(haPort, "0.0.0.0", resolve));

let stackStarted = false;
try {
  stackStarted = true;
  await compose(["up", "--detach", "--build", "--wait", "--wait-timeout", "180"]);
  const edge = `http://127.0.0.1:${edgePort}`;
  await json(`${edge}/api/v1/home/sync`, { method: "POST" });
  await waitForEntity(edge, "light.bedroom", "on");
  await waitForEntity(edge, "alarm_control_panel.home", "disarmed");
  let preview;
  if (agentic) {
    const agentStarted = await json(`${edge}/api/v1/intents/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestedBy: "black-box",
        utterance: "I'm going to sleep; arm the alarm",
      }),
    });
    preview = (await waitForAgentRun(edge, agentStarted.workflowId, "completed")).preview;
  } else {
    preview = await json(`${edge}/api/v1/automations/plans/sleep/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestedBy: "black-box", armAlarm: true }),
    });
  }
  assert(preview.plan?.actions?.length === 2, "sleep preview did not propose both actions");
  assert(
    preview.plan.actions.some((action) => action.command.capability === "security.arm"),
    "sleep preview omitted the requested alarm action",
  );
  const started = await json(`${edge}/api/v1/automations/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(preview.plan),
  });
  assert(started.workflowId, "automation run did not return a workflow id");

  await waitForServiceCall();
  await compose(["kill", "workers-device-io"], true);
  await compose(["up", "--detach", "workers-device-io"], true);
  const approval = await waitForRun(edge, started.workflowId, "awaiting_approval");
  assert(approval.state.actions[0].status === "confirmed", "light action was not confirmed");
  assert(approval.state.pendingApprovalId, "R3 action did not expose an approval id");
  await json(
    `${edge}/api/v1/automations/runs/${encodeURIComponent(started.workflowId)}/approval`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approvalId: approval.state.pendingApprovalId,
        approved: true,
        decidedBy: "black-box-operator",
        decidedAt: new Date().toISOString(),
      }),
    },
  );
  const completed = await waitForRun(edge, started.workflowId, "completed");
  assert(completed.state.actions[0].status === "confirmed", "action was not confirmed");
  assert(completed.state.actions[1].status === "confirmed", "approved alarm action was not confirmed");
  assert(serviceCalls >= 1, "Home Assistant service was not called");
  assert(alarmServiceCalls === 1, "approved alarm action did not execute exactly once");
  await waitForEntity(edge, "light.bedroom", "off");
  await waitForEntity(edge, "alarm_control_panel.home", "armed_away");
  await waitForAudit(edge, started.workflowId, [
    "run.started",
    "approval.submitted",
    "run.state.changed",
  ]);

  await compose(["restart", "automation-service"], true);
  const restored = await waitForRun(edge, started.workflowId, "completed");
  assert(restored.runId === started.runId, "persisted Temporal run identity changed");
  const restoredAudit = await waitForAudit(edge, started.workflowId, ["approval.submitted"]);
  assert(restoredAudit.events.length >= 3, "persisted audit history was incomplete after restart");

  console.log(
    `${agentic ? "phase 3" : "phase 2"} black box valid (${agentic ? "natural-language intent -> strict ZDR model output -> " : ""}preview -> policy approval -> Temporal -> HA, workflow ${started.workflowId} survived worker loss and service restart with its audit trail)`,
  );
} catch (error) {
  if (stackStarted) {
    await compose(
      [
        "logs",
        "--no-color",
        "edge-api",
        "automation-service",
        "ai-orchestrator",
        "model-gateway",
        "workers-automation",
        "workers-device-io",
        "temporal",
      ],
      false,
    ).catch(() => undefined);
  }
  throw error;
} finally {
  if (stackStarted) await compose(["down", "--volumes", "--remove-orphans"], true);
  await new Promise((resolve) => fakeHomeAssistantWebSocket.close(resolve));
  await new Promise((resolve) => fakeHomeAssistant.close(resolve));
}

async function waitForRun(edge, workflowId, expectedStatus) {
  const deadline = Date.now() + 75_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await json(`${edge}/api/v1/automations/runs/${encodeURIComponent(workflowId)}`);
      if (last.state?.status === expectedStatus) return last;
      if (["failed", "rejected", "timed_out"].includes(last.state?.status)) {
        throw new Error(`automation ended as ${last.state.status}: ${JSON.stringify(last)}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("automation ended")) throw error;
    }
    await delay(500);
  }
  throw new Error(`automation did not reach ${expectedStatus}: ${JSON.stringify(last)}`);
}

async function waitForAgentRun(edge, workflowId, expectedStatus) {
  const deadline = Date.now() + 45_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await json(`${edge}/api/v1/intents/runs/${encodeURIComponent(workflowId)}`);
      if (last.status === expectedStatus) return last;
      if (last.status === "failed") throw new Error(`agent workflow failed: ${JSON.stringify(last)}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("agent workflow failed")) throw error;
    }
    await delay(250);
  }
  throw new Error(`agent workflow did not reach ${expectedStatus}: ${JSON.stringify(last)}`);
}

async function waitForAudit(edge, workflowId, expectedTypes) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await json(
        `${edge}/api/v1/automations/runs/${encodeURIComponent(workflowId)}/audit`,
      );
      const types = new Set(last.events?.map((event) => event.eventType));
      if (expectedTypes.every((type) => types.has(type))) return last;
    } catch {
      // The service can be temporarily unavailable during the restart assertion.
    }
    await delay(250);
  }
  throw new Error(`audit did not contain ${expectedTypes.join(", ")}: ${JSON.stringify(last)}`);
}

async function waitForServiceCall() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (serviceCalls > 0) return;
    await delay(100);
  }
  throw new Error("device activity never called Home Assistant");
}

async function waitForEntity(edge, externalEntityId, expectedValue) {
  const deadline = Date.now() + 30_000;
  let last;
  while (Date.now() < deadline) {
    try {
      const body = await json(`${edge}/api/v1/home/entities`);
      last = body;
      const entity = body.entities?.find(
        (candidate) => candidate.externalRef?.entityId === externalEntityId,
      );
      if (entity?.observedState?.value === expectedValue) return entity;
    } catch {
      // Services and event materialization converge asynchronously.
    }
    await delay(250);
  }
  throw new Error(`entity did not reach ${expectedValue}: ${JSON.stringify(last)}`);
}

function broadcastStateChanged(entityId) {
  const newState = homeAssistantState(entityId);
  for (const [socket, subscriptionId] of subscriptions) {
    socket.send(
      JSON.stringify({
        id: subscriptionId,
        type: "event",
        event: {
          event_type: "state_changed",
          data: { entity_id: entityId, old_state: null, new_state: newState },
          origin: "LOCAL",
          time_fired: stateChangedAt,
          context: newState.context,
        },
      }),
    );
  }
}

function homeAssistantState(entityId) {
  return {
    entity_id: entityId,
    state: entityId === "light.bedroom" ? lightState : alarmState,
    attributes: {
      friendly_name: entityId === "light.bedroom" ? "Bedroom lamp" : "Home alarm",
      supported_features: 1,
    },
    last_changed: stateChangedAt,
    last_updated: stateChangedAt,
    context: { id: `context-phase2-${serviceCalls}`, parent_id: null, user_id: null },
  };
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

async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed (${response.status}): ${text}`);
  return JSON.parse(text);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
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
