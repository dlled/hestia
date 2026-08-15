import { createInMemoryEntityEventBus } from "@hestia/event-bus";
import type { HomeAssistantClient } from "@hestia/ha-client";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createIntegrationHubApp } from "../app.js";
import { createHomeAssistantIngestor } from "../ingestor.js";

describe("integration hub", () => {
  it("syncs Home Assistant states into the event lane", async () => {
    const bus = createInMemoryEntityEventBus();
    const received = vi.fn(async () => undefined);
    await bus.subscribe("test", received);
    const ingestor = createHomeAssistantIngestor({
      client: fakeClient(),
      publisher: bus,
      homeId: "home_primary",
      instanceId: "ha_main",
    });

    const response = await request(createIntegrationHubApp({ ingestor })).post(
      "/api/v1/integrations/home-assistant/sync",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      discovered: 1,
      published: 1,
      areas: 1,
      devices: 1,
      topology: "available",
    });
    expect(received).toHaveBeenCalledTimes(2);
    const status = await request(createIntegrationHubApp({ ingestor })).get(
      "/api/v1/integrations/home-assistant/status",
    );
    expect(status.body).toMatchObject({
      status: "degraded",
      rest: true,
      topology: true,
      discoveredEntities: 1,
      discoveredAreas: 1,
    });
  });

  it("reports missing Home Assistant configuration", async () => {
    const response = await request(createIntegrationHubApp()).post(
      "/api/v1/integrations/home-assistant/sync",
    );
    expect(response.status).toBe(503);
  });

  it("records a failed discovery checkpoint", async () => {
    const client = fakeClient();
    client.getStates = async () => {
      throw new Error("Home Assistant unavailable");
    };
    const ingestor = createHomeAssistantIngestor({
      client,
      publisher: createInMemoryEntityEventBus(),
      homeId: "home_primary",
      instanceId: "ha_main",
    });

    await expect(ingestor.sync()).rejects.toThrow("Home Assistant unavailable");
    await expect(ingestor.checkpoint()).resolves.toMatchObject({
      status: "down",
      failureMessage: "Home Assistant unavailable",
    });
  });
});

function fakeClient(): HomeAssistantClient {
  return {
    async connect() {
      return { baseUrl: "http://ha.test", connected: true };
    },
    async getStates() {
      return [
        {
          entity_id: "light.bedroom",
          state: "on",
          attributes: { friendly_name: "Bedroom lamp" },
          last_changed: "2026-08-14T20:00:00.000Z",
          last_updated: "2026-08-14T20:00:00.000Z",
          context: { id: "context-1", parent_id: null, user_id: null },
        },
      ];
    },
    async callService() {
      return [];
    },
    async getRegistries() {
      return {
        areas: [{ area_id: "bedroom", name: "Bedroom" }],
        devices: [
          {
            id: "device-1",
            name: "Bedside bulb",
            area_id: "bedroom",
            primary_config_entry: "hue",
          },
        ],
        entities: [
          {
            entity_id: "light.bedroom",
            platform: "hue",
            device_id: "device-1",
            area_id: null,
          },
        ],
      };
    },
    async subscribeStateChanges() {
      return { async close() {} };
    },
    async disconnect() {},
  };
}
