import {
  type SleepPlanPreview,
  SleepPlanPreviewRequestSchema,
  SleepPlanPreviewSchema,
} from "@hestia/contracts";

export interface AgentAutomationGateway {
  previewSleepPlan(input: unknown): Promise<SleepPlanPreview>;
}

export function createHttpAgentAutomationGateway(options: {
  automationServiceUrl: string;
  fetch?: typeof globalThis.fetch;
}): AgentAutomationGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async previewSleepPlan(input) {
      const body = SleepPlanPreviewRequestSchema.parse(input);
      const response = await fetchImpl(
        `${options.automationServiceUrl.replace(/\/$/u, "")}/api/v1/plans/sleep/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new Error(`automation sleep preview failed (${response.status})`);
      return SleepPlanPreviewSchema.parse(await response.json());
    },
  };
}
