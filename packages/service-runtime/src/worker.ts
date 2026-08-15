import { createLogger } from "@hestia/observability";

export interface ReservedWorkerOptions {
  service: string;
  taskQueue: string;
  reservedFor: string;
}

export async function runReservedWorker(options: ReservedWorkerOptions): Promise<void> {
  const log = createLogger(options.service);
  log.info(
    { taskQueue: options.taskQueue, reservedFor: options.reservedFor },
    "reserved worker started",
  );

  await new Promise<void>((resolve) => {
    let stopping = false;
    const keepAlive = setInterval(() => undefined, 60_000);
    const stop = (signal: NodeJS.Signals): void => {
      if (stopping) {
        return;
      }
      stopping = true;
      clearInterval(keepAlive);
      log.info({ signal }, "reserved worker stopping");
      resolve();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
