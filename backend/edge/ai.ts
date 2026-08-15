import { api } from "encore.dev/api";
import { ai, modelgateway } from "~encore/clients";
import type {
  AgentClarificationView,
  AgentIntentStateView,
  IntentInterpretationView,
  IntentPlanPreviewView,
  ResidentIntentRequestView,
} from "../shared/contracts";

export const interpretIntent = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/intents/interpret" },
  async (input: ResidentIntentRequestView): Promise<IntentInterpretationView> =>
    ai.interpretIntent(input),
);

export const previewIntent = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/intents/preview" },
  async (input: ResidentIntentRequestView): Promise<IntentPlanPreviewView> =>
    ai.previewIntent(input),
);

export const startIntentRun = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/intents/runs" },
  async (input: ResidentIntentRequestView): Promise<{ workflowId: string; runId: string }> =>
    ai.startIntentRun(input),
);

export const getIntentRun = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/intents/runs/:workflowId" },
  async ({ workflowId }: { workflowId: string }): Promise<AgentIntentStateView> =>
    ai.getIntentRun({ workflowId }),
);

export const clarifyIntentRun = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/intents/runs/:workflowId/clarification",
  },
  async (input: AgentClarificationView): Promise<{ accepted: true }> => ai.clarifyIntentRun(input),
);

export const modelGatewayStatus = api(
  { expose: true, method: "GET", path: "/api/v1/models/status" },
  async (): Promise<{ provider: "openrouter"; profile: "intent-fast"; isolated: true }> =>
    modelgateway.status(),
);
