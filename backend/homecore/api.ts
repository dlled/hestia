import { api } from "encore.dev/api";
import type { EntityView, SleepContextView, TopologyView } from "../shared/contracts";
import { applyHomeEvent, listEntityViews, topologyView } from "./repository";
import { createSleepContext } from "./sleep-context";

export const applyEvent = api(
  { method: "POST", path: "/internal/home/events" },
  async ({ eventJson }: { eventJson: string }): Promise<{ applied: "entity" | "topology" }> => ({
    applied: await applyHomeEvent(eventJson),
  }),
);

export const listEntities = api(
  { method: "GET", path: "/internal/homes/:homeId/entities" },
  async ({ homeId }: { homeId: string }): Promise<{ homeId: string; entities: EntityView[] }> => ({
    homeId,
    entities: await listEntityViews(homeId),
  }),
);

export const topology = api(
  { method: "GET", path: "/internal/homes/:homeId/topology" },
  async ({ homeId }: { homeId: string }): Promise<TopologyView> => topologyView(homeId),
);

export const sleepContext = api(
  { method: "GET", path: "/internal/homes/:homeId/sleep-context" },
  async ({ homeId }: { homeId: string }): Promise<SleepContextView> =>
    createSleepContext(homeId, await listEntityViews(homeId)),
);
