export interface Meta {
  name: string;
  version: string;
  phase: string;
  thesis: string;
  lanes: string[];
}

export interface Health {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  timestamp: string;
}

export interface Capability {
  id: string;
  title: string;
  baseRisk: string;
  privacySensitive: boolean;
}

export interface PingStart {
  workflowId: string;
  runId: string;
  status: string;
}

export interface PingStatus {
  workflowId: string;
  runId: string;
  status: string;
  result?: {
    holdMs: number;
    started: { at: string; workerId: string; requestedBy: string };
    finished: { at: string; workerId: string; requestedBy: string };
  };
}

export interface PolicyDecision {
  effect: "allow" | "deny" | "require_approval";
  risk: string;
  reasons: string[];
}

export interface TwinEntity {
  id: string;
  homeId: string;
  deviceId?: string;
  areaId?: string;
  name: string;
  domain: string;
  capabilities: string[];
  externalRef: {
    system: "home_assistant";
    instanceId: string;
    entityId: string;
  };
  observedState: {
    value: unknown;
    unit?: string;
    timestamp: string;
    source: string;
    quality: "good" | "uncertain" | "stale" | "unavailable";
  };
}

export interface EntityList {
  homeId: string;
  entities: TwinEntity[];
}

export interface HomeTopology {
  homeId: string;
  areas: Array<{ id: string; name: string; kind: string }>;
  devices: Array<{
    id: string;
    areaId?: string;
    name: string;
    manufacturer?: string;
    model?: string;
    integration: string;
  }>;
}

export interface HomeAssistantSyncResult {
  discovered: number;
  published: number;
  areas?: number;
  devices?: number;
  topology?: "available" | "degraded";
  syncedAt: string;
}

export interface IntegrationCheckpoint {
  status: "ok" | "degraded" | "down";
  rest: boolean;
  streaming: boolean;
  topology: boolean;
  lastSuccessfulSyncAt?: string;
  discoveredEntities: number;
  discoveredAreas: number;
  discoveredDevices: number;
  failureMessage?: string;
}

export interface SleepContext {
  homeId: string;
  generatedAt: string;
  readiness: "ready" | "degraded";
  summary: { relevant: number; stale: number; unavailable: number };
  categories: Record<"lights" | "climate" | "covers" | "media" | "alarm", SleepContextItem[]>;
}

export interface SleepContextItem {
  entityId: string;
  name: string;
  domain: string;
  observedState: TwinEntity["observedState"];
  attention: "ready" | "stale" | "unavailable";
}

export interface ActionPlan {
  planId: string;
  version: number;
  homeId: string;
  title: string;
  requestedBy: string;
  createdAt: string;
  dryRun: boolean;
  actions: Array<{
    actionId: string;
    command: {
      commandId: string;
      capability: string;
      target: { homeId: string; entityId?: string };
      input: Record<string, unknown>;
      risk: string;
    };
    expectedObservation: { entityId: string; attribute: string; equals: unknown };
  }>;
}

export interface SleepPlanPreview {
  plan: ActionPlan;
  skipped: Array<{ entityId: string; name: string; reason: string }>;
}

export interface IntentPlanPreview {
  interpretation: {
    kind: "sleep" | "unsupported";
    confidence: number;
    summary: string;
    sleep: {
      climateTargetC: number;
      closeCovers: boolean;
      armAlarm: boolean;
    } | null;
  };
  preview?: SleepPlanPreview;
  modelProfile: string;
}

export interface AgentIntentState {
  status: "interpreting" | "awaiting_clarification" | "planning" | "completed" | "failed";
  request: { utterance: string; requestedBy: string };
  attempt: number;
  interpretation?: IntentPlanPreview["interpretation"];
  preview?: SleepPlanPreview;
  error?: string;
}

export interface AutomationRun {
  workflowId: string;
  runId: string;
  planId: string;
  version: number;
  startedAt: string;
  state: {
    planId: string;
    status: string;
    currentAction: number;
    pendingApprovalId?: string;
    actions: Array<{
      actionId: string;
      commandId: string;
      status: string;
      policy?: PolicyDecision;
      error?: string;
    }>;
  };
}

export interface AutomationAudit {
  workflowId: string;
  events: Array<{
    sequence: number;
    eventType: string;
    occurredAt: string;
    actor: string;
    details: Record<string, unknown>;
  }>;
}

export type IdentityRole = "Owner" | "Admin" | "Member" | "Guest" | "Service Account";

export interface IdentitySession {
  sessionId: string;
  sessionToken: string;
  principalId: string;
  role: IdentityRole;
  expiresAt: string;
}

export interface IdentityProfile {
  principalId: string;
  displayName: string;
  role: IdentityRole;
  status: "pending" | "active" | "revoked";
  expiresAt?: string;
  sessionId: string;
  sessionExpiresAt: string;
}

export interface IdentityAdminSnapshot {
  principals: Array<{
    principalId: string;
    displayName: string;
    role: IdentityRole;
    status: "pending" | "active" | "revoked";
    expiresAt?: string;
    createdAt: string;
  }>;
  passkeys: Array<{
    credentialId: string;
    principalId: string;
    label: string;
    deviceType: string;
    backedUp: boolean;
    transports: string[];
    createdAt: string;
    revokedAt?: string;
  }>;
  sessions: Array<{
    sessionId: string;
    principalId: string;
    expiresAt: string;
    createdAt: string;
    revokedAt?: string;
  }>;
  grants: Array<{
    grantId: string;
    principalId: string;
    homeId: string;
    areaId?: string;
    deviceId?: string;
    capability?: string;
    riskCeiling: "R0" | "R1" | "R2" | "R3" | "R4";
    expiresAt?: string;
    createdAt: string;
    revokedAt?: string;
  }>;
  audit: Array<{
    sequence: number;
    eventType: string;
    principalId?: string;
    actorId?: string;
    occurredAt: string;
    details: Record<string, unknown>;
  }>;
}

const identitySessionKey = "hestia.identity.session.v1";

export function readIdentitySession(): IdentitySession | null {
  if (typeof sessionStorage === "undefined") return null;
  const stored = sessionStorage.getItem(identitySessionKey);
  if (!stored) return null;
  try {
    const session = JSON.parse(stored) as Partial<IdentitySession>;
    if (
      typeof session.sessionId !== "string" ||
      typeof session.sessionToken !== "string" ||
      typeof session.principalId !== "string" ||
      typeof session.role !== "string" ||
      typeof session.expiresAt !== "string" ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      clearIdentitySession();
      return null;
    }
    return session as IdentitySession;
  } catch {
    clearIdentitySession();
    return null;
  }
}

export function storeIdentitySession(session: IdentitySession): void {
  sessionStorage.setItem(identitySessionKey, JSON.stringify(session));
}

export function clearIdentitySession(): void {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(identitySessionKey);
}

export async function getJson<T>(path: string): Promise<T> {
  return requestJson<T>(path, { method: "GET" });
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const session = readIdentitySession();
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (session) headers.set("authorization", `Bearer ${session.sessionToken}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const message = await responseMessage(response);
    if (response.status === 401 && session) clearIdentitySession();
    throw new Error(message || `${path} failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function responseMessage(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return "";
  try {
    const body = JSON.parse(text) as { message?: unknown; detail?: unknown };
    if (typeof body.message === "string") return body.message;
    if (typeof body.detail === "string") return body.detail;
  } catch {
    return text;
  }
  return text;
}
