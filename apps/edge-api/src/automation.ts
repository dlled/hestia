import {
  type ActionPlan,
  ActionPlanSchema,
  type ApprovalDecision,
  type AutomationAuditResponse,
  AutomationAuditResponseSchema,
  type AutomationRunState,
  AutomationRunStateSchema,
  type SleepPlanPreview,
  type SleepPlanPreviewRequest,
  SleepPlanPreviewSchema,
} from "@hestia/contracts";

export interface AutomationRunView {
  workflowId: string;
  runId: string;
  planId: string;
  version: number;
  startedAt: string;
  state: AutomationRunState;
}

export interface AutomationGateway {
  previewSleepPlan(options: SleepPlanPreviewRequest): Promise<SleepPlanPreview>;
  publish(plan: ActionPlan): Promise<ActionPlan>;
  start(plan: ActionPlan): Promise<Record<string, unknown>>;
  startPublished(
    planId: string,
    version: number,
    requestedBy?: string,
  ): Promise<Record<string, unknown>>;
  getRun(workflowId: string): Promise<AutomationRunView>;
  getAudit(workflowId: string): Promise<AutomationAuditResponse>;
  approve(workflowId: string, decision: ApprovalDecision): Promise<Record<string, unknown>>;
  cancel(workflowId: string): Promise<Record<string, unknown>>;
}

export function createHttpAutomationGateway(options: {
  automationServiceUrl: string;
  fetch?: typeof globalThis.fetch;
}): AutomationGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.automationServiceUrl.replace(/\/$/u, "");
  return {
    async previewSleepPlan(input) {
      return SleepPlanPreviewSchema.parse(
        await request(fetchImpl, `${baseUrl}/api/v1/plans/sleep/preview`, input),
      );
    },
    async publish(plan) {
      return ActionPlanSchema.parse(await request(fetchImpl, `${baseUrl}/api/v1/plans`, plan, 201));
    },
    async start(plan) {
      return asObject(await request(fetchImpl, `${baseUrl}/api/v1/runs`, plan, 202));
    },
    async startPublished(planId, version, requestedBy) {
      return asObject(
        await request(
          fetchImpl,
          `${baseUrl}/api/v1/plans/${encodeURIComponent(planId)}/versions/${version}/runs`,
          requestedBy ? { requestedBy } : {},
          202,
        ),
      );
    },
    async getRun(workflowId) {
      const value = asObject(
        await request(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(workflowId)}`),
      );
      return {
        workflowId: requiredString(value.workflowId, "workflowId"),
        runId: requiredString(value.runId, "runId"),
        planId: requiredString(value.planId, "planId"),
        version: requiredNumber(value.version, "version"),
        startedAt: requiredString(value.startedAt, "startedAt"),
        state: AutomationRunStateSchema.parse(value.state),
      };
    },
    async getAudit(workflowId) {
      return AutomationAuditResponseSchema.parse(
        await request(fetchImpl, `${baseUrl}/api/v1/runs/${encodeURIComponent(workflowId)}/audit`),
      );
    },
    async approve(workflowId, decision) {
      return asObject(
        await request(
          fetchImpl,
          `${baseUrl}/api/v1/runs/${encodeURIComponent(workflowId)}/approval`,
          decision,
          202,
        ),
      );
    },
    async cancel(workflowId) {
      return asObject(
        await request(
          fetchImpl,
          `${baseUrl}/api/v1/runs/${encodeURIComponent(workflowId)}/cancel`,
          {},
          202,
        ),
      );
    },
  };
}

async function request(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  body?: unknown,
  expectedStatus = 200,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    headers: { "content-type": "application/json" },
  });
  if (response.status !== expectedStatus) {
    throw new Error(`automation-service request failed (${response.status})`);
  }
  return response.json();
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("automation-service returned an invalid response");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}`);
  return value;
}

function requiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`Invalid ${name}`);
  return value;
}
