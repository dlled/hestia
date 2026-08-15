import type { EntityStateChangedEvent } from "@hestia/contracts";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryEntityEventBus } from "../index.js";

describe("in-memory entity event bus", () => {
  it("validates and delivers an entity observation", async () => {
    const bus = createInMemoryEntityEventBus();
    const handler = vi.fn(async () => undefined);
    await bus.subscribe("test", handler);
    const event = fixture();

    await bus.publish(event);

    expect(handler).toHaveBeenCalledWith(event);
  });

  it("delivers topology discovery through the same ingestion lane", async () => {
    const bus = createInMemoryEntityEventBus();
    const handler = vi.fn(async () => undefined);
    await bus.subscribe("test", handler);

    await bus.publish({
      eventId: "evt_topology0123456789",
      eventType: "home.topology.discovered",
      schemaVersion: 1,
      occurredAt: "2026-08-14T20:00:00.000Z",
      homeId: "home_primary",
      correlationId: "corr_0123456789abcdef",
      source: { type: "home_assistant", instanceId: "ha_main" },
      subject: { homeId: "home_primary" },
      data: { homeId: "home_primary", areas: [], devices: [] },
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "home.topology.discovered" }),
    );
  });
});

function fixture(): EntityStateChangedEvent {
  return {
    eventId: "evt_0123456789abcdef",
    eventType: "home.entity.state.changed",
    schemaVersion: 1,
    occurredAt: "2026-08-14T20:00:00.000Z",
    homeId: "home_primary",
    correlationId: "corr_0123456789abcdef",
    source: { type: "home_assistant", instanceId: "ha_main" },
    subject: { entityId: "ent_0123456789abcdef" },
    data: {
      entity: {
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
    },
  };
}
