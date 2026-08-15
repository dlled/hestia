import { timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";

export function authenticateMcpBearer(
  authorization: string | undefined,
  tokens: { read: string; automation: string },
  nowSeconds = Math.floor(Date.now() / 1_000),
): AuthInfo | undefined {
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const supplied = authorization.slice(7);
  if (secureEqual(supplied, tokens.automation)) {
    return authInfo(
      "hestia-automation-service-account",
      ["hestia:read", "hestia:automation:submit"],
      nowSeconds,
    );
  }
  if (secureEqual(supplied, tokens.read)) {
    return authInfo("hestia-read-service-account", ["hestia:read"], nowSeconds);
  }
  return undefined;
}

export function hasMcpScope(auth: AuthInfo | undefined, scope: string): boolean {
  return auth?.scopes.includes(scope) ?? false;
}

function authInfo(clientId: string, scopes: string[], nowSeconds: number): AuthInfo {
  return {
    token: "[redacted]",
    clientId,
    scopes,
    expiresAt: nowSeconds + 300,
  };
}

function secureEqual(left: string, right: string): boolean {
  const supplied = Buffer.from(left);
  const configured = Buffer.from(right);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}
