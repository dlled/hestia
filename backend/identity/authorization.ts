import type {
  AuthorizationDecisionView,
  AuthorizationRequestView,
  IdentityRoleView,
  RiskClassView,
} from "../shared/contracts";

export interface ScopeGrantView {
  homeId: string;
  areaId?: string;
  deviceId?: string;
  capability?: string;
  riskCeiling: RiskClassView;
  expiresAt?: string;
}

const riskRank: Record<RiskClassView, number> = { R0: 0, R1: 1, R2: 2, R3: 3, R4: 4 };

export function evaluateAuthorization(input: {
  principalId: string;
  role: IdentityRoleView;
  request: Omit<AuthorizationRequestView, "sessionToken">;
  grants: ScopeGrantView[];
  now?: Date;
}): AuthorizationDecisionView {
  if (input.role === "Owner") return allow(input, "Owner has full local authority");
  const now = input.now ?? new Date();
  const grant = input.grants.find(
    (candidate) =>
      candidate.homeId === input.request.homeId &&
      (!candidate.areaId || candidate.areaId === input.request.areaId) &&
      (!candidate.deviceId || candidate.deviceId === input.request.deviceId) &&
      (!candidate.capability || candidate.capability === input.request.capability) &&
      (!candidate.expiresAt || Date.parse(candidate.expiresAt) > now.getTime()) &&
      riskRank[input.request.risk ?? "R0"] <= riskRank[candidate.riskCeiling],
  );
  return grant
    ? allow(input, "Matching least-privilege grant")
    : {
        allowed: false,
        principalId: input.principalId,
        role: input.role,
        reason: "No active grant covers the requested scope and risk",
      };
}

function allow(
  input: { principalId: string; role: IdentityRoleView },
  reason: string,
): AuthorizationDecisionView {
  return { allowed: true, principalId: input.principalId, role: input.role, reason };
}
