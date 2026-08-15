#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const services = [
  ["home-core", "apps/home-core/dist/server.js"],
  ["integration-hub", "apps/integration-hub/dist/server.js"],
  ["automation-service", "apps/automation-service/dist/server.js"],
  ["ai-orchestrator", "apps/ai-orchestrator/dist/server.js"],
  ["identity", "apps/identity/dist/server.js"],
  ["model-gateway", "apps/model-gateway/dist/server.js"],
  ["mcp-gateway", "apps/mcp-gateway/dist/server.js"],
  ["policy-service", "apps/policy-service/dist/server.js"],
  ["notification-service", "apps/notification-service/dist/server.js"],
];

await expectCleanImport("apps/edge-api/dist/server.js");

for (const [service, entrypoint] of services) {
  const port = await availablePort();
  const child = start(entrypoint, { PORT: String(port), TEMPORAL_ADDRESS: "127.0.0.1:1" });
  try {
    const response = await waitForHealth(service, port, child);
    const body = await response.json();
    if (body.service !== service || body.status !== "ok") {
      throw new Error(`${service} returned an invalid health contract`);
    }
  } finally {
    await stop(child);
  }
}

for (const entrypoint of [
  "apps/workers-agent/dist/worker.js",
  "apps/workers-device-io/dist/worker.js",
  "apps/workers-integrations/dist/worker.js",
  "apps/workers-notifications/dist/worker.js",
]) {
  const child = start(entrypoint);
  await ensureAlive(child, 300);
  await stop(child);
}

console.log(
  `runtime smoke valid (edge API import, ${services.length} HTTP services, 3 reserved workers, 1 device worker)`,
);

function start(entrypoint, extraEnv = {}) {
  return spawn(process.execPath, [path.join(root, entrypoint)], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: "production",
      HESTIA_ENV: "test",
      LOG_LEVEL: "silent",
      HESTIA_RUNTIME_SMOKE: "true",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(service, port, child) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`service exited before health check (${await output(child)})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return response;
      }
    } catch {
      // The process may still be binding its port.
    }
    await delay(75);
  }
  throw new Error(`${service} did not become healthy on port ${port}`);
}

async function expectCleanImport(entrypoint) {
  const child = spawn(process.execPath, [path.join(root, entrypoint)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "test", HESTIA_ENV: "test", LOG_LEVEL: "silent" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitCode = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000).then(() => {
      child.kill("SIGKILL");
      throw new Error(`${entrypoint} did not finish its test-mode import`);
    }),
  ]);
  if (exitCode !== 0) {
    throw new Error(`${entrypoint} failed to import (${await output(child)})`);
  }
}

async function ensureAlive(child, milliseconds) {
  await delay(milliseconds);
  if (child.exitCode !== null) {
    throw new Error(`reserved worker exited early (${await output(child)})`);
  }
}

async function stop(child) {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000).then(() => {
      child.kill("SIGKILL");
      throw new Error("child process did not stop after SIGTERM");
    }),
  ]);
}

async function output(child) {
  const chunks = [];
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    for await (const chunk of stream) chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close();
        reject(new Error("failed to allocate a TCP port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}
