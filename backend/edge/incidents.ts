import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { notifications } from "~encore/clients";
import type { IncidentAuditView, IncidentView } from "../shared/contracts";

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
