import {
  type ActionPlan,
  ActionPlanSchema,
  type ApprovalDecision,
  ApprovalDecisionSchema,
  type AutomationRunState,
  type DeviceCommandResult,
  type ExpectedObservation,
  TaskQueues,
  type TypedCommand,
} from "@hestia/contracts";
import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";

interface AutomationActivities {
  evaluateCommandPolicy(command: TypedCommand): Promise<{
    effect: "allow" | "deny" | "require_approval";
    risk: "R0" | "R1" | "R2" | "R3" | "R4";
    reasons: string[];
    approvalId?: string;
  }>;
  executeHomeAssistantCommand(
    command: TypedCommand,
    expected: ExpectedObservation,
  ): Promise<DeviceCommandResult>;
}

const { evaluateCommandPolicy } = proxyActivities<AutomationActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 3 },
});

const { executeHomeAssistantCommand: executeIdempotentCommand } =
  proxyActivities<AutomationActivities>({
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

const { executeHomeAssistantCommand: executeAtMostOnceCommand } =
  proxyActivities<AutomationActivities>({
    taskQueue: TaskQueues.deviceIo,
    startToCloseTimeout: "6 minutes",
    heartbeatTimeout: "15 seconds",
    retry: { maximumAttempts: 1 },
  });

export const approvalDecisionSignal =
  defineSignal<[decision: ApprovalDecision]>("approvalDecision");
export const cancelAutomationSignal = defineSignal("cancelAutomation");
export const automationStateQuery = defineQuery<AutomationRunState>("automationState");

const atMostOnceCapabilities = new Set(["lock.unlock", "security.disarm", "irrigation.runZone"]);

export async function actionPlanWorkflow(input: ActionPlan): Promise<AutomationRunState> {
  const plan = ActionPlanSchema.parse(input);
  let approval: ApprovalDecision | undefined;
  let cancelled = false;
  const state: AutomationRunState = {
    planId: plan.planId,
    status: "proposed",
    currentAction: 0,
    actions: plan.actions.map((action) => ({
      actionId: action.actionId,
      commandId: action.command.commandId,
      status: "pending",
    })),
    startedAt: new Date().toISOString(),
  };

  setHandler(automationStateQuery, () => state);
  setHandler(approvalDecisionSignal, (inputDecision) => {
    approval = ApprovalDecisionSchema.parse(inputDecision);
    state.approval = approval;
  });
  setHandler(cancelAutomationSignal, () => {
    cancelled = true;
  });

  const completed: number[] = [];
  for (const [index, action] of plan.actions.entries()) {
    state.currentAction = index;
    const execution = state.actions[index];
    if (!execution) throw new Error(`Missing execution state for action ${index}`);
    if (cancelled) return finish(state, "cancelled");

    state.status = "evaluating";
    const command = plan.dryRun ? { ...action.command, dryRun: true } : action.command;
    const policy = await evaluateCommandPolicy(command);
    execution.policy = policy;
    if (policy.effect === "deny") {
      execution.status = "rejected";
      execution.finishedAt = new Date().toISOString();
      execution.error = policy.reasons.join(" ");
      return finish(state, "rejected", execution.error);
    }

    if (policy.effect === "require_approval") {
      if (!policy.approvalId) {
        execution.status = "failed";
        return finish(state, "failed", "Policy required approval without an approval id");
      }
      state.status = "awaiting_approval";
      state.pendingApprovalId = policy.approvalId;
      const decided = await condition(
        () => cancelled || approval?.approvalId === policy.approvalId,
        "24 hours",
      );
      if (cancelled) return finish(state, "cancelled");
      if (!decided) {
        execution.status = "failed";
        execution.error = "Approval timed out";
        return finish(state, "timed_out", execution.error);
      }
      if (!approval?.approved) {
        execution.status = "rejected";
        execution.finishedAt = new Date().toISOString();
        return finish(state, "rejected", "Approval was rejected");
      }
      execution.status = "approved";
      state.pendingApprovalId = undefined;
    }

    state.status = "executing";
    execution.status = "executing";
    execution.startedAt = new Date().toISOString();
    try {
      state.status = "verifying";
      const result = await executeCommand(command, action.expectedObservation);
      execution.finishedAt = new Date().toISOString();
      execution.observedValue = result.observedValue;
      if (result.outcome !== "confirmed" && result.outcome !== "accepted") {
        execution.status = "failed";
        execution.error = `Command completed with outcome ${result.outcome}`;
        return await compensate(plan, completed, state, execution.error);
      }
      execution.status = "confirmed";
      completed.push(index);
    } catch (error) {
      execution.status = "failed";
      execution.finishedAt = new Date().toISOString();
      execution.error = errorMessage(error);
      return await compensate(plan, completed, state, execution.error);
    }
  }

  return finish(state, "completed");
}

async function executeCommand(command: TypedCommand, expected: ExpectedObservation) {
  return atMostOnceCapabilities.has(command.capability)
    ? executeAtMostOnceCommand(command, expected)
    : executeIdempotentCommand(command, expected);
}

async function compensate(
  plan: ActionPlan,
  completed: number[],
  state: AutomationRunState,
  reason: string,
): Promise<AutomationRunState> {
  if (!completed.some((index) => plan.actions[index]?.compensation)) {
    return finish(state, "failed", reason);
  }
  state.status = "compensating";
  for (const index of [...completed].reverse()) {
    const compensation = plan.actions[index]?.compensation;
    const execution = state.actions[index];
    if (!compensation || !execution) continue;
    try {
      const command = plan.dryRun
        ? { ...compensation.command, dryRun: true }
        : compensation.command;
      const result = await executeCommand(command, compensation.expectedObservation);
      if (result.outcome !== "confirmed" && result.outcome !== "accepted") {
        return finish(state, "failed", `${reason}; compensation ${index} ${result.outcome}`);
      }
      execution.status = "compensated";
      execution.finishedAt = new Date().toISOString();
    } catch (error) {
      return finish(state, "failed", `${reason}; compensation ${index}: ${errorMessage(error)}`);
    }
  }
  return finish(state, "compensated", reason);
}

function finish(
  state: AutomationRunState,
  status: AutomationRunState["status"],
  error?: string,
): AutomationRunState {
  state.status = status;
  state.finishedAt = new Date().toISOString();
  state.pendingApprovalId = undefined;
  if (error) state.error = error;
  return state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown automation failure";
}
