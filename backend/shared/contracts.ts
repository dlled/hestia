export type StateQuality = "good" | "uncertain" | "stale" | "unavailable";

export interface ObservedStateView {
  value: string;
  unit?: string;
  timestamp: string;
  source: string;
  quality: StateQuality;
  staleAfterSec?: number;
}

export interface EntityView {
  id: string;
  homeId: string;
  deviceId?: string;
  areaId?: string;
  name: string;
  domain: string;
  capabilities: string[];
  externalRef: {
    system: "home_assistant" | "mqtt" | "webhook" | "virtual";
    instanceId: string;
    entityId: string;
  };
  observedState: ObservedStateView;
}

export interface AreaView {
  id: string;
  homeId: string;
  name: string;
  kind: "room" | "zone" | "floor" | "exterior" | "logical";
  externalRef: {
    system: "home_assistant" | "mqtt" | "webhook" | "virtual";
    instanceId: string;
    areaId: string;
  };
}

export interface DeviceView {
  id: string;
  homeId: string;
  areaId?: string;
  name: string;
  manufacturer?: string;
  model?: string;
  integration: string;
  externalRef: {
    system: "home_assistant" | "mqtt" | "webhook" | "virtual";
    instanceId: string;
    deviceId: string;
  };
}

export interface TopologyView {
  homeId: string;
  areas: AreaView[];
  devices: DeviceView[];
}

export interface SleepContextItemView {
  entityId: string;
  name: string;
  areaId?: string;
  domain: string;
  observedState: ObservedStateView;
  attention: "ready" | "stale" | "unavailable";
}

export interface SleepContextView {
  homeId: string;
  generatedAt: string;
  readiness: "ready" | "degraded";
  summary: { relevant: number; stale: number; unavailable: number };
  categories: {
    lights: SleepContextItemView[];
    climate: SleepContextItemView[];
    covers: SleepContextItemView[];
    media: SleepContextItemView[];
    alarm: SleepContextItemView[];
  };
}

export interface IntegrationCheckpointView {
  homeId: string;
  system: "home_assistant";
  instanceId: string;
  status: "ok" | "degraded" | "down";
  rest: boolean;
  streaming: boolean;
  topology: boolean;
  lastSyncStartedAt?: string;
  lastSyncCompletedAt?: string;
  lastSuccessfulSyncAt?: string;
  lastFailureAt?: string;
  failureMessage?: string;
  discoveredEntities: number;
  discoveredAreas: number;
  discoveredDevices: number;
}

export interface HomeAssistantSyncView {
  homeId: string;
  source: "home_assistant";
  discovered: number;
  published: number;
  areas: number;
  devices: number;
  topology: "available" | "degraded";
  syncedAt: string;
}

export type RiskClassView = "R0" | "R1" | "R2" | "R3" | "R4";

export interface EvaluatePolicyRequest {
  capability: string;
  declaredRisk?: RiskClassView;
  preauthorizedPlaybook?: boolean;
  dryRun?: boolean;
}

export interface PolicyDecisionView {
  effect: "allow" | "deny" | "require_approval";
  risk: RiskClassView;
  reasons: string[];
  approvalId?: string;
}

export type JsonScalarView = string | number | boolean | null;

export interface SleepPlanPreviewRequestView {
  homeId: string;
  requestedBy?: string;
  climateTargetC?: number;
  closeCovers?: boolean;
  armAlarm?: boolean;
  dryRun?: boolean;
}

export interface CommandView {
  commandId: string;
  idempotencyKey: string;
  capability: string;
  target: {
    homeId: string;
    entityId?: string;
    areaId?: string;
    selector?: string;
  };
  input: Record<string, JsonScalarView>;
  risk: RiskClassView;
  dryRun: boolean;
}

export interface ExpectedObservationView {
  entityId: string;
  attribute: string;
  equals: JsonScalarView;
  timeoutMs: number;
}

export interface ProposedActionView {
  actionId: string;
  command: CommandView;
  expectedObservation: ExpectedObservationView;
  compensation?: {
    command: CommandView;
    expectedObservation: ExpectedObservationView;
  };
}

export interface ActionPlanView {
  planId: string;
  version: number;
  homeId: string;
  title: string;
  requestedBy: string;
  createdAt: string;
  actions: ProposedActionView[];
  dryRun: boolean;
}

export interface SleepPlanPreviewView {
  plan: ActionPlanView;
  skipped: Array<{ entityId: string; name: string; reason: string }>;
}

export interface ApprovalDecisionView {
  workflowId: string;
  approvalId: string;
  approved: boolean;
  decidedBy: string;
  decidedAt: string;
}

export interface ActionExecutionView {
  actionId: string;
  commandId: string;
  status:
    | "pending"
    | "approved"
    | "executing"
    | "confirmed"
    | "rejected"
    | "failed"
    | "compensated"
    | "skipped";
  policy?: PolicyDecisionView;
  startedAt?: string;
  finishedAt?: string;
  observedValue?: JsonScalarView;
  error?: string;
}

export interface AutomationRunStateView {
  planId: string;
  status: string;
  currentAction: number;
  actions: ActionExecutionView[];
  pendingApprovalId?: string;
  approval?: {
    approvalId: string;
    approved: boolean;
    decidedBy: string;
    decidedAt: string;
  };
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface AutomationRunView {
  workflowId: string;
  runId: string;
  planId: string;
  version: number;
  startedAt: string;
  status: string;
  finishedAt?: string;
  state: AutomationRunStateView;
}

export interface AutomationAuditEventView {
  sequence: number;
  eventId: string;
  workflowId: string;
  runId: string;
  planId: string;
  eventType: string;
  occurredAt: string;
  actor: string;
  details: Record<string, JsonScalarView>;
}

export interface StructuredCompletionRequestView {
  profile: string;
  schemaName: string;
  jsonSchemaJson: string;
  system: string;
  inputJson: string;
}

export interface ResidentIntentRequestView {
  utterance: string;
  requestedBy?: string;
  homeId?: string;
}

export interface IntentInterpretationView {
  kind: "sleep" | "unsupported";
  confidence: number;
  summary: string;
  sleep?: {
    climateTargetC: number;
    closeCovers: boolean;
    armAlarm: boolean;
  };
}

export interface IntentPlanPreviewView {
  interpretation: IntentInterpretationView;
  preview?: SleepPlanPreviewView;
  modelProfile: string;
}

export interface AgentClarificationView {
  workflowId: string;
  text: string;
  providedBy: string;
}

export interface AgentIntentStateView {
  status: "interpreting" | "awaiting_clarification" | "planning" | "completed" | "failed";
  request: {
    utterance: string;
    requestedBy: string;
  };
  attempt: number;
  interpretation?: IntentInterpretationView;
  preview?: SleepPlanPreviewView;
  error?: string;
}

export type IdentityRoleView = "Owner" | "Admin" | "Member" | "Guest" | "Service Account";

export interface IdentityManifestView {
  bootstrap: "local-owner";
  authentication: Array<"passkey" | "local-recovery">;
  roles: IdentityRoleView[];
  scopeDimensions: Array<"home" | "area" | "device" | "capability" | "time" | "risk">;
  serviceTokens: { expiring: true; leastPrivilege: true };
}

export interface SessionView {
  sessionId: string;
  sessionToken: string;
  principalId: string;
  role: IdentityRoleView;
  expiresAt: string;
}

export interface IdentityProfileView {
  principalId: string;
  displayName: string;
  role: IdentityRoleView;
  status: "pending" | "active" | "revoked";
  expiresAt?: string;
  sessionId: string;
  sessionExpiresAt: string;
}

export interface IdentityPrincipalView {
  principalId: string;
  displayName: string;
  role: IdentityRoleView;
  status: "pending" | "active" | "revoked";
  expiresAt?: string;
  createdAt: string;
}

export interface IdentityPasskeyView {
  credentialId: string;
  principalId: string;
  label: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[];
  createdAt: string;
  revokedAt?: string;
}

export interface IdentitySessionRecordView {
  sessionId: string;
  principalId: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IdentityGrantView {
  grantId: string;
  principalId: string;
  homeId: string;
  areaId?: string;
  deviceId?: string;
  capability?: string;
  riskCeiling: RiskClassView;
  expiresAt?: string;
  createdAt: string;
  revokedAt?: string;
}

export interface IdentityAuditEventView {
  sequence: number;
  eventType: string;
  principalId?: string;
  actorId?: string;
  occurredAt: string;
  details: Record<string, JsonScalarView>;
}

export interface IdentityAdminSnapshotView {
  principals: IdentityPrincipalView[];
  passkeys: IdentityPasskeyView[];
  sessions: IdentitySessionRecordView[];
  grants: IdentityGrantView[];
  audit: IdentityAuditEventView[];
}

export interface AuthorizationInputView {
  homeId: string;
  areaId?: string;
  deviceId?: string;
  capability?: string;
  risk?: RiskClassView;
}

export interface AuthorizationRequestView extends AuthorizationInputView {
  sessionToken: string;
}

export interface AuthorizationDecisionView {
  allowed: boolean;
  principalId?: string;
  role?: IdentityRoleView;
  reason: string;
}

export interface IncidentView {
  incidentId: string;
  homeId: string;
  dedupeKey: string;
  severity: "info" | "warning" | "critical";
  status: "open" | "acknowledged" | "escalated" | "resolved";
  title: string;
  body: string;
  createdAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  escalatedAt?: string;
}

export interface IncidentAuditView {
  sequence: number;
  incidentId: string;
  eventType: string;
  actor: string;
  occurredAt: string;
  details: Record<string, JsonScalarView>;
}

export interface AutomationActionView {
  capability: string;
  entityId: string;
  input: Record<string, JsonScalarView>;
  risk: RiskClassView;
}

export interface AutomationDefinitionView {
  automationId: string;
  version: number;
  homeId: string;
  name: string;
  status: "draft" | "published" | "retired";
  mode: "shadow" | "active";
  trigger: {
    kind: "state" | "schedule" | "energy";
    entityId?: string;
    expression: string;
  };
  conditions: Array<{
    entityId: string;
    operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte";
    value: JsonScalarView;
  }>;
  actions: AutomationActionView[];
  budgets: { maxActionsPerRun: number; maxRunsPerHour: number; maxRisk: RiskClassView };
  locks: string[];
  rollback: "required" | "best_effort" | "none";
  shadowEvidenceId?: string;
  policyPromotionId?: string;
  createdAt: string;
}

export interface AutomationSimulationView {
  automationId: string;
  version: number;
  triggered: boolean;
  conditionsPassed: boolean;
  proposedActions: AutomationActionView[];
  blockedReasons: string[];
  effectful: false;
  replayedAt: string;
}

export interface EnergyReadingView {
  readingId: string;
  homeId: string;
  meterId: string;
  observedAt: string;
  powerW: number;
  energyKWh: number;
}

export interface EnergyTariffView {
  tariffId: string;
  homeId: string;
  startsAt: string;
  endsAt: string;
  pricePerKWh: number;
  currency: string;
}

export interface EnergyRecommendationView {
  recommendationId: string;
  homeId: string;
  generatedAt: string;
  title: string;
  rationale: string;
  suggestedStartAt: string;
  estimatedSavings: number;
  currency: string;
  effectful: false;
}
