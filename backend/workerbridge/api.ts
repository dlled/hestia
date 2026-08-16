import { APIError, api, type Header } from "encore.dev/api";
import { ai, automation, notifications } from "~encore/clients";
import type {
  IntentInterpretationView,
  ResidentIntentRequestView,
  SleepPlanPreviewRequestView,
  SleepPlanPreviewView,
} from "../shared/contracts";
import { validWorkerAuthorization } from "./auth";
import { WorkerServiceToken } from "./secrets";

type Authorized<T> = T & { authorization?: Header<"Authorization"> };

export const interpretIntent = api(
  { expose: true, method: "POST", path: "/workers/v1/intents/interpret", sensitive: true },
  async (request: Authorized<ResidentIntentRequestView>): Promise<IntentInterpretationView> => {
    authorize(request.authorization);
    return ai.interpretIntent(request);
  },
);

export const previewSleep = api(
  { expose: true, method: "POST", path: "/workers/v1/plans/sleep/preview", sensitive: true },
  async (request: Authorized<SleepPlanPreviewRequestView>): Promise<SleepPlanPreviewView> => {
    authorize(request.authorization);
    return automation.previewSleep(request);
  },
);

function authorize(authorization: string | undefined): void {
  if (!validWorkerAuthorization(authorization, WorkerServiceToken())) {
    throw APIError.unauthenticated("Invalid worker service credential");
  }
}

export const activeLeakPlaybook = api(
  {
    expose: true,
    method: "GET",
    path: "/workers/v1/homes/:homeId/incident-playbooks/leak/active",
    sensitive: true,
  },
  async ({
    homeId,
    authorization,
  }: Authorized<{ homeId: string }>): Promise<{ playbookJson: string }> => {
    authorize(authorization);
    return notifications.activeLeakPlaybook({ homeId });
  },
);

export const createIncidentRecord = api(
  { expose: true, method: "POST", path: "/workers/v1/incidents", sensitive: true },
  async (
    request: Authorized<{ workflowId: string; evidenceJson: string; playbookJson: string }>,
  ): Promise<{ incidentId: string; deduplicated: boolean }> => {
    authorize(request.authorization);
    return notifications.createWorkflowIncident({
      workflowId: request.workflowId,
      evidenceJson: request.evidenceJson,
      playbookJson: request.playbookJson,
    });
  },
);

export const appendIncidentEvent = api(
  {
    expose: true,
    method: "POST",
    path: "/workers/v1/incidents/:incidentId/events",
    sensitive: true,
  },
  async (
    request: Authorized<{
      incidentId: string;
      eventType: string;
      actor: string;
      detailsJson: string;
    }>,
  ): Promise<{ accepted: true }> => {
    authorize(request.authorization);
    return notifications.appendWorkflowEvent(request);
  },
);

export const transitionIncident = api(
  {
    expose: true,
    method: "POST",
    path: "/workers/v1/incidents/:incidentId/transition",
    sensitive: true,
  },
  async (
    request: Authorized<{
      incidentId: string;
      status: "open" | "acknowledged" | "mitigated" | "monitoring" | "resolved" | "false_positive";
      eventType: string;
      actor: string;
      detailsJson: string;
      escalationStep?: number;
      principalId?: string;
      note?: string;
    }>,
  ): Promise<{ accepted: true }> => {
    authorize(request.authorization);
    return notifications.transitionWorkflowIncident(request);
  },
);

export const recordIncidentDelivery = api(
  {
    expose: true,
    method: "POST",
    path: "/workers/v1/incidents/:incidentId/deliveries",
    sensitive: true,
  },
  async (
    request: Authorized<{
      incidentId: string;
      severity: "info" | "warning" | "critical";
      channel: string;
      recipient: string;
      status: "delivered" | "skipped";
      dedupeKey: string;
      ttlSeconds: number;
      requiredAck: boolean;
      escalationStep: number;
      failureMessage?: string;
    }>,
  ): Promise<{ accepted: true }> => {
    authorize(request.authorization);
    return notifications.recordWorkflowDelivery(request);
  },
);
