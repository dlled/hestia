#!/usr/bin/env node
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

await run("docker", ["compose", "-f", "infra/compose/docker-compose.yml", "up", "-d"]);

await waitForPort("127.0.0.1", 5432, "postgres");
await waitForPort("127.0.0.1", 7233, "temporal");

try {
  await run("node", ["infra/scripts/migrate.mjs"]);
} catch (error) {
  console.warn("schema migrate skipped (psql missing or DB not ready):", error.message);
}

const children = [
  start("home-core", ["pnpm", "--filter", "@hestia/home-core", "dev"]),
  start("integration-hub", ["pnpm", "--filter", "@hestia/integration-hub", "dev"]),
  start("edge-api", ["pnpm", "--filter", "@hestia/edge-api", "dev"]),
  start("worker", ["pnpm", "--filter", "@hestia/workers-automation", "dev"]),
  start("web", ["pnpm", "--filter", "@hestia/web", "dev"]),
];

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) {
      child.kill("SIGTERM");
    }
    process.exit(0);
  });
}

function start(name, args) {
  const child = spawn(args[0], args.slice(1), {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: process.env.FORCE_COLOR ?? "1" },
  });
  child.on("exit", (code) => {
    console.log(`${name} exited (${code ?? "null"})`);
  });
  return child;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
      }
    });
  });
}

async function waitForPort(host, port, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const open = await canConnect(host, port);
    if (open) {
      console.log(`${label} is ready on ${host}:${port}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${label} on ${host}:${port}`);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}
