import { createRequire } from "node:module";
import { loadEnv } from "@hestia/config";
import { TaskQueues } from "@hestia/contracts";
import { createLogger } from "@hestia/observability";
import {
  interpretResidentIntent,
  previewInterpretedSleepIntent,
} from "@hestia/temporal-activities";
import { NativeConnection, Worker } from "@temporalio/worker";

const require = createRequire(import.meta.url);
const log = createLogger("workers-agent");

async function main(): Promise<void> {
  if (process.env.HESTIA_RUNTIME_SMOKE === "true") {
    await waitForShutdown();
    return;
  }
  const env = loadEnv();
  const connection = await NativeConnection.connect({ address: env.TEMPORAL_ADDRESS });
  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TaskQueues.ai,
    workflowsPath: require.resolve("@hestia/temporal-workflows/workflows"),
    activities: { interpretResidentIntent, previewInterpretedSleepIntent },
  });
  log.info({ taskQueue: TaskQueues.ai }, "agent worker started");
  await worker.run();
}

main().catch((error) => {
  log.fatal({ err: error }, "agent worker failed");
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
