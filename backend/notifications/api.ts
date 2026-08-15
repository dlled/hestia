import { APIError, api } from "encore.dev/api";
import { identity } from "~encore/clients";
import type { IncidentAuditView, IncidentView } from "../shared/contracts";
import { notificationsDB } from "./db";

export const createIncident = api(
  { method: "POST", path: "/internal/incidents" },
  async (request: {
    homeId: string;
    dedupeKey: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body: string;
  }): Promise<{ incident: IncidentView; deduplicated: boolean }> => {
    if (!request.homeId || !request.dedupeKey || !request.title || !request.body) {
      throw APIError.invalidArgument("Invalid incident");
    }
    const existing = await findActive(request.homeId, request.dedupeKey);
    if (existing) {
      await audit(existing.incidentId, "incident.deduplicated", "system", {
        dedupeKey: request.dedupeKey,
      });
      return { incident: existing, deduplicated: true };
    }
    const incident: IncidentView = {
      incidentId: id("inc"),
      homeId: request.homeId,
      dedupeKey: request.dedupeKey,
      severity: request.severity,
      status: "open",
      title: request.title,
      body: request.body,
      createdAt: new Date().toISOString(),
    };
    await notificationsDB.exec`
      INSERT INTO incident (incident_id, home_id, dedupe_key, severity, status, title, body, created_at)
      VALUES (
        ${incident.incidentId}, ${incident.homeId}, ${incident.dedupeKey}, ${incident.severity},
        ${incident.status}, ${incident.title}, ${incident.body}, ${new Date(incident.createdAt)}
      )
    `;
    await notificationsDB.exec`
      INSERT INTO notification_delivery
        (delivery_id, incident_id, channel, recipient, status, delivered_at)
      VALUES (${id("del")}, ${incident.incidentId}, 'local-inbox', 'home', 'delivered', now())
    `;
    await audit(incident.incidentId, "incident.created", "system", { severity: incident.severity });
    await audit(incident.incidentId, "notification.delivered", "local-inbox", {
      channel: "local-inbox",
    });
    return { incident, deduplicated: false };
  },
);

export const listIncidents = api(
  { method: "GET", path: "/internal/homes/:homeId/incidents" },
  async ({
    homeId,
  }: {
    homeId: string;
  }): Promise<{ homeId: string; incidents: IncidentView[] }> => {
    const incidents: IncidentView[] = [];
    for await (const row of notificationsDB.query<IncidentRow>`
      SELECT * FROM incident WHERE home_id = ${homeId} ORDER BY created_at DESC
    `)
      incidents.push(toView(row));
    return { homeId, incidents };
  },
);

export const acknowledgeIncident = api(
  { method: "POST", path: "/internal/incidents/:incidentId/acknowledge" },
  async ({
    incidentId,
    sessionToken,
  }: {
    incidentId: string;
    sessionToken: string;
  }): Promise<IncidentView> => {
    const incident = await requireIncident(incidentId);
    const authorization = await identity.authorize({
      sessionToken,
      homeId: incident.homeId,
      risk: "R1",
    });
    if (!authorization.allowed || !authorization.principalId) {
      throw APIError.permissionDenied("Incident acknowledgement is not authorized");
    }
    const now = new Date();
    await notificationsDB.exec`
      UPDATE incident SET status = 'acknowledged', acknowledged_at = ${now},
        acknowledged_by = ${authorization.principalId}
      WHERE incident_id = ${incidentId}
    `;
    await audit(incidentId, "incident.acknowledged", authorization.principalId, {});
    return requireIncident(incidentId);
  },
);

export const escalateIncident = api(
  { method: "POST", path: "/internal/incidents/:incidentId/escalate" },
  async ({
    incidentId,
    sessionToken,
  }: {
    incidentId: string;
    sessionToken: string;
  }): Promise<IncidentView> => {
    const incident = await requireIncident(incidentId);
    const authorization = await identity.authorize({
      sessionToken,
      homeId: incident.homeId,
      risk: "R3",
    });
    if (!authorization.allowed || !authorization.principalId) {
      throw APIError.permissionDenied("Incident escalation is not authorized");
    }
    await notificationsDB.exec`
      UPDATE incident SET status = 'escalated', escalated_at = now() WHERE incident_id = ${incidentId}
    `;
    await audit(incidentId, "incident.escalated", authorization.principalId, {});
    return requireIncident(incidentId);
  },
);

export const incidentAudit = api(
  { method: "GET", path: "/internal/incidents/:incidentId/audit" },
  async ({
    incidentId,
  }: {
    incidentId: string;
  }): Promise<{ incidentId: string; events: IncidentAuditView[] }> => {
    await requireIncident(incidentId);
    const events: IncidentAuditView[] = [];
    for await (const row of notificationsDB.query<{
      sequence: number;
      incident_id: string;
      event_type: string;
      actor: string;
      occurred_at: Date;
      details: IncidentAuditView["details"];
    }>`
      SELECT sequence::int, incident_id, event_type, actor, occurred_at, details
      FROM incident_audit_event WHERE incident_id = ${incidentId} ORDER BY sequence
    `)
      events.push({
        sequence: row.sequence,
        incidentId: row.incident_id,
        eventType: row.event_type,
        actor: row.actor,
        occurredAt: row.occurred_at.toISOString(),
        details: row.details,
      });
    return { incidentId, events };
  },
);

interface IncidentRow {
  incident_id: string;
  home_id: string;
  dedupe_key: string;
  severity: IncidentView["severity"];
  status: IncidentView["status"];
  title: string;
  body: string;
  created_at: Date;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  escalated_at: Date | null;
}

async function findActive(homeId: string, dedupeKey: string): Promise<IncidentView | undefined> {
  const row = await notificationsDB.queryRow<IncidentRow>`
    SELECT * FROM incident WHERE home_id = ${homeId} AND dedupe_key = ${dedupeKey}
      AND status IN ('open', 'escalated')
  `;
  return row ? toView(row) : undefined;
}

async function requireIncident(incidentId: string): Promise<IncidentView> {
  const row =
    await notificationsDB.queryRow<IncidentRow>`SELECT * FROM incident WHERE incident_id = ${incidentId}`;
  if (!row) throw APIError.notFound("Incident not found");
  return toView(row);
}

function toView(row: IncidentRow): IncidentView {
  return {
    incidentId: row.incident_id,
    homeId: row.home_id,
    dedupeKey: row.dedupe_key,
    severity: row.severity,
    status: row.status,
    title: row.title,
    body: row.body,
    createdAt: row.created_at.toISOString(),
    ...(row.acknowledged_at ? { acknowledgedAt: row.acknowledged_at.toISOString() } : {}),
    ...(row.acknowledged_by ? { acknowledgedBy: row.acknowledged_by } : {}),
    ...(row.escalated_at ? { escalatedAt: row.escalated_at.toISOString() } : {}),
  };
}

async function audit(
  incidentId: string,
  eventType: string,
  actor: string,
  details: Record<string, unknown>,
) {
  await notificationsDB.exec`
    INSERT INTO incident_audit_event (incident_id, event_type, actor, occurred_at, details)
    VALUES (${incidentId}, ${eventType}, ${actor}, now(), ${details})
  `;
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}
