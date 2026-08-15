import { createRequire } from "node:module";
import { loadEnv } from "@hestia/config";
import { createLogger } from "@hestia/observability";
import { evaluateCommandPolicy, markAlive } from "@hestia/temporal-activities";
import { NativeConnection, Worker } from "@temporalio/worker";

const require = createRequire(import.meta.url);
const log = createLogger("workers-automation");

async function main(): Promise<void> {
  const env = loadEnv();
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("@hestia/temporal-workflows/workflows"),
    activities: { evaluateCommandPolicy, markAlive },
  });
  log.info({ taskQueue: env.TEMPORAL_TASK_QUEUE }, "automation worker started");
  await worker.run();
}

main().catch((error) => {
  log.fatal({ err: error }, "automation worker failed");
  process.exit(1);
});
