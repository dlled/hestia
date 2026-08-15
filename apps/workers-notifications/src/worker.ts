import { TaskQueues } from "@hestia/contracts";
import { runReservedWorker } from "@hestia/service-runtime";

await runReservedWorker({
  service: "workers-notifications",
  taskQueue: TaskQueues.notifications,
  reservedFor: "incident escalation and notification delivery",
});
