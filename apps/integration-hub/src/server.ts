import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { createInMemoryEntityEventBus, createNatsEntityEventBus } from "@hestia/event-bus";
import { createHomeAssistantClient } from "@hestia/ha-client";
import { createLogger } from "@hestia/observability";
import { listen } from "@hestia/service-runtime";
import { createIntegrationHubApp } from "./app.js";
import {
  createMemoryCheckpointRepository,
  createPostgresCheckpointRepository,
} from "./checkpoints.js";
import { createHomeAssistantIngestor } from "./ingestor.js";

const log = createLogger("integration-hub");

async function main(): Promise<void> {
  const env = loadEnv();
  const runtimeSmoke = process.env.HESTIA_RUNTIME_SMOKE === "true";
  const bus = runtimeSmoke
    ? createInMemoryEntityEventBus()
    : await createNatsEntityEventBus(env.NATS_URL);
  const checkpoints = runtimeSmoke
    ? createMemoryCheckpointRepository()
    : createPostgresCheckpointRepository(env.DATABASE_URL);
  await checkpoints.ensureSchema();
  const ingestor =
    env.HA_BASE_URL && env.HA_ACCESS_TOKEN
      ? createHomeAssistantIngestor({
          client: createHomeAssistantClient({
            baseUrl: env.HA_BASE_URL,
            accessToken: env.HA_ACCESS_TOKEN,
          }),
          publisher: bus,
          homeId: env.HOME_ID,
          instanceId: env.HA_INSTANCE_ID,
          checkpoints,
        })
      : undefined;

  if (ingestor) {
    try {
      await ingestor.sync();
      log.info({ instanceId: env.HA_INSTANCE_ID }, "Home Assistant discovery synchronized");
    } catch (error) {
      log.warn({ err: error }, "Home Assistant REST unavailable; integration-hub is degraded");
    }
    try {
      await ingestor.startStreaming();
      log.info({ instanceId: env.HA_INSTANCE_ID }, "Home Assistant state stream started");
    } catch (error) {
      log.warn(
        { err: error },
        "Home Assistant state stream unavailable; polling sync remains available",
      );
    }
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, "integration-hub stopping");
    await ingestor?.close();
    await bus.close();
    await checkpoints.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  listen(
    createIntegrationHubApp({ ingestor }),
    "integration-hub",
    resolveServicePort("INTEGRATION_HUB_PORT", ServicePorts.integrationHub),
  );
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    log.fatal({ err: error }, "integration-hub failed to start");
    process.exit(1);
  });
}
