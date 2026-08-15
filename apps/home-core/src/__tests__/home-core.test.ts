import type {
  EntityStateChangedEvent,
  HomeTopologyDiscoveredEvent,
  TwinEntity,
} from "@hestia/contracts";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createHomeCoreApp } from "../app.js";
import { createEntityStateMaterializer, createHomeEventMaterializer } from "../materializer.js";
import { createMemoryTwinRepository } from "../repository.js";
import { createSleepContext } from "../sleep-context.js";

describe("home-core digital twin", () => {
  it("materializes observations and exposes them through its HTTP read model", async () => {
    const repository = createMemoryTwinRepository();
    await createEntityStateMaterializer(repository)(
      event(entity("on", "2026-08-14T20:00:00.000Z")),
    );

    const response = await request(createHomeCoreApp({ repository })).get(
      "/api/v1/homes/home_primary/entities",
    );

    expect(response.status).toBe(200);
    expect(response.body.entities).toMatchObject([
      { name: "Bedroom lamp", observedState: { value: "on" } },
    ]);
  });

  it("does not let a replayed stale observation overwrite newer state", async () => {
    const repository = createMemoryTwinRepository();
    const materialize = createEntityStateMaterializer(repository);
    await materialize(event(entity("on", "2026-08-14T20:00:10.000Z")));
    await materialize(event(entity("off", "2026-08-14T20:00:00.000Z")));

    await expect(repository.list("home_primary")).resolves.toMatchObject([
      { observedState: { value: "on", timestamp: "2026-08-14T20:00:10.000Z" } },
    ]);
  });

  it("materializes topology snapshots and exposes them through HTTP", async () => {
    const repository = createMemoryTwinRepository();
    await createHomeEventMaterializer(repository)(topologyEvent());

    const response = await request(createHomeCoreApp({ repository })).get(
      "/api/v1/homes/home_primary/topology",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      areas: [{ name: "Bedroom" }],
      devices: [{ name: "Bedside bulb", areaId: "area_0123456789abcdef" }],
    });
  });

  it("marks observations stale at read time without overwriting the stored value", async () => {
    const repository = createMemoryTwinRepository();
    await repository.upsert({
      ...entity("on", "2026-08-14T20:00:00.000Z"),
      observedState: {
        ...entity("on", "2026-08-14T20:00:00.000Z").observedState,
        staleAfterSec: 300,
      },
    });

    await expect(
      repository.list("home_primary", new Date("2026-08-14T20:05:01.000Z")),
    ).resolves.toMatchObject([{ observedState: { value: "on", quality: "stale" } }]);
    await expect(
      repository.list("home_primary", new Date("2026-08-14T20:04:00.000Z")),
    ).resolves.toMatchObject([{ observedState: { value: "on", quality: "good" } }]);
  });

  it("builds a read-only sleep context and flags unsafe observations", () => {
    const context = createSleepContext(
      "home_primary",
      [
        entity("on", "2026-08-14T20:00:00.000Z"),
        {
          ...entity("unavailable", "2026-08-14T20:00:00.000Z"),
          id: "ent_climate0123456789",
          name: "Bedroom climate",
          domain: "climate",
          observedState: {
            ...entity("unavailable", "2026-08-14T20:00:00.000Z").observedState,
            quality: "unavailable",
          },
        },
      ],
      new Date("2026-08-14T20:00:01.000Z"),
    );

    expect(context).toMatchObject({
      readiness: "degraded",
      summary: { relevant: 2, unavailable: 1 },
      categories: { lights: [{ name: "Bedroom lamp" }], climate: [{ attention: "unavailable" }] },
    });
  });
});

function entity(value: string, timestamp: string): TwinEntity {
  return {
    id: "ent_0123456789abcdef",
    homeId: "home_primary",
    name: "Bedroom lamp",
    domain: "light",
    capabilities: ["level.set", "power.onOff"],
    externalRef: { system: "home_assistant", instanceId: "ha_main", entityId: "light.bedroom" },
    observedState: {
      value,
      timestamp,
      source: "home_assistant:ha_main",
      quality: "good",
    },
  };
}

function topologyEvent(): HomeTopologyDiscoveredEvent {
  return {
    eventId: "evt_topology0123456789",
    eventType: "home.topology.discovered",
    schemaVersion: 1,
    occurredAt: "2026-08-14T20:00:00.000Z",
    homeId: "home_primary",
    correlationId: "corr_0123456789abcdef",
    source: { type: "home_assistant", instanceId: "ha_main" },
    subject: { homeId: "home_primary" },
    data: {
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
      devices: [
        {
          id: "dev_0123456789abcdef",
          homeId: "home_primary",
          areaId: "area_0123456789abcdef",
          name: "Bedside bulb",
          integration: "hue",
          externalRef: {
            system: "home_assistant",
            instanceId: "ha_main",
            deviceId: "device-1",
          },
        },
      ],
    },
  };
}

function event(value: TwinEntity): EntityStateChangedEvent {
  return {
    eventId: "evt_0123456789abcdef",
    eventType: "home.entity.state.changed",
    schemaVersion: 1,
    occurredAt: value.observedState.timestamp,
    homeId: value.homeId,
    correlationId: "corr_0123456789abcdef",
    source: { type: "home_assistant", instanceId: "ha_main" },
    subject: { entityId: value.id },
    data: { entity: value },
  };
}
