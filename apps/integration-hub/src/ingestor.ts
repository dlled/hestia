import {
  type HomeAssistantSyncResult,
  type IntegrationCheckpoint,
  IntegrationCheckpointSchema,
} from "@hestia/contracts";
import type { EntityEventPublisher } from "@hestia/event-bus";
import type {
  HomeAssistantClient,
  HomeAssistantRegistrySnapshot,
  HomeAssistantStateSubscription,
} from "@hestia/ha-client";
import type { IntegrationCheckpointRepository } from "./checkpoints.js";
import { entityStateEvent, stateChangedEvent, topologyDiscoveredEvent } from "./mapper.js";

export interface HomeAssistantIngestor {
  sync(): Promise<HomeAssistantSyncResult>;
  startStreaming(): Promise<void>;
  close(): Promise<void>;
  status(): { rest: boolean; streaming: boolean; topology: boolean };
  checkpoint(): Promise<IntegrationCheckpoint>;
}

export function createHomeAssistantIngestor(options: {
  client: HomeAssistantClient;
  publisher: EntityEventPublisher;
  homeId: string;
  instanceId: string;
  checkpoints?: IntegrationCheckpointRepository;
}): HomeAssistantIngestor {
  let connected = false;
  let streaming = false;
  let subscription: HomeAssistantStateSubscription | undefined;
  let registry: HomeAssistantRegistrySnapshot | undefined;
  let lastSyncStartedAt: string | undefined;
  let lastSyncCompletedAt: string | undefined;
  let lastSuccessfulSyncAt: string | undefined;
  let lastFailureAt: string | undefined;
  let failureMessage: string | undefined;
  let discoveredEntities = 0;
  let discoveredAreas = 0;
  let discoveredDevices = 0;

  const currentCheckpoint = (): IntegrationCheckpoint =>
    IntegrationCheckpointSchema.parse({
      homeId: options.homeId,
      system: "home_assistant",
      instanceId: options.instanceId,
      status: connected && streaming && registry ? "ok" : connected ? "degraded" : "down",
      rest: connected,
      streaming,
      topology: registry !== undefined,
      ...(lastSyncStartedAt ? { lastSyncStartedAt } : {}),
      ...(lastSyncCompletedAt ? { lastSyncCompletedAt } : {}),
      ...(lastSuccessfulSyncAt ? { lastSuccessfulSyncAt } : {}),
      ...(lastFailureAt ? { lastFailureAt } : {}),
      ...(failureMessage ? { failureMessage } : {}),
      discoveredEntities,
      discoveredAreas,
      discoveredDevices,
    });
  const persist = async () => options.checkpoints?.save(currentCheckpoint());
  return {
    async sync() {
      lastSyncStartedAt = new Date().toISOString();
      failureMessage = undefined;
      await persist();
      try {
        const states = await options.client.getStates();
        try {
          registry = await options.client.getRegistries();
          await options.publisher.publish(
            topologyDiscoveredEvent(registry, {
              homeId: options.homeId,
              instanceId: options.instanceId,
            }),
          );
        } catch {
          registry = undefined;
          failureMessage = "Home Assistant registry discovery unavailable";
        }
        for (const state of states) {
          await options.publisher.publish(
            entityStateEvent(state, {
              homeId: options.homeId,
              instanceId: options.instanceId,
              ...(registry ? { registry } : {}),
            }),
          );
        }
        connected = true;
        discoveredEntities = states.length;
        discoveredAreas = registry?.areas.length ?? 0;
        discoveredDevices = registry?.devices.length ?? 0;
        lastSyncCompletedAt = new Date().toISOString();
        lastSuccessfulSyncAt = lastSyncCompletedAt;
        await persist();
        return {
          homeId: options.homeId,
          source: "home_assistant",
          discovered: states.length,
          published: states.length,
          areas: discoveredAreas,
          devices: discoveredDevices,
          topology: registry ? "available" : "degraded",
          syncedAt: lastSyncCompletedAt,
        };
      } catch (error) {
        connected = false;
        lastFailureAt = new Date().toISOString();
        failureMessage = error instanceof Error ? error.message : "Home Assistant sync failed";
        await persist();
        throw error;
      }
    },
    async startStreaming() {
      await options.client.connect();
      subscription = await options.client.subscribeStateChanges(async (event) => {
        const mapped = stateChangedEvent(event, {
          homeId: options.homeId,
          instanceId: options.instanceId,
          ...(registry ? { registry } : {}),
        });
        if (mapped) await options.publisher.publish(mapped);
      });
      connected = true;
      streaming = true;
      await persist();
    },
    async close() {
      await subscription?.close();
      await options.client.disconnect();
      connected = false;
      streaming = false;
      await persist();
    },
    status() {
      return { rest: connected, streaming, topology: registry !== undefined };
    },
    async checkpoint() {
      return (await options.checkpoints?.get(options.instanceId)) ?? currentCheckpoint();
    },
  };
}
