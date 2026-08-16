import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { notifications, temporalbridge } from "~encore/clients";
import type {
  IncidentAuditView,
  IncidentPlaybookActionView,
  IncidentView,
  LeakPlaybookView,
} from "../shared/contracts";

export const createIncident = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/incidents" },
  async (request: {
    homeId: string;
    dedupeKey: string;
    severity: "info" | "warning" | "critical";
    title: string;
    body: string;
  }): Promise<{ incident: IncidentView; deduplicated: boolean }> =>
    notifications.createIncident(request),
);

export const listIncidents = api(
  { expose: true, method: "GET", path: "/api/v1/homes/:homeId/incidents" },
  async ({ homeId }: { homeId: string }): Promise<{ homeId: string; incidents: IncidentView[] }> =>
    notifications.listIncidents({ homeId }),
);

export const acknowledgeIncident = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/incidents/:incidentId/acknowledge" },
  async ({ incidentId }: { incidentId: string }): Promise<IncidentView> =>
    notifications.acknowledgeIncident({ incidentId, sessionToken: requireSessionToken() }),
);

export const escalateIncident = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/incidents/:incidentId/escalate" },
  async ({ incidentId }: { incidentId: string }): Promise<IncidentView> =>
    notifications.escalateIncident({ incidentId, sessionToken: requireSessionToken() }),
);

function requireSessionToken(): string {
  const auth = getAuthData();
  if (!auth) throw APIError.unauthenticated("Authentication is required");
  return auth.sessionToken;
}

export const incidentAudit = api(
  { expose: true, method: "GET", path: "/api/v1/incidents/:incidentId/audit" },
  async ({
    incidentId,
  }: {
    incidentId: string;
  }): Promise<{ incidentId: string; events: IncidentAuditView[] }> =>
    notifications.incidentAudit({ incidentId }),
);

export const saveLeakPlaybookDraft = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/homes/:homeId/incident-playbooks/leak/drafts",
  },
  async (request: {
    homeId: string;
    playbookId?: string;
    name: string;
    mode: "active" | "test";
    acknowledgementTimeoutMs: number;
    actions: IncidentPlaybookActionView[];
  }): Promise<LeakPlaybookView> =>
    notifications.saveLeakPlaybookDraft({
      ...request,
      sessionToken: requireSessionToken(),
      actionsJson: JSON.stringify(request.actions),
    }),
);

export const publishLeakPlaybook = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/incident-playbooks/:playbookId/versions/:version/publish",
  },
  async ({
    playbookId,
    version,
  }: {
    playbookId: string;
    version: number;
  }): Promise<LeakPlaybookView> =>
    notifications.publishLeakPlaybook({
      playbookId,
      version,
      sessionToken: requireSessionToken(),
    }),
);

export const resolveIncident = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/incidents/:incidentId/resolve" },
  async ({
    incidentId,
    status,
    note,
  }: {
    incidentId: string;
    status: "resolved" | "false_positive";
    note: string;
  }): Promise<{ accepted: true }> =>
    notifications.resolveIncident({
      incidentId,
      sessionToken: requireSessionToken(),
      resolutionJson: JSON.stringify({ status, note, resolvedAt: new Date().toISOString() }),
    }),
);

export const incidentWorkflowState = api(
  { expose: true, method: "GET", path: "/api/v1/incidents/:workflowId/workflow" },
  async ({ workflowId }: { workflowId: string }): Promise<{ stateJson: string }> =>
    temporalbridge.incidentWorkflowState({ workflowId }),
);
