import {
  type ActionPlan,
  type ApprovalDecision,
  type AutomationRunState,
  createId,
} from "@hestia/contracts";
import {
  actionPlanWorkflow,
  approvalDecisionSignal,
  automationStateQuery,
  cancelAutomationSignal,
} from "@hestia/temporal-workflows";
import { Client, Connection, type WorkflowHandle } from "@temporalio/client";

export interface StartedAutomation {
  workflowId: string;
  runId: string;
}

export interface AutomationTemporalGateway {
  start(plan: ActionPlan): Promise<StartedAutomation>;
  state(workflowId: string): Promise<AutomationRunState>;
  approve(workflowId: string, decision: ApprovalDecision): Promise<void>;
  cancel(workflowId: string): Promise<void>;
  close(): Promise<void>;
}

export async function connectAutomationTemporal(
  address: string,
  namespace: string,
  taskQueue: string,
): Promise<AutomationTemporalGateway> {
  const connection = await Connection.connect({ address });
  const client = new Client({ connection, namespace });
  return createAutomationTemporalGateway(client, taskQueue, () => connection.close());
}

export function createAutomationTemporalGateway(
  client: Pick<Client, "workflow">,
  taskQueue: string,
  close: () => Promise<void> = async () => undefined,
): AutomationTemporalGateway {
  const handle = (workflowId: string): WorkflowHandle<typeof actionPlanWorkflow> =>
    client.workflow.getHandle(workflowId);
  return {
    async start(plan) {
      const workflowId = `hestia-${createId("wf")}`;
      const started = await client.workflow.start(actionPlanWorkflow, {
        workflowId,
        taskQueue,
        args: [plan],
      });
      return { workflowId: started.workflowId, runId: started.firstExecutionRunId };
    },
    async state(workflowId) {
      return handle(workflowId).query(automationStateQuery);
    },
    async approve(workflowId, decision) {
      await handle(workflowId).signal(approvalDecisionSignal, decision);
    },
    async cancel(workflowId) {
      await handle(workflowId).signal(cancelAutomationSignal);
    },
    close,
  };
}
