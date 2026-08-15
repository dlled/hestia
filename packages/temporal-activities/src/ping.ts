import type { PingMark } from "@hestia/contracts";
import { Context } from "@temporalio/activity";

export async function markAlive(input: { requestedBy: string }): Promise<PingMark> {
  const info = Context.current().info;
  return {
    at: new Date().toISOString(),
    workerId: info.taskQueue,
    requestedBy: input.requestedBy,
  };
}
