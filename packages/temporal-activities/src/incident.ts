import { createHmac } from "node:crypto";
import { loadEnv } from "@hestia/config";
import {
  type IncidentLifecycleStatus,
  type LeakIncidentEvidence,
  LeakIncidentEvidenceSchema,
  type LeakPlaybook,
  LeakPlaybookSchema,
} from "@hestia/contracts";

export interface CreateIncidentRecordInput {
  workflowId: string;
  evidence: LeakIncidentEvidence;
  playbook: LeakPlaybook;
}

export interface IncidentEventInput {
  incidentId: string;
  eventType: string;
  actor: string;
  details: Record<string, unknown>;
}

export interface IncidentTransitionInput extends IncidentEventInput {
  status: IncidentLifecycleStatus;
  escalationStep?: number;
  principalId?: string;
  note?: string;
}

export interface IncidentDeliveryInput {
  incidentId: string;
  severity: "info" | "warning" | "critical";
  channel: "local-inbox" | "external-webhook";
  recipient: string;
  title: string;
  body: string;
  dedupeKey: string;
  ttlSeconds: number;
  requiredAck: boolean;
  escalationStep: number;
}

export async function createIncidentRecord(
  input: CreateIncidentRecordInput,
): Promise<{ incidentId: string; deduplicated: boolean }> {
  const evidence = LeakIncidentEvidenceSchema.parse(input.evidence);
  const playbook = LeakPlaybookSchema.parse(input.playbook);
  return workerRequest("/workers/v1/incidents", {
    method: "POST",
    body: JSON.stringify({
      workflowId: input.workflowId,
      evidenceJson: JSON.stringify(evidence),
      playbookJson: JSON.stringify(playbook),
    }),
  });
}

export async function appendIncidentEvent(input: IncidentEventInput): Promise<void> {
  await workerRequest(`/workers/v1/incidents/${encodeURIComponent(input.incidentId)}/events`, {
    method: "POST",
    body: JSON.stringify({
      eventType: input.eventType,
      actor: input.actor,
      detailsJson: JSON.stringify(input.details),
    }),
  });
}

export async function transitionIncidentRecord(input: IncidentTransitionInput): Promise<void> {
  await workerRequest(`/workers/v1/incidents/${encodeURIComponent(input.incidentId)}/transition`, {
    method: "POST",
    body: JSON.stringify({
      status: input.status,
      eventType: input.eventType,
      actor: input.actor,
      detailsJson: JSON.stringify(input.details),
      ...(input.escalationStep === undefined ? {} : { escalationStep: input.escalationStep }),
      ...(input.principalId ? { principalId: input.principalId } : {}),
      ...(input.note ? { note: input.note } : {}),
    }),
  });
}

export async function deliverIncidentNotification(input: IncidentDeliveryInput): Promise<void> {
  const environment = loadEnv();
  let deliveryStatus: "delivered" | "skipped" = "delivered";
  let failureMessage: string | undefined;
  if (input.channel === "external-webhook") {
    if (!environment.INCIDENT_EXTERNAL_WEBHOOK_URL) {
      deliveryStatus = "skipped";
      failureMessage = "external webhook channel is not configured";
    } else {
      const body = JSON.stringify(input);
      const timestamp = String(Math.floor(Date.now() / 1_000));
      const signature = createHmac("sha256", environment.INCIDENT_EXTERNAL_WEBHOOK_SIGNING_KEY)
        .update(timestamp)
        .update(".")
        .update(body)
        .digest("hex");
      const response = await fetch(environment.INCIDENT_EXTERNAL_WEBHOOK_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hestia-timestamp": timestamp,
          "x-hestia-signature": `v1=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error(`external incident webhook returned HTTP ${response.status}`);
    }
  }
  await workerRequest(`/workers/v1/incidents/${encodeURIComponent(input.incidentId)}/deliveries`, {
    method: "POST",
    body: JSON.stringify({
      ...input,
      status: deliveryStatus,
      ...(failureMessage ? { failureMessage } : {}),
    }),
  });
}

async function workerRequest<T = unknown>(path: string, init: RequestInit): Promise<T> {
  const environment = loadEnv();
  if (!environment.WORKER_SERVICE_TOKEN) throw new Error("WORKER_SERVICE_TOKEN is not configured");
  const response = await fetch(`${environment.HESTIA_WORKER_API_URL.replace(/\/$/u, "")}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${environment.WORKER_SERVICE_TOKEN}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HESTIA worker API returned HTTP ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
