import { createHash } from "node:crypto";
import type { AppEnv } from "@hestia/config";
import {
  type HomeIngestionEvent,
  type LeakIncidentEvidence,
  type LeakPlaybook,
  LeakPlaybookSchema,
  TaskQueues,
} from "@hestia/contracts";
import type { Client } from "@temporalio/client";

export function leakEvidenceFromEvent(event: HomeIngestionEvent): LeakIncidentEvidence | undefined {
  if (event.eventType !== "home.entity.state.changed") return undefined;
  const entity = event.data.entity;
  if (entity.deviceClass !== "moisture") return undefined;
  const observedValue = String(entity.observedState.value).toLowerCase();
  if (!["on", "wet", "detected", "true"].includes(observedValue)) return undefined;
  return {
    eventId: event.eventId,
    homeId: event.homeId,
    correlationId: event.correlationId,
    occurredAt: event.occurredAt,
    sensor: {
      entityId: entity.id,
      name: entity.name,
      deviceClass: "moisture",
      observedValue,
      ...(entity.areaId ? { areaId: entity.areaId } : {}),
      source: entity.observedState.source,
    },
  };
}

export async function loadActiveLeakPlaybook(
  event: HomeIngestionEvent,
  environment: Pick<AppEnv, "HESTIA_WORKER_API_URL" | "WORKER_SERVICE_TOKEN">,
  request: typeof fetch = fetch,
): Promise<LeakPlaybook | undefined> {
  if (!leakEvidenceFromEvent(event)) return undefined;
  if (!environment.WORKER_SERVICE_TOKEN) throw new Error("WORKER_SERVICE_TOKEN is not configured");
  const response = await request(
    `${environment.HESTIA_WORKER_API_URL.replace(/\/$/u, "")}/workers/v1/homes/${encodeURIComponent(event.homeId)}/incident-playbooks/leak/active`,
    { headers: { authorization: `Bearer ${environment.WORKER_SERVICE_TOKEN}` } },
  );
  if (!response.ok) throw new Error(`active leak playbook lookup returned HTTP ${response.status}`);
  const body = (await response.json()) as { playbookJson?: unknown };
  if (typeof body.playbookJson !== "string")
    throw new Error("active leak playbook response is invalid");
  return LeakPlaybookSchema.parse(JSON.parse(body.playbookJson));
}

export async function startLeakIncident(
  temporal: Client,
  event: HomeIngestionEvent,
  playbook: LeakPlaybook,
): Promise<{ workflowId: string } | undefined> {
  const evidence = leakEvidenceFromEvent(event);
  if (!evidence) return undefined;
  const workflowId = leakWorkflowId(event.homeId, evidence.sensor.entityId);
  const handle = await temporal.workflow.start("incidentWorkflow", {
    workflowId,
    taskQueue: TaskQueues.notifications,
    args: [{ evidence, playbook }],
    workflowIdReusePolicy: "ALLOW_DUPLICATE",
    workflowIdConflictPolicy: "USE_EXISTING",
  });
  await handle.signal("incidentEvidence", evidence);
  return { workflowId: handle.workflowId };
}

export function leakWorkflowId(homeId: string, entityId: string): string {
  const digest = createHash("sha256").update(`${homeId}\0${entityId}`).digest("hex").slice(0, 24);
  return `hestia-incident-leak-${digest}`;
}
