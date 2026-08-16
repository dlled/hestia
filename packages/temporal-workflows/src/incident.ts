import {
  type DeviceCommandResult,
  type IncidentAcknowledgement,
  IncidentAcknowledgementSchema,
  type IncidentResolution,
  IncidentResolutionSchema,
  type IncidentWorkflowState,
  type LeakIncidentEvidence,
  LeakIncidentEvidenceSchema,
  type LeakIncidentInput,
  LeakIncidentInputSchema,
  TaskQueues,
  type TypedCommand,
} from "@hestia/contracts";
import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

interface IncidentActivities {
  createIncidentRecord(input: {
    workflowId: string;
    evidence: LeakIncidentEvidence;
    playbook: LeakIncidentInput["playbook"];
  }): Promise<{ incidentId: string; deduplicated: boolean }>;
  appendIncidentEvent(input: {
    incidentId: string;
    eventType: string;
    actor: string;
    details: Record<string, unknown>;
  }): Promise<void>;
  transitionIncidentRecord(input: {
    incidentId: string;
    status: "open" | "acknowledged" | "mitigated" | "monitoring" | "resolved" | "false_positive";
    eventType: string;
    actor: string;
    details: Record<string, unknown>;
    escalationStep?: number;
    principalId?: string;
    note?: string;
  }): Promise<void>;
  deliverIncidentNotification(input: {
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
  }): Promise<void>;
  evaluateCommandPolicy(
    command: TypedCommand,
    context: { preauthorizedPlaybook: true },
  ): Promise<{
    effect: "allow" | "deny" | "require_approval";
    risk: "R0" | "R1" | "R2" | "R3" | "R4";
    reasons: string[];
  }>;
  executeHomeAssistantCommand(
    command: TypedCommand,
    expected: LeakIncidentInput["playbook"]["actions"][number]["expectedObservation"],
  ): Promise<DeviceCommandResult>;
}

const records = proxyActivities<IncidentActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { initialInterval: "1 second", maximumAttempts: 5 },
});

const policy = proxyActivities<IncidentActivities>({
  taskQueue: TaskQueues.automation,
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const devices = proxyActivities<IncidentActivities>({
  taskQueue: TaskQueues.deviceIo,
  startToCloseTimeout: "6 minutes",
  heartbeatTimeout: "15 seconds",
  retry: {
    maximumAttempts: 3,
    nonRetryableErrorTypes: [
      "IntegrationNotConfigured",
      "InvalidCommandTarget",
      "InvalidCommandInput",
      "UnknownEntity",
      "UnsupportedCapability",
    ],
  },
});

export const incidentAcknowledgedSignal =
  defineSignal<[acknowledgement: IncidentAcknowledgement]>("incidentAcknowledged");
export const incidentResolvedSignal =
  defineSignal<[resolution: IncidentResolution]>("incidentResolved");
export const incidentEvidenceSignal =
  defineSignal<[evidence: LeakIncidentEvidence]>("incidentEvidence");
export const incidentStateQuery = defineQuery<IncidentWorkflowState>("incidentState");

export async function incidentWorkflow(
  rawInput: LeakIncidentInput,
): Promise<IncidentWorkflowState> {
  const input = LeakIncidentInputSchema.parse(rawInput);
  const workflowId = workflowInfo().workflowId;
  let acknowledgement: IncidentAcknowledgement | undefined;
  let resolution: IncidentResolution | undefined;
  const evidence = new Map([[input.evidence.eventId, input.evidence]]);
  let persistedEvidenceCount = 1;
  const state: IncidentWorkflowState = {
    workflowId,
    homeId: input.evidence.homeId,
    playbookId: input.playbook.playbookId,
    playbookVersion: input.playbook.version,
    phase: "validating",
    severity: "critical",
    evidenceEventIds: [input.evidence.eventId],
    actions: input.playbook.actions.map((action) => ({
      actionId: action.actionId,
      status: "pending",
    })),
    escalationStep: 0,
    startedAt: new Date().toISOString(),
  };

  setHandler(incidentStateQuery, () => state);
  setHandler(incidentAcknowledgedSignal, (value) => {
    acknowledgement = IncidentAcknowledgementSchema.parse(value);
    state.acknowledgement = acknowledgement;
  });
  setHandler(incidentResolvedSignal, (value) => {
    resolution = IncidentResolutionSchema.parse(value);
    state.resolution = resolution;
  });
  setHandler(incidentEvidenceSignal, (value) => {
    const parsed = LeakIncidentEvidenceSchema.parse(value);
    if (parsed.homeId !== state.homeId || parsed.sensor.entityId !== input.evidence.sensor.entityId)
      return;
    evidence.set(parsed.eventId, parsed);
    state.evidenceEventIds = [...evidence.keys()];
  });

  const created = await records.createIncidentRecord({ workflowId, ...input });
  state.incidentId = created.incidentId;
  const incidentId = created.incidentId;

  if (!validLeakEvidence(input.evidence)) {
    state.phase = "false_positive";
    state.finishedAt = new Date().toISOString();
    await records.transitionIncidentRecord({
      incidentId,
      status: "false_positive",
      eventType: "incident.false_positive",
      actor: "incident-workflow",
      details: { reason: "signal did not meet the moisture incident contract" },
    });
    return state;
  }

  await records.appendIncidentEvent({
    incidentId,
    eventType: "incident.signal.validated",
    actor: "incident-workflow",
    details: { eventId: input.evidence.eventId, sensorEntityId: input.evidence.sensor.entityId },
  });

  state.phase = "mitigating";
  let mitigationFailed = false;
  const completedActionIndexes: number[] = [];
  for (const [index, action] of input.playbook.actions.entries()) {
    const actionState = state.actions[index];
    if (!actionState) throw new Error(`Missing incident action state ${index}`);
    const decision = await policy.evaluateCommandPolicy(action.command, {
      preauthorizedPlaybook: true,
    });
    if (decision.effect !== "allow") {
      actionState.status = "failed";
      actionState.error = decision.reasons.join(" ");
      mitigationFailed = true;
      break;
    }
    try {
      const result = await devices.executeHomeAssistantCommand(
        action.command,
        action.expectedObservation,
      );
      actionState.result = result;
      if (result.outcome === "confirmed" || result.outcome === "accepted") {
        actionState.status = "confirmed";
        completedActionIndexes.push(index);
      } else {
        actionState.status = "failed";
        actionState.error = `Device command ended as ${result.outcome}`;
        mitigationFailed = true;
        break;
      }
    } catch (error) {
      actionState.status = "failed";
      actionState.error = error instanceof Error ? error.message : "device activity failed";
      mitigationFailed = true;
      break;
    }
  }

  if (mitigationFailed) {
    await compensate(input, state, completedActionIndexes);
    await records.appendIncidentEvent({
      incidentId,
      eventType: "incident.mitigation.partial_failure",
      actor: "incident-workflow",
      details: {
        actions: state.actions.map((item) => ({ actionId: item.actionId, status: item.status })),
      },
    });
  } else {
    await records.transitionIncidentRecord({
      incidentId,
      status: "mitigated",
      eventType: "incident.mitigated",
      actor: "incident-workflow",
      details: { playbookId: input.playbook.playbookId, version: input.playbook.version },
    });
  }

  state.phase = "notifying";
  await records.deliverIncidentNotification(notification(input, incidentId, "local-inbox", 0));
  await records.deliverIncidentNotification(notification(input, incidentId, "external-webhook", 0));

  state.phase = "awaiting_acknowledgement";
  await records.transitionIncidentRecord({
    incidentId,
    status: mitigationFailed ? "open" : "mitigated",
    eventType: "incident.awaiting_acknowledgement",
    actor: "incident-workflow",
    details: { timeoutMs: input.playbook.acknowledgementTimeoutMs, requiredAck: true },
  });
  const acknowledgedInTime = await condition(
    () => acknowledgement !== undefined || resolution !== undefined,
    input.playbook.acknowledgementTimeoutMs,
  );
  await flushEvidence(records, incidentId, evidence, persistedEvidenceCount);
  persistedEvidenceCount = evidence.size;

  if (!acknowledgedInTime && !resolution) {
    state.phase = "escalated";
    state.escalationStep = 1;
    await records.deliverIncidentNotification(
      notification(input, incidentId, "external-webhook", 1),
    );
    await records.transitionIncidentRecord({
      incidentId,
      status: mitigationFailed ? "open" : "mitigated",
      eventType: "incident.escalated",
      actor: "incident-workflow",
      details: { reason: "acknowledgement timeout", channel: "external-webhook" },
      escalationStep: 1,
    });
    await condition(() => acknowledgement !== undefined || resolution !== undefined);
  }

  if (acknowledgement) {
    state.phase = "monitoring";
    await records.transitionIncidentRecord({
      incidentId,
      status: "monitoring",
      eventType: "incident.monitoring",
      actor: acknowledgement.principalId,
      principalId: acknowledgement.principalId,
      details: { acknowledgedAt: acknowledgement.acknowledgedAt },
    });
  }

  if (!resolution) await condition(() => resolution !== undefined);
  if (!resolution) throw new Error("Incident resolution signal was not retained");
  state.phase = resolution.status;
  state.finishedAt = resolution.resolvedAt;
  await flushEvidence(records, incidentId, evidence, persistedEvidenceCount);
  await records.transitionIncidentRecord({
    incidentId,
    status: resolution.status,
    eventType: `incident.${resolution.status}`,
    actor: resolution.principalId,
    principalId: resolution.principalId,
    note: resolution.note,
    details: { resolvedAt: resolution.resolvedAt, note: resolution.note },
  });
  return state;
}

function validLeakEvidence(evidence: LeakIncidentEvidence): boolean {
  return ["on", "wet", "detected", "true"].includes(evidence.sensor.observedValue.toLowerCase());
}

async function compensate(
  input: LeakIncidentInput,
  state: IncidentWorkflowState,
  completedIndexes: number[],
): Promise<void> {
  for (const index of [...completedIndexes].reverse()) {
    const action = input.playbook.actions[index];
    const actionState = state.actions[index];
    if (!action?.compensation || !actionState) continue;
    try {
      const decision = await policy.evaluateCommandPolicy(action.compensation.command, {
        preauthorizedPlaybook: true,
      });
      if (decision.effect !== "allow") continue;
      const result = await devices.executeHomeAssistantCommand(
        action.compensation.command,
        action.compensation.expectedObservation,
      );
      if (result.outcome === "confirmed" || result.outcome === "accepted") {
        actionState.status = "compensated";
      }
    } catch {
      // The original failure remains authoritative; compensation is best effort and audited in state.
    }
  }
}

function notification(
  input: LeakIncidentInput,
  incidentId: string,
  channel: "local-inbox" | "external-webhook",
  escalationStep: number,
) {
  return {
    incidentId,
    severity: "critical" as const,
    channel,
    recipient: escalationStep === 0 ? "home-owners" : "home-emergency-contacts",
    title: escalationStep === 0 ? "Water leak detected" : "URGENT: water leak not acknowledged",
    body: `${input.evidence.sensor.name} reports ${input.evidence.sensor.observedValue}. Playbook ${input.playbook.playbookId} v${input.playbook.version} is active.`,
    dedupeKey: `leak:${input.evidence.sensor.entityId}:step:${escalationStep}`,
    ttlSeconds: 86_400,
    requiredAck: true,
    escalationStep,
  };
}

async function flushEvidence(
  recordActivities: typeof records,
  incidentId: string,
  evidence: Map<string, LeakIncidentEvidence>,
  persistedCount: number,
): Promise<void> {
  for (const item of [...evidence.values()].slice(persistedCount)) {
    await recordActivities.appendIncidentEvent({
      incidentId,
      eventType: "incident.evidence.appended",
      actor: "incident-workflow",
      details: { eventId: item.eventId, observedValue: item.sensor.observedValue },
    });
  }
}
