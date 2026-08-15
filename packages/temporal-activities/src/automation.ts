import { type PolicyDecision, type TypedCommand, TypedCommandSchema } from "@hestia/contracts";
import { evaluatePolicy } from "@hestia/policy";

export async function evaluateCommandPolicy(command: TypedCommand): Promise<PolicyDecision> {
  const parsed = TypedCommandSchema.parse(command);
  return evaluatePolicy({
    capability: parsed.capability,
    declaredRisk: parsed.risk,
    dryRun: parsed.dryRun,
  });
}
