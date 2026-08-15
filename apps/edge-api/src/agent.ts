import {
  type AgentClarification,
  AgentClarificationSchema,
  type AgentIntentState,
  AgentIntentStateSchema,
  type IntentPlanPreviewResponse,
  IntentPlanPreviewResponseSchema,
  type ResidentIntentRequest,
  ResidentIntentRequestSchema,
} from "@hestia/contracts";

export interface AgentGateway {
  previewIntent(input: ResidentIntentRequest): Promise<IntentPlanPreviewResponse>;
  startIntent(input: ResidentIntentRequest): Promise<{ workflowId: string; runId: string }>;
  getIntentRun(workflowId: string): Promise<AgentIntentState>;
  clarifyIntent(workflowId: string, input: AgentClarification): Promise<{ accepted: boolean }>;
}

export function createHttpAgentGateway(options: {
  aiOrchestratorUrl: string;
  fetch?: typeof globalThis.fetch;
}): AgentGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async previewIntent(input) {
      const response = await fetchImpl(
        `${options.aiOrchestratorUrl.replace(/\/$/u, "")}/api/v1/intents/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(ResidentIntentRequestSchema.parse(input)),
        },
      );
      if (!response.ok) throw new Error(`AI intent preview failed (${response.status})`);
      return IntentPlanPreviewResponseSchema.parse(await response.json());
    },
    async startIntent(input) {
      return request(
        fetchImpl,
        `${options.aiOrchestratorUrl.replace(/\/$/u, "")}/api/v1/intents/runs`,
        { method: "POST", body: ResidentIntentRequestSchema.parse(input) },
      );
    },
    async getIntentRun(workflowId) {
      const response = await fetchImpl(
        `${options.aiOrchestratorUrl.replace(/\/$/u, "")}/api/v1/intents/runs/${encodeURIComponent(workflowId)}`,
      );
      if (!response.ok) throw new Error(`AI intent run failed (${response.status})`);
      return AgentIntentStateSchema.parse(await response.json());
    },
    async clarifyIntent(workflowId, input) {
      return request(
        fetchImpl,
        `${options.aiOrchestratorUrl.replace(/\/$/u, "")}/api/v1/intents/runs/${encodeURIComponent(workflowId)}/clarification`,
        { method: "POST", body: AgentClarificationSchema.parse(input) },
      );
    },
  };
}

async function request<T>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  options: { method: string; body: unknown },
): Promise<T> {
  const response = await fetchImpl(url, {
    method: options.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(options.body),
  });
  if (!response.ok) throw new Error(`AI intent request failed (${response.status})`);
  return (await response.json()) as T;
}
