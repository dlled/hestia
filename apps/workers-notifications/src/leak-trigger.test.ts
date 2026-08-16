import type { HomeIngestionEvent, LeakPlaybook } from "@hestia/contracts";
import { describe, expect, it, vi } from "vitest";
import { leakEvidenceFromEvent, leakWorkflowId, loadActiveLeakPlaybook } from "./leak-trigger.js";

describe("leak incident trigger", () => {
  it("accepts only active moisture observations", () => {
    const event = leakEvent();
    expect(leakEvidenceFromEvent(event)).toMatchObject({
      homeId: "home_primary",
      sensor: { deviceClass: "moisture", observedValue: "on" },
    });
    const dry = leakEvent();
    if (dry.eventType !== "home.entity.state.changed") throw new Error("invalid fixture");
    dry.data.entity.observedState.value = "off";
    expect(leakEvidenceFromEvent(dry)).toBeUndefined();
  });

  it("loads the immutable active playbook with a scoped worker credential", async () => {
    const playbook = observeOnlyPlaybook();
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ playbookJson: JSON.stringify(playbook) }), { status: 200 }),
    );
    await expect(
      loadActiveLeakPlaybook(
        leakEvent(),
        { HESTIA_WORKER_API_URL: "http://hestia.test", WORKER_SERVICE_TOKEN: "worker-token" },
        request,
      ),
    ).resolves.toEqual(playbook);
    expect(request).toHaveBeenCalledWith(
      "http://hestia.test/workers/v1/homes/home_primary/incident-playbooks/leak/active",
      { headers: { authorization: "Bearer worker-token" } },
    );
  });

  it("uses one stable workflow id per home and moisture sensor", () => {
    expect(leakWorkflowId("home_primary", "ent_leak_sensor_001")).toBe(
      leakWorkflowId("home_primary", "ent_leak_sensor_001"),
    );
    expect(leakWorkflowId("home_primary", "ent_other_sensor_002")).not.toBe(
      leakWorkflowId("home_primary", "ent_leak_sensor_001"),
    );
  });
});

function leakEvent(): HomeIngestionEvent {
  return {
    eventId: "evt_leak_trigger_001",
    eventType: "home.entity.state.changed",
    schemaVersion: 1,
    occurredAt: "2026-08-16T10:00:00.000Z",
    homeId: "home_primary",
    correlationId: "corr_leak_trigger_001",
    source: { type: "home_assistant", instanceId: "ha_main" },
    subject: { entityId: "ent_leak_sensor_001" },
    data: {
      entity: {
        id: "ent_leak_sensor_001",
        homeId: "home_primary",
        name: "Utility room leak sensor",
        domain: "binary_sensor",
        deviceClass: "moisture",
        capabilities: ["sensor.read"],
        externalRef: {
          system: "home_assistant",
          instanceId: "ha_main",
          entityId: "binary_sensor.utility_room_leak",
        },
        observedState: {
          value: "on",
          timestamp: "2026-08-16T10:00:00.000Z",
          source: "home_assistant:ha_main",
          quality: "good",
        },
      },
    },
  };
}

function observeOnlyPlaybook(): LeakPlaybook {
  return {
    playbookId: "playbook_leak_observe_only",
    version: 1,
    homeId: "home_primary",
    name: "Observe only",
    status: "published",
    triggerDeviceClass: "moisture",
    preauthorized: true,
    mode: "active",
    acknowledgementTimeoutMs: 5_000,
    actions: [],
    publishedAt: "2026-08-15T00:00:00.000Z",
  };
}
