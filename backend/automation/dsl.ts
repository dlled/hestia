import { APIError } from "encore.dev/api";
import type {
  AutomationDefinitionView,
  AutomationSimulationView,
  JsonScalarView,
  RiskClassView,
} from "../shared/contracts";

const riskRank: Record<RiskClassView, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

export function validateDefinition(input: AutomationDefinitionView): AutomationDefinitionView {
  if (!input.automationId || input.version < 1 || !input.homeId || !input.name) {
    throw APIError.invalidArgument("Automation identity and positive version are required");
  }
  if (input.actions.length < 1 || input.actions.length > 50) {
    throw APIError.invalidArgument("Automation must contain between 1 and 50 actions");
  }
  if (input.actions.length > input.budgets.maxActionsPerRun || input.budgets.maxRunsPerHour < 1) {
    throw APIError.invalidArgument("Automation exceeds its declared action or run budget");
  }
  if (input.actions.some((action) => riskRank[action.risk] > riskRank[input.budgets.maxRisk])) {
    throw APIError.invalidArgument("Action risk exceeds the automation budget");
  }
  if (input.mode === "active" && (!input.shadowEvidenceId || !input.policyPromotionId)) {
    throw APIError.failedPrecondition(
      "Active automation requires shadow evidence and policy promotion",
    );
  }
  if (input.mode === "active" && input.actions.some((action) => action.risk === "R4")) {
    throw APIError.failedPrecondition(
      "R4 automation remains playbook-only and cannot be promoted here",
    );
  }
  return input;
}

export function simulateDefinition(
  definition: AutomationDefinitionView,
  snapshot: Record<string, JsonScalarView>,
  replayedAt: Date,
): AutomationSimulationView {
  const blockedReasons: string[] = [];
  const conditionsPassed = definition.conditions.every((condition) =>
    compare(snapshot[condition.entityId] ?? null, condition.operator, condition.value),
  );
  if (!conditionsPassed) blockedReasons.push("One or more deterministic conditions failed");
  if (definition.actions.length > definition.budgets.maxActionsPerRun) {
    blockedReasons.push("Action budget exceeded");
  }
  const triggered = conditionsPassed && blockedReasons.length === 0;
  return {
    automationId: definition.automationId,
    version: definition.version,
    triggered,
    conditionsPassed,
    proposedActions: triggered ? definition.actions : [],
    blockedReasons,
    effectful: false,
    replayedAt: replayedAt.toISOString(),
  };
}

function compare(
  left: JsonScalarView,
  operator: AutomationDefinitionView["conditions"][number]["operator"],
  right: JsonScalarView,
) {
  if (operator === "eq") return left === right;
  if (operator === "neq") return left !== right;
  if (typeof left !== "number" || typeof right !== "number") return false;
  if (operator === "gt") return left > right;
  if (operator === "gte") return left >= right;
  if (operator === "lt") return left < right;
  return left <= right;
}
