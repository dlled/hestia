import {
  type CapabilityId,
  createId,
  type PolicyDecision,
  type RiskClass,
  riskAtLeast,
} from "@hestia/contracts";
import { getCapability } from "@hestia/domain";

export interface PolicyInput {
  capability: CapabilityId;
  declaredRisk?: RiskClass;
  preauthorizedPlaybook?: boolean;
  dryRun?: boolean;
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const capability = getCapability(input.capability);
  const risk = capability.baseRisk;

  if (input.declaredRisk && !riskAtLeast(input.declaredRisk, risk)) {
    return {
      effect: "deny",
      risk,
      reasons: [
        "Declared risk is lower than the capability's assigned risk; models cannot downgrade risk.",
      ],
    };
  }

  if (input.dryRun) {
    return {
      effect: "allow",
      risk,
      reasons: ["Dry-run does not produce a physical side effect."],
    };
  }

  if (risk === "R4" && !input.preauthorizedPlaybook) {
    return {
      effect: "deny",
      risk,
      reasons: ["R4 actions cannot be executed ad hoc; only a versioned playbook may run them."],
    };
  }

  if (riskAtLeast(risk, "R3") && !input.preauthorizedPlaybook) {
    return {
      effect: "require_approval",
      risk,
      reasons: [
        "R3+ actions require explicit approval unless a preauthorized playbook is in force.",
      ],
      approvalId: createId("appr"),
    };
  }

  return {
    effect: "allow",
    risk,
    reasons: [`Capability ${capability.id} is within the configured risk ceiling.`],
  };
}
