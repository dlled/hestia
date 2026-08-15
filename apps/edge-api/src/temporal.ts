import type { PingWorkflowResult, PingWorkflowStatus } from "@hestia/contracts";
import { pingWorkflow } from "@hestia/temporal-workflows";
import { Client, Connection, type WorkflowHandle } from "@temporalio/client";

export interface TemporalGateway {
  startPing(input: { requestedBy: string; holdMs?: number }): Promise<{
    workflowId: string;
    runId: string;
  }>;
  describePing(workflowId: string): Promise<PingWorkflowStatus>;
  close(): Promise<void>;
}

export async function connectTemporal(address: string, namespace: string): Promise<Client> {
  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace });
}

export function createTemporalGateway(
  client: Pick<Client, "workflow">,
  taskQueue: string,
): TemporalGateway {
  return {
    async startPing(input) {
      const workflowId = `hestia-ping-${input.requestedBy}-${Date.now()}`;
      const handle = await client.workflow.start(pingWorkflow, {
        taskQueue,
        workflowId,
        args: [{ requestedBy: input.requestedBy, holdMs: input.holdMs ?? 2000 }],
      });
      return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
    },
    async describePing(workflowId) {
      const handle: WorkflowHandle<typeof pingWorkflow> = client.workflow.getHandle(workflowId);
      const description = await handle.describe();
      const status = mapStatus(description.status.name);
      let result: PingWorkflowResult | undefined;
      if (status === "completed") {
        result = await handle.result();
      }
      return {
        workflowId,
        runId: description.runId,
        status,
        result,
      };
    },
    async close() {
      return;
    },
  };
}

function mapStatus(name: string): PingWorkflowStatus["status"] {
  switch (name) {
    case "RUNNING":
      return "running";
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "CANCELLED":
    case "CANCELED":
      return "cancelled";
    case "TERMINATED":
      return "terminated";
    case "TIMED_OUT":
      return "timed_out";
    default:
      return "running";
  }
}
