import { type IntegrationCheckpoint, IntegrationCheckpointSchema } from "@hestia/contracts";
import { createNatsEntityEventBus, type EntityEventBus } from "@hestia/event-bus";
import {
  createHomeAssistantClient,
  type HomeAssistantRegistrySnapshot,
  type HomeAssistantStateSubscription,
} from "@hestia/ha-client";
import { api } from "encore.dev/api";
import { homecore } from "~encore/clients";
import type { HomeAssistantSyncView, IntegrationCheckpointView } from "../shared/contracts";
import { getCheckpoint, saveCheckpoint } from "./checkpoints";
import { entityStateEvent, stateChangedEvent, topologyDiscoveredEvent } from "./mapper";
import { HomeAssistantAccessToken } from "./secrets";

interface IntegrationRuntime {
  client: ReturnType<typeof createHomeAssistantClient>;
  bus: EntityEventBus;
  subscription?: HomeAssistantStateSubscription;
  registry?: HomeAssistantRegistrySnapshot;
}

let runtimePromise: Promise<IntegrationRuntime> | undefined;
let busPromise: Promise<EntityEventBus> | undefined;

function settings() {
  return {
    baseUrl: process.env.HA_BASE_URL ?? "http://127.0.0.1:8123",
    homeId: process.env.HOME_ID ?? "home_primary",
    instanceId: process.env.HA_INSTANCE_ID ?? "ha_main",
    natsUrl: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
  };
}

async function runtime(): Promise<IntegrationRuntime> {
  const config = settings();
  runtimePromise ??= eventBus().then((bus) => ({
    bus,
    client: createHomeAssistantClient({
      baseUrl: config.baseUrl,
      accessToken: HomeAssistantAccessToken(),
    }),
  }));
  return runtimePromise;
}

export const syncHomeAssistant = api(
  { method: "POST", path: "/internal/integrations/home-assistant/sync" },
  async (): Promise<HomeAssistantSyncView> => {
    const config = settings();
    const integration = await runtime();
    const previous = await currentCheckpoint();
    const syncStartedAt = new Date().toISOString();
    await persist({
      ...previous,
      status: "degraded",
      lastSyncStartedAt: syncStartedAt,
      failureMessage: undefined,
    });
    try {
      const states = await integration.client.getStates();
      let topology: "available" | "degraded" = "available";
      try {
        integration.registry = await integration.client.getRegistries();
        await publishAndApply(topologyDiscoveredEvent(integration.registry, config));
      } catch {
        integration.registry = undefined;
        topology = "degraded";
      }
      for (const state of states) {
        await publishAndApply(
          entityStateEvent(state, {
            homeId: config.homeId,
            instanceId: config.instanceId,
            ...(integration.registry ? { registry: integration.registry } : {}),
          }),
        );
      }
      const syncedAt = new Date().toISOString();
      await persist({
        ...previous,
        status: integration.subscription && topology === "available" ? "ok" : "degraded",
        rest: true,
        streaming: integration.subscription !== undefined,
        topology: topology === "available",
        lastSyncStartedAt: syncStartedAt,
        lastSyncCompletedAt: syncedAt,
        lastSuccessfulSyncAt: syncedAt,
        failureMessage:
          topology === "degraded" ? "Home Assistant registry discovery unavailable" : undefined,
        discoveredEntities: states.length,
        discoveredAreas: integration.registry?.areas.length ?? 0,
        discoveredDevices: integration.registry?.devices.length ?? 0,
      });
      return {
        homeId: config.homeId,
        source: "home_assistant",
        discovered: states.length,
        published: states.length,
        areas: integration.registry?.areas.length ?? 0,
        devices: integration.registry?.devices.length ?? 0,
        topology,
        syncedAt,
      };
    } catch (error) {
      await persist({
        ...previous,
        status: "down",
        rest: false,
        lastSyncStartedAt: syncStartedAt,
        lastFailureAt: new Date().toISOString(),
        failureMessage: error instanceof Error ? error.message : "Home Assistant sync failed",
      });
      throw error;
    }
  },
);

export const startHomeAssistantStream = api(
  { method: "POST", path: "/internal/integrations/home-assistant/stream/start" },
  async (): Promise<{ streaming: true }> => {
    const config = settings();
    const integration = await runtime();
    if (!integration.subscription) {
      await integration.client.connect();
      integration.subscription = await integration.client.subscribeStateChanges(async (event) => {
        const mapped = stateChangedEvent(event, {
          homeId: config.homeId,
          instanceId: config.instanceId,
          ...(integration.registry ? { registry: integration.registry } : {}),
        });
        if (mapped) await publishAndApply(mapped);
      });
    }
    const checkpoint = await currentCheckpoint();
    await persist({ ...checkpoint, status: checkpoint.rest ? "ok" : "degraded", streaming: true });
    return { streaming: true };
  },
);

export const stopHomeAssistantStream = api(
  { method: "POST", path: "/internal/integrations/home-assistant/stream/stop" },
  async (): Promise<{ streaming: false }> => {
    const integration = await runtime();
    await integration.subscription?.close();
    integration.subscription = undefined;
    const checkpoint = await currentCheckpoint();
    await persist({
      ...checkpoint,
      status: checkpoint.rest ? "degraded" : "down",
      streaming: false,
    });
    return { streaming: false };
  },
);

export const homeAssistantStatus = api(
  { method: "GET", path: "/internal/integrations/home-assistant/status" },
  async (): Promise<IntegrationCheckpointView> => currentCheckpoint(),
);

export async function publishAndApply(
  event: Parameters<EntityEventBus["publish"]>[0],
): Promise<void> {
  await (await eventBus()).publish(event);
  await homecore.applyEvent({ eventJson: JSON.stringify(event) });
}

async function eventBus(): Promise<EntityEventBus> {
  busPromise ??= createNatsEntityEventBus(settings().natsUrl);
  return busPromise;
}

async function currentCheckpoint(): Promise<IntegrationCheckpointView> {
  const config = settings();
  return (
    (await getCheckpoint(config.instanceId)) ?? {
      homeId: config.homeId,
      system: "home_assistant",
      instanceId: config.instanceId,
      status: "down",
      rest: false,
      streaming: false,
      topology: false,
      discoveredEntities: 0,
      discoveredAreas: 0,
      discoveredDevices: 0,
    }
  );
}

async function persist(input: IntegrationCheckpointView): Promise<void> {
  await saveCheckpoint(IntegrationCheckpointSchema.parse(input) as IntegrationCheckpoint);
}
