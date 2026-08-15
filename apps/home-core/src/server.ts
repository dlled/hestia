import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { createInMemoryEntityEventBus, createNatsEntityEventBus } from "@hestia/event-bus";
import { createLogger } from "@hestia/observability";
import { listen } from "@hestia/service-runtime";
import { createHomeCoreApp } from "./app.js";
import { createHomeEventMaterializer } from "./materializer.js";
import { createMemoryTwinRepository, createPostgresTwinRepository } from "./repository.js";

const log = createLogger("home-core");

async function main(): Promise<void> {
  const env = loadEnv();
  const runtimeSmoke = process.env.HESTIA_RUNTIME_SMOKE === "true";
  const repository = runtimeSmoke
    ? createMemoryTwinRepository()
    : createPostgresTwinRepository(env.DATABASE_URL);
  await repository.ensureSchema();
  const bus = runtimeSmoke
    ? createInMemoryEntityEventBus()
    : await createNatsEntityEventBus(env.NATS_URL);
  let eventLaneConnected = false;
  const subscription = await bus.subscribe(
    "hestia-home-core-entity-materializer",
    createHomeEventMaterializer(repository),
    (error) => log.error({ err: error }, "home observation could not be materialized"),
  );
  eventLaneConnected = true;

  const shutdown = async (signal: string) => {
    log.info({ signal }, "home-core stopping");
    eventLaneConnected = false;
    await subscription.close();
    await bus.close();
    await repository.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  listen(
    createHomeCoreApp({ repository, eventLaneConnected: () => eventLaneConnected }),
    "home-core",
    resolveServicePort("HOME_CORE_PORT", ServicePorts.homeCore),
  );
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    log.fatal({ err: error }, "home-core failed to start");
    process.exit(1);
  });
}
