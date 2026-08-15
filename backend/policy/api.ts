import { APIError, api } from "encore.dev/api";
import type { EvaluatePolicyRequest, PolicyDecisionView } from "../shared/contracts";
import { evaluateDeterministically } from "./evaluator";

export const evaluate = api(
  { method: "POST", path: "/internal/policy/evaluate" },
  async (request: EvaluatePolicyRequest): Promise<PolicyDecisionView> => {
    try {
      return evaluateDeterministically(request);
    } catch (error) {
      throw APIError.invalidArgument("Invalid policy request", error as Error);
    }
  },
);
