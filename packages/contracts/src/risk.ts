import { z } from "zod";

export const RiskClassSchema = z.enum(["R0", "R1", "R2", "R3", "R4"]);
export type RiskClass = z.infer<typeof RiskClassSchema>;

export const RISK_RANK: Record<RiskClass, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
};

export function riskAtLeast(actual: RiskClass, minimum: RiskClass): boolean {
  return RISK_RANK[actual] >= RISK_RANK[minimum];
}

export const PolicyEffectSchema = z.enum(["allow", "deny", "require_approval"]);
export type PolicyEffect = z.infer<typeof PolicyEffectSchema>;

export const PolicyDecisionSchema = z.object({
  effect: PolicyEffectSchema,
  risk: RiskClassSchema,
  reasons: z.array(z.string().min(1)).min(1),
  approvalId: z.string().optional(),
});

export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;
