import {
  type EntityListResponse,
  EntityListResponseSchema,
  type HomeAssistantSyncResult,
  HomeAssistantSyncResultSchema,
  type HomeTopology,
  HomeTopologySchema,
  type IntegrationCheckpoint,
  IntegrationCheckpointSchema,
  type SleepContext,
  SleepContextSchema,
} from "@hestia/contracts";

export interface HomeGateway {
  listEntities(): Promise<EntityListResponse>;
  getTopology(): Promise<HomeTopology>;
  getIntegrationStatus(): Promise<IntegrationCheckpoint>;
  getSleepContext(): Promise<SleepContext>;
  syncHomeAssistant(): Promise<HomeAssistantSyncResult>;
}

export function createHttpHomeGateway(options: {
  homeCoreUrl: string;
  integrationHubUrl: string;
  homeId: string;
  fetch?: typeof globalThis.fetch;
}): HomeGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    async listEntities() {
      return request(
        fetchImpl,
        `${trim(options.homeCoreUrl)}/api/v1/homes/${encodeURIComponent(options.homeId)}/entities`,
        undefined,
        EntityListResponseSchema,
      );
    },
    async getTopology() {
      return request(
        fetchImpl,
        `${trim(options.homeCoreUrl)}/api/v1/homes/${encodeURIComponent(options.homeId)}/topology`,
        undefined,
        HomeTopologySchema,
      );
    },
    async getIntegrationStatus() {
      return request(
        fetchImpl,
        `${trim(options.integrationHubUrl)}/api/v1/integrations/home-assistant/status`,
        undefined,
        IntegrationCheckpointSchema,
      );
    },
    async getSleepContext() {
      return request(
        fetchImpl,
        `${trim(options.homeCoreUrl)}/api/v1/homes/${encodeURIComponent(options.homeId)}/contexts/sleep`,
        undefined,
        SleepContextSchema,
      );
    },
    async syncHomeAssistant() {
      return request(
        fetchImpl,
        `${trim(options.integrationHubUrl)}/api/v1/integrations/home-assistant/sync`,
        { method: "POST" },
        HomeAssistantSyncResultSchema,
      );
    },
  };
}

async function request<T>(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  init: RequestInit | undefined,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new Error(`upstream request failed (${response.status})`);
  return schema.parse(await response.json());
}

function trim(value: string): string {
  return value.replace(/\/$/u, "");
}
