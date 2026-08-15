import { describe, expect, it } from "vitest";
import {
  entityStateEvent,
  mapHomeAssistantState,
  mapHomeAssistantTopology,
  stableEntityId,
} from "./mapper";

describe("Home Assistant mapping", () => {
  it("keeps HESTIA identity stable across observation changes", () => {
    const context = { homeId: "home_primary", instanceId: "ha_main" };

    expect(mapHomeAssistantState(fixture("off"), context).id).toBe(
      mapHomeAssistantState(fixture("on"), context).id,
    );
    expect(stableEntityId("home_primary", "ha_main", "light.bedroom")).toMatch(
      /^ent_[a-f0-9]{24}$/u,
    );
  });

  it("maps capabilities and unavailable observations deterministically", () => {
    const entity = mapHomeAssistantState(fixture("unavailable"), {
      homeId: "home_primary",
      instanceId: "ha_main",
    });

    expect(entity.capabilities).toEqual(["level.set", "power.onOff"]);
    expect(entity.observedState).toMatchObject({ quality: "unavailable", staleAfterSec: 900 });
    expect(entity.externalRef.entityId).toBe("light.bedroom");
  });

  it("maps topology and inherits the device area", () => {
    const registry = {
      areas: [{ area_id: "bedroom", name: "Bedroom" }],
      devices: [
        {
          id: "device-1",
          name: "Bedside bulb",
          area_id: "bedroom",
          manufacturer: "Acme",
          model: "A1",
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
    const context = { homeId: "home_primary", instanceId: "ha_main", registry };
    const topology = mapHomeAssistantTopology(registry, context);
    const entity = mapHomeAssistantState(fixture("on"), context);

    expect(topology.areas[0]?.id).toMatch(/^area_[a-f0-9]{24}$/u);
    expect(topology.devices[0]).toMatchObject({ name: "Bedside bulb", integration: "hue" });
    expect(entity.deviceId).toBe(topology.devices[0]?.id);
    expect(entity.areaId).toBe(topology.areas[0]?.id);
  });

  it("emits a versioned state event with the stable subject", () => {
    const event = entityStateEvent(fixture("on"), {
      homeId: "home_primary",
      instanceId: "ha_main",
      correlationId: "corr_0123456789abcdef",
    });

    expect(event.schemaVersion).toBe(1);
    expect(event.subject.entityId).toBe(event.data.entity.id);
  });
});

function fixture(state: string) {
  return {
    entity_id: "light.bedroom",
    state,
    attributes: { friendly_name: "Bedroom lamp", supported_features: 1 },
    last_changed: "2026-08-14T20:00:00.000Z",
    last_updated: "2026-08-14T20:00:00.000Z",
    context: { id: "context-1", parent_id: null, user_id: null },
  };
}
