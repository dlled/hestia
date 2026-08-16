import { createRequire } from "node:module";
import { loadEnv } from "@hestia/config";
import { TaskQueues } from "@hestia/contracts";
import { createNatsEntityEventBus } from "@hestia/event-bus";
import { createLogger } from "@hestia/observability";
import {
  appendIncidentEvent,
  createIncidentRecord,
  deliverIncidentNotification,
  transitionIncidentRecord,
} from "@hestia/temporal-activities";
import { Client, Connection } from "@temporalio/client";
import { NativeConnection, Worker } from "@temporalio/worker";
import { loadActiveLeakPlaybook, startLeakIncident } from "./leak-trigger.js";

const require = createRequire(import.meta.url);
const log = createLogger("workers-notifications");

async function main(): Promise<void> {
  if (process.env.HESTIA_RUNTIME_SMOKE === "true") {
    await waitForShutdown();
    return;
  }
  const environment = loadEnv();
  const [workerConnection, clientConnection, eventBus] = await Promise.all([
    NativeConnection.connect({ address: environment.TEMPORAL_ADDRESS }),
    Connection.connect({ address: environment.TEMPORAL_ADDRESS }),
    createNatsEntityEventBus(environment.NATS_URL),
  ]);
  const temporal = new Client({
    connection: clientConnection,
    namespace: environment.TEMPORAL_NAMESPACE,
  });
  const worker = await Worker.create({
    connection: workerConnection,
    namespace: environment.TEMPORAL_NAMESPACE,
    taskQueue: TaskQueues.notifications,
    workflowsPath: require.resolve("@hestia/temporal-workflows/workflows"),
    activities: {
      appendIncidentEvent,
      createIncidentRecord,
      deliverIncidentNotification,
      transitionIncidentRecord,
    },
  });
  const subscription = await eventBus.subscribe(
    "hestia-leak-incidents-v1",
    async (event) => {
      const playbook = await loadActiveLeakPlaybook(event, environment);
      if (!playbook) return;
      const started = await startLeakIncident(temporal, event, playbook);
      if (started) {
        log.warn(
          { workflowId: started.workflowId, eventId: event.eventId, homeId: event.homeId },
          "leak incident accepted",
        );
      }
    },
    (error) => log.error({ err: error }, "leak incident event rejected"),
  );

  const stop = async () => {
    await subscription.close();
    await eventBus.close();
    worker.shutdown();
    await Promise.allSettled([workerConnection.close(), clientConnection.close()]);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void stop());
  log.info({ taskQueue: TaskQueues.notifications }, "notification incident worker started");
  await worker.run();
}

main().catch((error) => {
  log.fatal({ err: error }, "notification incident worker failed");
  process.exit(1);
});

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    const keepAlive = setInterval(() => undefined, 60_000);
    const stop = () => {
      clearInterval(keepAlive);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
