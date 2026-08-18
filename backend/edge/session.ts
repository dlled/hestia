import { APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";

export function requireSessionToken(): string {
  const auth = getAuthData();
  if (!auth) throw APIError.unauthenticated("Authentication is required");
  return auth.sessionToken;
}
