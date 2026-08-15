import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { createLogger } from "@hestia/observability";
import { listen } from "@hestia/service-runtime";
import { createAutomationApp } from "./app.js";
import { createHttpAutomationHomeGateway } from "./home.js";
import { createAutomationRunMonitor } from "./monitor.js";
import {
  createMemoryAutomationRepository,
  createPostgresAutomationRepository,
} from "./repository.js";
import { connectAutomationTemporal } from "./temporal.js";

const log = createLogger("automation-service");

async function main(): Promise<void> {
  const env = loadEnv();
  const runtimeSmoke = process.env.HESTIA_RUNTIME_SMOKE === "true";
  const repository = runtimeSmoke
    ? createMemoryAutomationRepository()
    : createPostgresAutomationRepository(env.DATABASE_URL);
  await repository.ensureSchema();
  let temporal: Awaited<ReturnType<typeof connectAutomationTemporal>> | undefined;
  if (!runtimeSmoke) {
    try {
      temporal = await connectAutomationTemporal(
        env.TEMPORAL_ADDRESS,
        env.TEMPORAL_NAMESPACE,
        env.TEMPORAL_TASK_QUEUE,
      );
    } catch (error) {
      log.warn({ err: error }, "Temporal unavailable; automation-service will start degraded");
    }
  }
  const monitor = temporal
    ? createAutomationRunMonitor({
        repository,
        temporal,
        onError: (error, workflowId) =>
          log.warn({ err: error, workflowId }, "automation run monitor query failed"),
      })
    : undefined;
  for (const run of await repository.listActiveRuns()) monitor?.track(run.workflowId);
  const shutdown = async (signal: string) => {
    log.info({ signal }, "automation-service stopping");
    await monitor?.close();
    await temporal?.close();
    await repository.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  const home = createHttpAutomationHomeGateway({
    homeCoreUrl: env.HOME_CORE_URL,
    homeId: env.HOME_ID,
  });
  listen(
    createAutomationApp({ repository, temporal, home, monitor }),
    "automation-service",
    resolveServicePort("AUTOMATION_SERVICE_PORT", ServicePorts.automationService),
  );
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    log.fatal({ err: error }, "automation-service failed to start");
    process.exit(1);
  });
}
