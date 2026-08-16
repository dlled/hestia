import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  activeLeakPlaybook,
  appendWorkflowEvent,
  createWorkflowIncident,
  incidentAudit,
  listIncidents,
  recordWorkflowDelivery,
  transitionWorkflowIncident,
} from "./api";

describe("incident workflow persistence", () => {
  it("stores one incident, notification attempts, lifecycle, and exportable timeline", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const homeId = `home_${suffix}`;
    const workflowId = `hestia-incident-${suffix}`;
    const evidence = {
      eventId: `evt_${suffix}`,
      homeId,
      correlationId: `corr_${suffix}`,
      occurredAt: new Date().toISOString(),
      sensor: {
        entityId: `ent_${suffix}`,
        name: "Utility room leak sensor",
        deviceClass: "moisture" as const,
        observedValue: "on",
        source: "virtual:test",
      },
    };
    const playbook = {
      playbookId: `playbook_${suffix}`,
      version: 1,
      homeId,
      name: "Observe-only integration fixture",
      status: "published" as const,
      triggerDeviceClass: "moisture" as const,
      preauthorized: true as const,
      mode: "test" as const,
      acknowledgementTimeoutMs: 5_000,
      actions: [],
      publishedAt: new Date().toISOString(),
    };

    const created = await createWorkflowIncident({
      workflowId,
      evidenceJson: JSON.stringify(evidence),
      playbookJson: JSON.stringify(playbook),
    });
    await expect(
      createWorkflowIncident({
        workflowId,
        evidenceJson: JSON.stringify(evidence),
        playbookJson: JSON.stringify(playbook),
      }),
    ).resolves.toEqual({ incidentId: created.incidentId, deduplicated: true });
    await appendWorkflowEvent({
      incidentId: created.incidentId,
      eventType: "incident.signal.validated",
      actor: "incident-workflow",
      detailsJson: JSON.stringify({ eventId: evidence.eventId }),
    });
    const delivery = {
      incidentId: created.incidentId,
      severity: "critical" as const,
      channel: "external-webhook",
      recipient: "home-owners",
      status: "delivered" as const,
      dedupeKey: `leak:${evidence.sensor.entityId}:step:0`,
      ttlSeconds: 3_600,
      requiredAck: true,
      escalationStep: 0,
    };
    await recordWorkflowDelivery(delivery);
    await recordWorkflowDelivery(delivery);
    await transitionWorkflowIncident({
      incidentId: created.incidentId,
      status: "monitoring",
      eventType: "incident.monitoring",
      actor: "usr_owner_test",
      principalId: "usr_owner_test",
      detailsJson: JSON.stringify({ acknowledged: true }),
    });
    await transitionWorkflowIncident({
      incidentId: created.incidentId,
      status: "resolved",
      eventType: "incident.resolved",
      actor: "usr_owner_test",
      principalId: "usr_owner_test",
      note: "Dry and inspected",
      detailsJson: JSON.stringify({ note: "Dry and inspected" }),
    });

    await expect(listIncidents({ homeId })).resolves.toMatchObject({
      incidents: [
        {
          incidentId: created.incidentId,
          workflowId,
          playbookId: playbook.playbookId,
          playbookVersion: 1,
          status: "resolved",
          requiredAck: true,
          resolutionNote: "Dry and inspected",
        },
      ],
    });
    const timeline = await incidentAudit({ incidentId: created.incidentId });
    expect(timeline.events.map((event) => event.eventType)).toEqual([
      "incident.created",
      "incident.signal.validated",
      "notification.delivered",
      "notification.delivered",
      "incident.monitoring",
      "incident.resolved",
    ]);
  });

  it("provides a safe versioned notification-only playbook before owner configuration", async () => {
    const response = await activeLeakPlaybook({
      homeId: `home_${randomUUID().replaceAll("-", "")}`,
    });
    expect(JSON.parse(response.playbookJson)).toMatchObject({
      playbookId: "playbook_leak_observe_only",
      version: 1,
      preauthorized: true,
      actions: [],
    });
  });
});
