import {
  type IncidentResolution,
  IncidentResolutionSchema,
  LeakIncidentEvidenceSchema,
  type LeakPlaybook,
  LeakPlaybookSchema,
  ProposedActionSchema,
} from "@hestia/contracts";
import { APIError, api } from "encore.dev/api";
import { identity, temporalbridge } from "~encore/clients";
import type { IncidentAuditView, IncidentView, LeakPlaybookView } from "../shared/contracts";
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
      requiredAck: false,
      escalationStep: 0,
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
        (delivery_id, incident_id, channel, recipient, status, delivered_at, severity,
         dedupe_key, ttl_expires_at, required_ack, escalation_step)
      VALUES (
        ${id("del")}, ${incident.incidentId}, 'local-inbox', 'home', 'delivered', now(),
        ${incident.severity}, ${request.dedupeKey}, now() + interval '1 day', FALSE, 0
      )
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
    if (incident.workflowId) {
      await temporalbridge.acknowledgeIncidentWorkflow({
        workflowId: incident.workflowId,
        acknowledgementJson: JSON.stringify({
          principalId: authorization.principalId,
          acknowledgedAt: now.toISOString(),
        }),
      });
    }
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
      UPDATE incident SET escalation_step = escalation_step + 1, escalated_at = now()
      WHERE incident_id = ${incidentId}
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

export const createWorkflowIncident = api(
  { method: "POST", path: "/internal/incidents/workflow" },
  async ({
    workflowId,
    evidenceJson,
    playbookJson,
  }: {
    workflowId: string;
    evidenceJson: string;
    playbookJson: string;
  }): Promise<{ incidentId: string; deduplicated: boolean }> => {
    const evidence = LeakIncidentEvidenceSchema.parse(parseJson(evidenceJson));
    const playbook = LeakPlaybookSchema.parse(parseJson(playbookJson));
    if (evidence.homeId !== playbook.homeId) {
      throw APIError.invalidArgument("Evidence and playbook must belong to the same home");
    }
    const byWorkflow = await notificationsDB.queryRow<IncidentRow>`
      SELECT * FROM incident WHERE workflow_id = ${workflowId}
    `;
    if (byWorkflow) return { incidentId: byWorkflow.incident_id, deduplicated: true };
    const dedupeKey = `leak:${evidence.sensor.entityId}`;
    const active = await findActive(evidence.homeId, dedupeKey);
    if (active) {
      await audit(active.incidentId, "incident.deduplicated", "incident-workflow", {
        workflowId,
        sourceEventId: evidence.eventId,
      });
      return { incidentId: active.incidentId, deduplicated: true };
    }
    const incidentId = id("inc");
    await notificationsDB.exec`
      INSERT INTO incident (
        incident_id, home_id, dedupe_key, severity, status, title, body, created_at,
        workflow_id, playbook_id, playbook_version, source_event_id, required_ack, ttl_expires_at
      ) VALUES (
        ${incidentId}, ${evidence.homeId}, ${dedupeKey}, 'critical', 'open',
        'Water leak detected',
        ${`${evidence.sensor.name} reports ${evidence.sensor.observedValue}`},
        now(), ${workflowId}, ${playbook.playbookId}, ${playbook.version}, ${evidence.eventId},
        TRUE, now() + interval '1 day'
      )
    `;
    await audit(incidentId, "incident.created", "incident-workflow", {
      workflowId,
      playbookId: playbook.playbookId,
      playbookVersion: playbook.version,
      sourceEventId: evidence.eventId,
      testMode: playbook.mode === "test",
    });
    return { incidentId, deduplicated: false };
  },
);

export const appendWorkflowEvent = api(
  { method: "POST", path: "/internal/incidents/:incidentId/events" },
  async ({
    incidentId,
    eventType,
    actor,
    detailsJson,
  }: {
    incidentId: string;
    eventType: string;
    actor: string;
    detailsJson: string;
  }): Promise<{ accepted: true }> => {
    await requireIncident(incidentId);
    await audit(incidentId, eventType, actor, parseDetails(detailsJson));
    return { accepted: true };
  },
);

export const transitionWorkflowIncident = api(
  { method: "POST", path: "/internal/incidents/:incidentId/transition" },
  async (request: {
    incidentId: string;
    status: IncidentView["status"];
    eventType: string;
    actor: string;
    detailsJson: string;
    escalationStep?: number;
    principalId?: string;
    note?: string;
  }): Promise<{ accepted: true }> => {
    await requireIncident(request.incidentId);
    const resolved = ["resolved", "false_positive"].includes(request.status);
    await notificationsDB.exec`
      UPDATE incident SET
        status = ${request.status},
        escalation_step = COALESCE(${request.escalationStep ?? null}, escalation_step),
        acknowledged_at = CASE WHEN ${request.status} = 'acknowledged' THEN now() ELSE acknowledged_at END,
        acknowledged_by = CASE WHEN ${request.status} = 'acknowledged' THEN ${request.principalId ?? null} ELSE acknowledged_by END,
        escalated_at = CASE WHEN ${request.escalationStep ?? 0} > 0 THEN now() ELSE escalated_at END,
        resolved_at = CASE WHEN ${resolved} THEN now() ELSE resolved_at END,
        resolved_by = CASE WHEN ${resolved} THEN ${request.principalId ?? null} ELSE resolved_by END,
        resolution_note = CASE WHEN ${resolved} THEN ${request.note ?? null} ELSE resolution_note END
      WHERE incident_id = ${request.incidentId}
    `;
    await audit(
      request.incidentId,
      request.eventType,
      request.actor,
      parseDetails(request.detailsJson),
    );
    return { accepted: true };
  },
);

export const recordWorkflowDelivery = api(
  { method: "POST", path: "/internal/incidents/:incidentId/deliveries" },
  async (request: {
    incidentId: string;
    severity: IncidentView["severity"];
    channel: string;
    recipient: string;
    status: "delivered" | "skipped";
    dedupeKey: string;
    ttlSeconds: number;
    requiredAck: boolean;
    escalationStep: number;
    failureMessage?: string;
  }): Promise<{ accepted: true }> => {
    await requireIncident(request.incidentId);
    await notificationsDB.exec`
      INSERT INTO notification_delivery (
        delivery_id, incident_id, channel, recipient, status, attempts, delivered_at,
        severity, dedupe_key, ttl_expires_at, required_ack, escalation_step, failure_message
      ) VALUES (
        ${id("del")}, ${request.incidentId}, ${request.channel}, ${request.recipient},
        ${request.status}, 1, CASE WHEN ${request.status} = 'delivered' THEN now() ELSE NULL END,
        ${request.severity}, ${request.dedupeKey},
        now() + (${request.ttlSeconds} * interval '1 second'), ${request.requiredAck},
        ${request.escalationStep}, ${request.failureMessage ?? null}
      )
      ON CONFLICT (incident_id, channel, recipient, dedupe_key) DO UPDATE SET
        attempts = notification_delivery.attempts + 1,
        status = EXCLUDED.status,
        delivered_at = EXCLUDED.delivered_at,
        failure_message = EXCLUDED.failure_message
    `;
    await audit(request.incidentId, `notification.${request.status}`, request.channel, {
      recipient: request.recipient,
      dedupeKey: request.dedupeKey,
      escalationStep: request.escalationStep,
      ...(request.failureMessage ? { failureMessage: request.failureMessage } : {}),
    });
    return { accepted: true };
  },
);

export const saveLeakPlaybookDraft = api(
  { method: "POST", path: "/internal/homes/:homeId/incident-playbooks/leak/drafts" },
  async (request: {
    homeId: string;
    sessionToken: string;
    playbookId?: string;
    name: string;
    mode: "active" | "test";
    acknowledgementTimeoutMs: number;
    actionsJson: string;
  }): Promise<LeakPlaybookView> => {
    await requireOwner(request.sessionToken, request.homeId);
    const actions = ProposedActionSchema.array().max(20).parse(parseJson(request.actionsJson));
    const playbookId = request.playbookId ?? id("playbook");
    const versionRow = await notificationsDB.queryRow<{ version: number }>`
      SELECT COALESCE(MAX(version), 0)::int + 1 AS version
      FROM incident_playbook WHERE playbook_id = ${playbookId}
    `;
    const version = versionRow?.version ?? 1;
    const createdAt = new Date();
    LeakPlaybookSchema.parse({
      playbookId,
      version,
      homeId: request.homeId,
      name: request.name,
      status: "published",
      triggerDeviceClass: "moisture",
      preauthorized: true,
      mode: request.mode,
      acknowledgementTimeoutMs: request.acknowledgementTimeoutMs,
      actions,
      publishedAt: createdAt.toISOString(),
    });
    await notificationsDB.exec`
      INSERT INTO incident_playbook (
        playbook_id, version, home_id, name, status, trigger_device_class,
        preauthorized, mode, acknowledgement_timeout_ms, actions, created_at
      ) VALUES (
        ${playbookId}, ${version}, ${request.homeId}, ${request.name}, 'draft', 'moisture',
        TRUE, ${request.mode}, ${request.acknowledgementTimeoutMs}, ${actions}, ${createdAt}
      )
    `;
    return requirePlaybook(playbookId, version);
  },
);

export const publishLeakPlaybook = api(
  { method: "POST", path: "/internal/incident-playbooks/:playbookId/versions/:version/publish" },
  async ({
    playbookId,
    version,
    sessionToken,
  }: {
    playbookId: string;
    version: number;
    sessionToken: string;
  }): Promise<LeakPlaybookView> => {
    const draft = await requirePlaybook(playbookId, version);
    if (draft.status !== "draft") {
      throw APIError.failedPrecondition("Only a draft incident playbook can be published");
    }
    await requireOwner(sessionToken, draft.homeId);
    const transaction = await notificationsDB.begin();
    try {
      await transaction.exec`
        UPDATE incident_playbook SET status = 'retired'
        WHERE home_id = ${draft.homeId} AND trigger_device_class = 'moisture' AND status = 'published'
      `;
      await transaction.exec`
        UPDATE incident_playbook SET status = 'published', published_at = now()
        WHERE playbook_id = ${playbookId} AND version = ${version} AND status = 'draft'
      `;
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return requirePlaybook(playbookId, version);
  },
);

export const activeLeakPlaybook = api(
  { method: "GET", path: "/internal/homes/:homeId/incident-playbooks/leak/active" },
  async ({ homeId }: { homeId: string }): Promise<{ playbookJson: string }> => {
    const row = await notificationsDB.queryRow<PlaybookRow>`
      SELECT * FROM incident_playbook
      WHERE home_id = ${homeId} AND trigger_device_class = 'moisture' AND status = 'published'
    `;
    const playbook = row ? toPublishedPlaybook(row) : builtInObserveOnlyPlaybook(homeId);
    return { playbookJson: JSON.stringify(playbook) };
  },
);

export const resolveIncident = api(
  { method: "POST", path: "/internal/incidents/:incidentId/resolve" },
  async ({
    incidentId,
    sessionToken,
    resolutionJson,
  }: {
    incidentId: string;
    sessionToken: string;
    resolutionJson: string;
  }): Promise<{ accepted: true }> => {
    const incident = await requireIncident(incidentId);
    const actor = await requireOwner(sessionToken, incident.homeId);
    const resolution: IncidentResolution = IncidentResolutionSchema.parse({
      ...(parseJson(resolutionJson) as Record<string, unknown>),
      principalId: actor.principalId,
    });
    if (incident.workflowId) {
      await temporalbridge.resolveIncidentWorkflow({
        workflowId: incident.workflowId,
        resolutionJson: JSON.stringify(resolution),
      });
    } else {
      await transitionWorkflowIncident({
        incidentId,
        status: resolution.status,
        eventType: `incident.${resolution.status}`,
        actor: actor.principalId,
        principalId: actor.principalId,
        note: resolution.note,
        detailsJson: JSON.stringify({ note: resolution.note, resolvedAt: resolution.resolvedAt }),
      });
    }
    return { accepted: true };
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
  workflow_id: string | null;
  playbook_id: string | null;
  playbook_version: number | null;
  source_event_id: string | null;
  required_ack: boolean;
  ttl_expires_at: Date | null;
  escalation_step: number;
  acknowledged_at: Date | null;
  acknowledged_by: string | null;
  escalated_at: Date | null;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string | null;
}

interface PlaybookRow {
  playbook_id: string;
  version: number;
  home_id: string;
  name: string;
  status: LeakPlaybookView["status"];
  trigger_device_class: "moisture";
  preauthorized: true;
  mode: "active" | "test";
  acknowledgement_timeout_ms: number;
  actions: unknown;
  created_at: Date;
  published_at: Date | null;
}

async function findActive(homeId: string, dedupeKey: string): Promise<IncidentView | undefined> {
  const row = await notificationsDB.queryRow<IncidentRow>`
    SELECT * FROM incident WHERE home_id = ${homeId} AND dedupe_key = ${dedupeKey}
      AND status IN ('open', 'acknowledged', 'mitigated', 'monitoring')
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
    requiredAck: row.required_ack,
    escalationStep: row.escalation_step,
    ...(row.workflow_id ? { workflowId: row.workflow_id } : {}),
    ...(row.playbook_id ? { playbookId: row.playbook_id } : {}),
    ...(row.playbook_version ? { playbookVersion: row.playbook_version } : {}),
    ...(row.source_event_id ? { sourceEventId: row.source_event_id } : {}),
    ...(row.ttl_expires_at ? { ttlExpiresAt: row.ttl_expires_at.toISOString() } : {}),
    ...(row.acknowledged_at ? { acknowledgedAt: row.acknowledged_at.toISOString() } : {}),
    ...(row.acknowledged_by ? { acknowledgedBy: row.acknowledged_by } : {}),
    ...(row.escalated_at ? { escalatedAt: row.escalated_at.toISOString() } : {}),
    ...(row.resolved_at ? { resolvedAt: row.resolved_at.toISOString() } : {}),
    ...(row.resolved_by ? { resolvedBy: row.resolved_by } : {}),
    ...(row.resolution_note ? { resolutionNote: row.resolution_note } : {}),
  };
}

async function requirePlaybook(playbookId: string, version: number): Promise<LeakPlaybookView> {
  const row = await notificationsDB.queryRow<PlaybookRow>`
    SELECT * FROM incident_playbook WHERE playbook_id = ${playbookId} AND version = ${version}
  `;
  if (!row) throw APIError.notFound("Incident playbook version not found");
  return {
    playbookId: row.playbook_id,
    version: row.version,
    homeId: row.home_id,
    name: row.name,
    status: row.status,
    triggerDeviceClass: row.trigger_device_class,
    preauthorized: true,
    mode: row.mode,
    acknowledgementTimeoutMs: row.acknowledgement_timeout_ms,
    actions: ProposedActionSchema.array().parse(row.actions),
    createdAt: row.created_at.toISOString(),
    ...(row.published_at ? { publishedAt: row.published_at.toISOString() } : {}),
  };
}

function toPublishedPlaybook(row: PlaybookRow): LeakPlaybook {
  if (!row.published_at) {
    throw APIError.failedPrecondition("Published incident playbook has no publication timestamp");
  }
  return LeakPlaybookSchema.parse({
    playbookId: row.playbook_id,
    version: row.version,
    homeId: row.home_id,
    name: row.name,
    status: "published",
    triggerDeviceClass: "moisture",
    preauthorized: true,
    mode: row.mode,
    acknowledgementTimeoutMs: row.acknowledgement_timeout_ms,
    actions: ProposedActionSchema.array().parse(row.actions),
    publishedAt: row.published_at.toISOString(),
  });
}

function builtInObserveOnlyPlaybook(homeId: string): LeakPlaybook {
  return LeakPlaybookSchema.parse({
    playbookId: "playbook_leak_observe_only",
    version: 1,
    homeId,
    name: "Leak detection and notification only",
    status: "published",
    triggerDeviceClass: "moisture",
    preauthorized: true,
    mode: "active",
    acknowledgementTimeoutMs: 300_000,
    actions: [],
    publishedAt: "2026-08-15T00:00:00.000Z",
  });
}

async function requireOwner(
  sessionToken: string,
  homeId: string,
): Promise<{ principalId: string; role: "Owner" }> {
  const authorization = await identity.authorize({ sessionToken, homeId, risk: "R3" });
  if (!authorization.allowed || !authorization.principalId || authorization.role !== "Owner") {
    throw APIError.permissionDenied("Only the local owner can manage incident playbooks");
  }
  return { principalId: authorization.principalId, role: "Owner" };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw APIError.invalidArgument("Invalid JSON payload", error as Error);
  }
}

function parseDetails(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw APIError.invalidArgument("Incident details must be a JSON object");
  }
  return parsed as Record<string, unknown>;
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
