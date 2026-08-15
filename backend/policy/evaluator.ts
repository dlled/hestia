import { CapabilityIdSchema, RiskClassSchema } from "@hestia/contracts";
import { evaluatePolicy } from "@hestia/policy";
import type { EvaluatePolicyRequest, PolicyDecisionView } from "../shared/contracts";

export function evaluateDeterministically(request: EvaluatePolicyRequest): PolicyDecisionView {
  const capability = CapabilityIdSchema.parse(request.capability);
  const declaredRisk =
    request.declaredRisk === undefined ? undefined : RiskClassSchema.parse(request.declaredRisk);
  return evaluatePolicy({
    capability,
    ...(declaredRisk ? { declaredRisk } : {}),
    preauthorizedPlaybook: request.preauthorizedPlaybook,
    dryRun: request.dryRun,
  });
}
