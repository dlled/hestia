import request from "supertest";
import { describe, expect, it } from "vitest";
import { createEdgeApp } from "../app.js";
import type { HomeGateway } from "../home.js";

describe("connected home gateway", () => {
  it("exposes only the canonical twin, not the Home Assistant API", async () => {
    const response = await request(createEdgeApp({ home: fakeHome() })).get(
      "/api/v1/home/entities",
    );

    expect(response.status).toBe(200);
    expect(response.body.entities[0]).toMatchObject({
      id: "ent_0123456789abcdef",
      externalRef: { system: "home_assistant", entityId: "light.bedroom" },
    });
  });

  it("accepts an operator-triggered discovery sync", async () => {
    const response = await request(createEdgeApp({ home: fakeHome() })).post("/api/v1/home/sync");
    expect(response.status).toBe(200);
    expect(response.body.published).toBe(1);
  });

  it("exposes discovered areas through the canonical topology endpoint", async () => {
    const response = await request(createEdgeApp({ home: fakeHome() })).get(
      "/api/v1/home/topology",
    );
    expect(response.status).toBe(200);
    expect(response.body.areas).toMatchObject([{ name: "Bedroom" }]);
  });

  it("exposes the persisted integration checkpoint", async () => {
    const response = await request(createEdgeApp({ home: fakeHome() })).get(
      "/api/v1/home/integration-status",
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", streaming: true, topology: true });
  });

  it("exposes the read-only sleep context", async () => {
    const response = await request(createEdgeApp({ home: fakeHome() })).get(
      "/api/v1/home/contexts/sleep",
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ readiness: "ready", summary: { relevant: 1 } });
  });
});

function fakeHome(): HomeGateway {
  return {
    async listEntities() {
      return {
        homeId: "home_primary",
        entities: [
          {
            id: "ent_0123456789abcdef",
            homeId: "home_primary",
            name: "Bedroom lamp",
            domain: "light",
            capabilities: ["power.onOff"],
            externalRef: {
              system: "home_assistant",
              instanceId: "ha_main",
              entityId: "light.bedroom",
            },
            observedState: {
              value: "on",
              timestamp: "2026-08-14T20:00:00.000Z",
              source: "home_assistant:ha_main",
              quality: "good",
            },
          },
        ],
      };
    },
    async getTopology() {
      return {
        homeId: "home_primary",
        areas: [
          {
            id: "area_0123456789abcdef",
            homeId: "home_primary",
            name: "Bedroom",
            kind: "room",
            externalRef: {
              system: "home_assistant",
              instanceId: "ha_main",
              areaId: "bedroom",
            },
          },
        ],
        devices: [],
      };
    },
    async getIntegrationStatus() {
      return {
        homeId: "home_primary",
        system: "home_assistant",
        instanceId: "ha_main",
        status: "ok",
        rest: true,
        streaming: true,
        topology: true,
        discoveredEntities: 1,
        discoveredAreas: 1,
        discoveredDevices: 0,
      };
    },
    async getSleepContext() {
      return {
        homeId: "home_primary",
        generatedAt: "2026-08-14T20:00:00.000Z",
        readiness: "ready",
        summary: { relevant: 1, stale: 0, unavailable: 0 },
        categories: {
          lights: [
            {
              entityId: "ent_0123456789abcdef",
              name: "Bedroom lamp",
              domain: "light",
              observedState: {
                value: "on",
                timestamp: "2026-08-14T20:00:00.000Z",
                source: "home_assistant:ha_main",
                quality: "good",
              },
              attention: "ready",
            },
          ],
          climate: [],
          covers: [],
          media: [],
          alarm: [],
        },
      };
    },
    async syncHomeAssistant() {
      return {
        homeId: "home_primary",
        source: "home_assistant",
        discovered: 1,
        published: 1,
        syncedAt: "2026-08-14T20:00:00.000Z",
      };
    },
  };
}
