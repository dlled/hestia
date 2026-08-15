import type { PingActivities, PingWorkflowInput, PingWorkflowResult } from "@hestia/contracts";
import { proxyActivities, sleep } from "@temporalio/workflow";

const { markAlive } = proxyActivities<PingActivities>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 3,
  },
});

export async function pingWorkflow(input: PingWorkflowInput): Promise<PingWorkflowResult> {
  const holdMs = input.holdMs ?? 2000;
  const started = await markAlive({ requestedBy: input.requestedBy });
  await sleep(holdMs);
  const finished = await markAlive({ requestedBy: input.requestedBy });
  return { started, finished, holdMs };
}
