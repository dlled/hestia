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

export async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed (${response.status})`);
  }
  return (await response.json()) as T;
}
