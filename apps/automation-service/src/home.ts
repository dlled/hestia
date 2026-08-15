import { type SleepContext, SleepContextSchema } from "@hestia/contracts";

export interface AutomationHomeGateway {
  getSleepContext(): Promise<SleepContext>;
}

export function createHttpAutomationHomeGateway(options: {
  homeCoreUrl: string;
  homeId: string;
  fetch?: typeof globalThis.fetch;
}): AutomationHomeGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async getSleepContext() {
      const response = await fetchImpl(
        `${options.homeCoreUrl.replace(/\/$/u, "")}/api/v1/homes/${encodeURIComponent(options.homeId)}/contexts/sleep`,
      );
      if (!response.ok) throw new Error(`home-core sleep context failed (${response.status})`);
      return SleepContextSchema.parse(await response.json());
    },
  };
}
