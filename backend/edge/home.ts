import { api } from "encore.dev/api";
import { homecore, integrationhub } from "~encore/clients";
import type {
  EntityView,
  HomeAssistantSyncView,
  IntegrationCheckpointView,
  SleepContextView,
  TopologyView,
} from "../shared/contracts";

export const listHomeEntities = api(
  { expose: true, method: "GET", path: "/api/v1/homes/:homeId/entities" },
  async ({ homeId }: { homeId: string }): Promise<{ homeId: string; entities: EntityView[] }> =>
    homecore.listEntities({ homeId }),
);

export const getHomeTopology = api(
  { expose: true, method: "GET", path: "/api/v1/homes/:homeId/topology" },
  async ({ homeId }: { homeId: string }): Promise<TopologyView> => homecore.topology({ homeId }),
);

export const getSleepContext = api(
  { expose: true, method: "GET", path: "/api/v1/homes/:homeId/sleep-context" },
  async ({ homeId }: { homeId: string }): Promise<SleepContextView> =>
    homecore.sleepContext({ homeId }),
);

export const syncHomeAssistant = api(
  { expose: true, method: "POST", path: "/api/v1/integrations/home-assistant/sync" },
  async (): Promise<HomeAssistantSyncView> => integrationhub.syncHomeAssistant(),
);

export const startHomeAssistantStream = api(
  { expose: true, method: "POST", path: "/api/v1/integrations/home-assistant/stream/start" },
  async (): Promise<{ streaming: true }> => integrationhub.startHomeAssistantStream(),
);

export const stopHomeAssistantStream = api(
  { expose: true, method: "POST", path: "/api/v1/integrations/home-assistant/stream/stop" },
  async (): Promise<{ streaming: false }> => integrationhub.stopHomeAssistantStream(),
);

export const homeAssistantStatus = api(
  { expose: true, method: "GET", path: "/api/v1/integrations/home-assistant/status" },
  async (): Promise<IntegrationCheckpointView> => integrationhub.homeAssistantStatus(),
);
