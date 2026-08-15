import { APIError, Gateway, type Header } from "encore.dev/api";
import { authHandler } from "encore.dev/auth";
import { identity } from "~encore/clients";
import type { IdentityRoleView } from "../shared/contracts";

interface AuthParams {
  authorization?: Header<"Authorization">;
}

export interface AuthData {
  userID: string;
  sessionToken: string;
  role: IdentityRoleView;
}

export const auth = authHandler<AuthParams, AuthData>(async ({ authorization }) => {
  if (!authorization?.startsWith("Bearer ")) return null;
  const sessionToken = authorization.slice(7);
  const session = await identity.sessionIdentity({ sessionToken });
  if (!session.authenticated || !session.principalId || !session.role) {
    throw APIError.unauthenticated("Session is invalid or expired");
  }
  return { userID: session.principalId, sessionToken, role: session.role };
});

export const gateway = new Gateway({ authHandler: auth });
