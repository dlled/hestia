import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyEvent, listEntities, topology } from "./api";

describe("home core Encore persistence", () => {
  it("materializes state and rejects a stale replay", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const homeId = `home_${suffix}`;
    const entityId = `ent_${suffix}`;

    await applyEvent({
      eventJson: JSON.stringify(stateEvent(homeId, entityId, "on", "2026-08-14T20:00:10.000Z")),
    });
    await applyEvent({
      eventJson: JSON.stringify(stateEvent(homeId, entityId, "off", "2026-08-14T20:00:00.000Z")),
    });

    await expect(listEntities({ homeId })).resolves.toMatchObject({
      entities: [
        { id: entityId, observedState: { value: "on", timestamp: "2026-08-14T20:00:10.000Z" } },
      ],
    });
  });

  it("replaces and exposes a topology snapshot", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const homeId = `home_${suffix}`;
    const areaId = `area_${suffix}`;
    const deviceId = `dev_${suffix}`;
    const event = {
      eventId: `evt_${suffix}`,
      eventType: "home.topology.discovered",
      schemaVersion: 1,
      occurredAt: "2026-08-14T20:00:00.000Z",
      homeId,
      correlationId: `corr_${suffix}`,
      source: { type: "home_assistant", instanceId: "ha_main" },
      subject: { homeId },
      data: {
        homeId,
        areas: [
          {
            id: areaId,
            homeId,
            name: "Bedroom",
            kind: "room",
            externalRef: { system: "home_assistant", instanceId: "ha_main", areaId: "bedroom" },
          },
        ],
        devices: [
          {
            id: deviceId,
            homeId,
            areaId,
            name: "Bedside bulb",
            integration: "hue",
            externalRef: { system: "home_assistant", instanceId: "ha_main", deviceId: "device-1" },
          },
        ],
      },
    };

    await applyEvent({ eventJson: JSON.stringify(event) });

    await expect(topology({ homeId })).resolves.toMatchObject({
      areas: [{ id: areaId, name: "Bedroom" }],
      devices: [{ id: deviceId, areaId, name: "Bedside bulb" }],
    });
  });
});

function stateEvent(homeId: string, entityId: string, value: string, timestamp: string) {
  return {
    eventId: `evt_${randomUUID().replaceAll("-", "")}`,
    eventType: "home.entity.state.changed",
    schemaVersion: 1,
    occurredAt: timestamp,
    homeId,
    correlationId: `corr_${randomUUID().replaceAll("-", "")}`,
    source: { type: "home_assistant", instanceId: "ha_main" },
    subject: { entityId },
    data: {
      entity: {
        id: entityId,
        homeId,
        name: "Bedroom lamp",
        domain: "light",
        capabilities: ["level.set", "power.onOff"],
        externalRef: { system: "home_assistant", instanceId: "ha_main", entityId: "light.bedroom" },
        observedState: { value, timestamp, source: "home_assistant:ha_main", quality: "good" },
      },
    },
  };
}
