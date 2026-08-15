import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createIncident, incidentAudit, listIncidents } from "./api";

describe("incident notification persistence", () => {
  it("delivers once, deduplicates active incidents, and records an audit trail", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const homeId = `home_${suffix}`;
    const request = {
      homeId,
      dedupeKey: `water-leak-${suffix}`,
      severity: "critical" as const,
      title: "Water leak detected",
      body: "The utility room sensor reports water",
    };

    const created = await createIncident(request);
    const duplicate = await createIncident(request);

    expect(created.deduplicated).toBe(false);
    expect(duplicate).toMatchObject({
      deduplicated: true,
      incident: { incidentId: created.incident.incidentId },
    });
    await expect(listIncidents({ homeId })).resolves.toMatchObject({
      incidents: [{ incidentId: created.incident.incidentId, status: "open" }],
    });
    const audit = await incidentAudit({ incidentId: created.incident.incidentId });
    expect(audit.events.map((event) => event.eventType)).toEqual([
      "incident.created",
      "notification.delivered",
      "incident.deduplicated",
    ]);
  });
});
