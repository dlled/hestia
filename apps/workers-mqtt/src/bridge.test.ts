import { describe, expect, it } from "vitest";
import { parseMqttEntityState, signedWebhookHeaders } from "./bridge.js";

const event = {
  eventId: "evt_mqtt_1",
  eventType: "home.entity.state.changed",
  schemaVersion: 1,
  occurredAt: "2026-08-15T12:00:00.000Z",
  homeId: "home_primary",
  correlationId: "corr_mqtt_1",
  source: { type: "mqtt", instanceId: "mosquitto_main" },
  subject: { entityId: "ent_living_temperature" },
  data: {
    entity: {
      id: "ent_living_temperature",
      homeId: "home_primary",
      name: "Living room temperature",
      domain: "sensor",
      capabilities: ["sensor.read"],
      externalRef: { system: "mqtt", instanceId: "mosquitto_main", entityId: "living/temperature" },
      observedState: {
        value: 21.4,
        unit: "°C",
        timestamp: "2026-08-15T12:00:00.000Z",
        source: "mqtt:mosquitto_main",
        quality: "good",
        staleAfterSec: 300,
      },
    },
  },
};

describe("MQTT integration bridge", () => {
  it("accepts only a topic matching the canonical event", () => {
    const payload = Buffer.from(JSON.stringify(event));
    expect(
      parseMqttEntityState("hestia/home_primary/entity/ent_living_temperature/state", payload)
        .eventId,
    ).toBe("evt_mqtt_1");
    expect(() =>
      parseMqttEntityState("hestia/another/entity/ent_living_temperature/state", payload),
    ).toThrow();
  });

  it("creates deterministic signed webhook headers", () => {
    const headers = signedWebhookHeaders(
      Buffer.from("body"),
      "x".repeat(32),
      new Date("2026-08-15T12:00:00Z"),
    );
    expect(headers["x-hestia-timestamp"]).toBe("1786795200");
    expect(headers["x-hestia-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
  });
});
