import { describe, expect, it } from "vitest";
import {
  entityStateEvent,
  mapHomeAssistantState,
  mapHomeAssistantTopology,
  stableEntityId,
} from "../mapper.js";

describe("Home Assistant mapping", () => {
  it("assigns stable HESTIA identity independently from observation changes", () => {
    const first = fixture("off");
    const second = fixture("on");
    const context = { homeId: "home_primary", instanceId: "ha_main" };

    expect(mapHomeAssistantState(first, context).id).toBe(
      mapHomeAssistantState(second, context).id,
    );
    expect(stableEntityId("home_primary", "ha_main", "light.bedroom")).toMatch(
      /^ent_[a-f0-9]{24}$/u,
    );
  });

  it("maps domain capabilities and observed quality deterministically", () => {
    const entity = mapHomeAssistantState(fixture("unavailable"), {
      homeId: "home_primary",
      instanceId: "ha_main",
    });

    expect(entity.capabilities).toEqual(["level.set", "power.onOff"]);
    expect(entity.observedState.quality).toBe("unavailable");
    expect(entity.externalRef.entityId).toBe("light.bedroom");
    expect(entity.observedState.staleAfterSec).toBe(900);
  });

  it("maps registry topology and resolves inherited device areas", () => {
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
    expect(topology.devices[0]).toMatchObject({
      name: "Bedside bulb",
      manufacturer: "Acme",
      integration: "hue",
    });
    expect(entity.deviceId).toBe(topology.devices[0]?.id);
    expect(entity.areaId).toBe(topology.areas[0]?.id);
  });

  it("emits a versioned event with the stable entity as subject", () => {
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
