import {
  ActionPlanSchema,
  AgentClarificationSchema,
  AgentIntentStateSchema,
  ApprovalDecisionSchema,
  AutomationRunStateSchema,
  ResidentIntentRequestSchema,
} from "@hestia/contracts";
import { Client, Connection } from "@temporalio/client";
import { api } from "encore.dev/api";

let clientPromise: Promise<Client> | undefined;

async function temporalClient(): Promise<Client> {
  clientPromise ??= Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  }).then(
    (connection) =>
      new Client({
        connection,
        namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
      }),
  );
  return clientPromise;
}

export const status = api(
  { method: "GET", path: "/internal/temporal/status" },
  async (): Promise<{ engine: "temporal"; ownership: "external"; taskQueue: string }> => ({
    engine: "temporal",
    ownership: "external",
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "hestia-automation",
  }),
);

export const startActionPlan = api(
  { method: "POST", path: "/internal/temporal/action-plans/start" },
  async ({ planJson }: { planJson: string }): Promise<{ workflowId: string; runId: string }> => {
    const plan = ActionPlanSchema.parse(JSON.parse(planJson));
    const workflowId = `hestia-wf-${plan.planId}-${plan.version}`;
    const handle = await (await temporalClient()).workflow.start("actionPlanWorkflow", {
      workflowId,
      taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "hestia-automation",
      args: [plan],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  },
);

export const actionPlanState = api(
  { method: "GET", path: "/internal/temporal/action-plans/:workflowId" },
  async ({ workflowId }: { workflowId: string }): Promise<{ stateJson: string }> => {
    const state = await (await temporalClient()).workflow
      .getHandle(workflowId)
      .query("automationState");
    return { stateJson: JSON.stringify(AutomationRunStateSchema.parse(state)) };
  },
);

export const approveActionPlan = api(
  { method: "POST", path: "/internal/temporal/action-plans/:workflowId/approval" },
  async ({
    workflowId,
    decisionJson,
  }: {
    workflowId: string;
    decisionJson: string;
  }): Promise<{ accepted: true }> => {
    const decision = ApprovalDecisionSchema.parse(JSON.parse(decisionJson));
    await (await temporalClient()).workflow
      .getHandle(workflowId)
      .signal("approvalDecision", decision);
    return { accepted: true };
  },
);

export const cancelActionPlan = api(
  { method: "POST", path: "/internal/temporal/action-plans/:workflowId/cancel" },
  async ({ workflowId }: { workflowId: string }): Promise<{ accepted: true }> => {
    await (await temporalClient()).workflow.getHandle(workflowId).signal("cancelAutomation");
    return { accepted: true };
  },
);

export const startAgentIntent = api(
  { method: "POST", path: "/internal/temporal/agent-intents/start" },
  async ({
    requestJson,
  }: {
    requestJson: string;
  }): Promise<{ workflowId: string; runId: string }> => {
    const request = ResidentIntentRequestSchema.parse(JSON.parse(requestJson));
    const workflowId = `hestia-agent-${globalThis.crypto.randomUUID()}`;
    const handle = await (await temporalClient()).workflow.start("agentIntentWorkflow", {
      workflowId,
      taskQueue: process.env.TEMPORAL_AI_TASK_QUEUE ?? "hestia-ai",
      args: [request],
    });
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  },
);

export const agentIntentState = api(
  { method: "GET", path: "/internal/temporal/agent-intents/:workflowId" },
  async ({ workflowId }: { workflowId: string }): Promise<{ stateJson: string }> => {
    const state = await (await temporalClient()).workflow
      .getHandle(workflowId)
      .query("agentIntentState");
    return { stateJson: JSON.stringify(AgentIntentStateSchema.parse(state)) };
  },
);

export const clarifyAgentIntent = api(
  { method: "POST", path: "/internal/temporal/agent-intents/:workflowId/clarification" },
  async ({
    workflowId,
    clarificationJson,
  }: {
    workflowId: string;
    clarificationJson: string;
  }): Promise<{ accepted: true }> => {
    const clarification = AgentClarificationSchema.parse(JSON.parse(clarificationJson));
    await (await temporalClient()).workflow
      .getHandle(workflowId)
      .signal("agentClarification", clarification);
    return { accepted: true };
  },
);
