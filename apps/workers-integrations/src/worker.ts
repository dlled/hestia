import { TaskQueues } from "@hestia/contracts";
import { runReservedWorker } from "@hestia/service-runtime";

await runReservedWorker({
  service: "workers-integrations",
  taskQueue: TaskQueues.integrations,
  reservedFor: "connector synchronization in Phase 1",
});
