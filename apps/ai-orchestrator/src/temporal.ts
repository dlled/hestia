import {
  type AgentClarification,
  type AgentIntentState,
  createId,
  type ResidentIntentRequest,
  TaskQueues,
} from "@hestia/contracts";
import {
  agentClarificationSignal,
  agentIntentStateQuery,
  agentIntentWorkflow,
} from "@hestia/temporal-workflows";
import { Client, Connection } from "@temporalio/client";

export interface AgentTemporalGateway {
  start(input: ResidentIntentRequest): Promise<{ workflowId: string; runId: string }>;
  state(workflowId: string): Promise<AgentIntentState>;
  clarify(workflowId: string, input: AgentClarification): Promise<void>;
  close(): Promise<void>;
}

export async function connectAgentTemporal(
  address: string,
  namespace: string,
): Promise<AgentTemporalGateway> {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  return {
    async start(input) {
      const handle = await client.workflow.start(agentIntentWorkflow, {
        workflowId: `hestia-${createId("wf")}`,
        taskQueue: TaskQueues.ai,
        args: [input],
      });
      return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
    },
    async state(workflowId) {
      return client.workflow.getHandle(workflowId).query(agentIntentStateQuery);
    },
    async clarify(workflowId, input) {
      await client.workflow.getHandle(workflowId).signal(agentClarificationSignal, input);
    },
    async close() {
      await connection.close();
    },
  };
}
