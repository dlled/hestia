import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { APIError, api } from "encore.dev/api";
import type {
  AuthorizationDecisionView,
  AuthorizationRequestView,
  IdentityManifestView,
  IdentityRoleView,
  RiskClassView,
  SessionView,
} from "../shared/contracts";
import { evaluateAuthorization, type ScopeGrantView } from "./authorization";
import { identityDB } from "./db";
import { IdentityBootstrapCode } from "./secrets";

const roles: IdentityRoleView[] = ["Owner", "Admin", "Member", "Guest", "Service Account"];

function webauthnConfig() {
  return {
    rpName: process.env.WEBAUTHN_RP_NAME ?? "HESTIA",
    rpID: process.env.WEBAUTHN_RP_ID ?? "localhost",
    origin: process.env.WEBAUTHN_ORIGIN ?? "http://localhost:5173",
  };
}

export const manifest = api(
  { method: "GET", path: "/internal/identity/manifest" },
  async (): Promise<IdentityManifestView> => ({
    bootstrap: "local-owner",
    authentication: ["passkey", "local-recovery"],
    roles,
    scopeDimensions: ["home", "area", "device", "capability", "time", "risk"],
    serviceTokens: { expiring: true, leastPrivilege: true },
  }),
);

export const beginOwnerRegistration = api(
  { method: "POST", path: "/internal/identity/passkeys/owner/registration/options" },
  async ({
    displayName,
    bootstrapCode,
  }: {
    displayName: string;
    bootstrapCode: string;
  }): Promise<{
    principalId: string;
    challengeId: string;
    optionsJson: string;
  }> => {
    if (!displayName.trim() || !sameSecret(bootstrapCode, IdentityBootstrapCode())) {
      throw APIError.permissionDenied("Invalid owner bootstrap request");
    }
    const count = await identityDB.queryRow<{
      count: number;
    }>`SELECT count(*)::int AS count FROM principal`;
    if ((count?.count ?? 0) > 0)
      throw APIError.failedPrecondition("Local owner is already bootstrapped");
    const principalId = id("usr");
    await identityDB.exec`
      INSERT INTO principal (principal_id, display_name, role, status)
      VALUES (${principalId}, ${displayName.trim()}, 'Owner', 'pending')
    `;
    const config = webauthnConfig();
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: new TextEncoder().encode(principalId),
      userName: principalId,
      userDisplayName: displayName.trim(),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = id("chal");
    await saveChallenge(challengeId, "registration", principalId, options.challenge);
    return { principalId, challengeId, optionsJson: JSON.stringify(options) };
  },
);

export const finishOwnerRegistration = api(
  { method: "POST", path: "/internal/identity/passkeys/owner/registration/verify" },
  async ({
    principalId,
    challengeId,
    responseJson,
  }: {
    principalId: string;
    challengeId: string;
    responseJson: string;
  }): Promise<SessionView> => {
    const challenge = await requireChallenge(challengeId, "registration", principalId);
    const response = parseJson<RegistrationResponseJSON>(responseJson);
    const config = webauthnConfig();
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw APIError.unauthenticated("Passkey registration could not be verified");
    }
    const info = verification.registrationInfo;
    await identityDB.exec`
      INSERT INTO passkey_credential
        (credential_id, principal_id, public_key_base64, counter, transports, device_type, backed_up)
      VALUES (
        ${info.credential.id}, ${principalId},
        ${Buffer.from(info.credential.publicKey).toString("base64")},
        ${info.credential.counter}, ${info.credential.transports ?? []},
        ${info.credentialDeviceType}, ${info.credentialBackedUp}
      )
    `;
    await consumeChallenge(challengeId);
    const principal = await identityDB.queryRow<{ role: IdentityRoleView }>`
      SELECT role FROM principal WHERE principal_id = ${principalId}
    `;
    if (!principal) throw APIError.notFound("Principal not found");
    await identityDB.exec`UPDATE principal SET status = 'active' WHERE principal_id = ${principalId}`;
    await audit(
      principal.role === "Owner" ? "owner.bootstrapped" : "passkey.registered",
      principalId,
      principalId,
      { credentialId: info.credential.id },
    );
    return issueSession(principalId, principal.role);
  },
);

export const beginGuestRegistration = api(
  { method: "POST", path: "/internal/identity/passkeys/guests/registration/options" },
  async (request: {
    sessionToken: string;
    displayName: string;
    homeId: string;
    areaId?: string;
    capability?: string;
    riskCeiling: RiskClassView;
    expiresAt: string;
  }): Promise<{ principalId: string; challengeId: string; optionsJson: string }> => {
    const actor = await principalForToken(request.sessionToken);
    if (!actor || !["Owner", "Admin"].includes(actor.role)) {
      throw APIError.permissionDenied("Only an owner or admin can invite a guest");
    }
    const expiresAt = new Date(request.expiresAt);
    if (
      !request.displayName.trim() ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt <= new Date()
    ) {
      throw APIError.invalidArgument("Guest name and future expiry are required");
    }
    const principalId = id("usr");
    await identityDB.exec`
      INSERT INTO principal (principal_id, display_name, role, status, expires_at)
      VALUES (${principalId}, ${request.displayName.trim()}, 'Guest', 'pending', ${expiresAt})
    `;
    await identityDB.exec`
      INSERT INTO scope_grant
        (grant_id, principal_id, home_id, area_id, capability, risk_ceiling, expires_at)
      VALUES (
        ${id("grant")}, ${principalId}, ${request.homeId}, ${request.areaId ?? null},
        ${request.capability ?? null}, ${request.riskCeiling}, ${expiresAt}
      )
    `;
    const config = webauthnConfig();
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: new TextEncoder().encode(principalId),
      userName: principalId,
      userDisplayName: request.displayName.trim(),
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = id("chal");
    await saveChallenge(challengeId, "registration", principalId, options.challenge);
    await audit("guest.invited", principalId, actor.principalId, {
      homeId: request.homeId,
      expiresAt: request.expiresAt,
    });
    return { principalId, challengeId, optionsJson: JSON.stringify(options) };
  },
);

export const beginAuthentication = api(
  { method: "POST", path: "/internal/identity/passkeys/authentication/options" },
  async ({
    principalId,
  }: {
    principalId?: string;
  }): Promise<{ challengeId: string; optionsJson: string }> => {
    const config = webauthnConfig();
    const credentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
    if (principalId) {
      for await (const row of identityDB.query<{ credential_id: string; transports: unknown }>`
        SELECT credential_id, transports FROM passkey_credential WHERE principal_id = ${principalId}
      `)
        credentials.push({
          id: row.credential_id,
          transports: row.transports as AuthenticatorTransportFuture[],
        });
    }
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      userVerification: "required",
      ...(principalId ? { allowCredentials: credentials } : {}),
    });
    const challengeId = id("chal");
    await saveChallenge(challengeId, "authentication", principalId, options.challenge);
    return { challengeId, optionsJson: JSON.stringify(options) };
  },
);

export const finishAuthentication = api(
  { method: "POST", path: "/internal/identity/passkeys/authentication/verify" },
  async ({
    challengeId,
    responseJson,
  }: {
    challengeId: string;
    responseJson: string;
  }): Promise<SessionView> => {
    const challenge = await requireChallenge(challengeId, "authentication");
    const response = parseJson<AuthenticationResponseJSON>(responseJson);
    const credential = await identityDB.queryRow<{
      credential_id: string;
      principal_id: string;
      public_key_base64: string;
      counter: number;
      transports: unknown;
      role: IdentityRoleView;
      status: string;
    }>`
      SELECT c.credential_id, c.principal_id, c.public_key_base64, c.counter,
             c.transports, p.role, p.status
      FROM passkey_credential c JOIN principal p ON p.principal_id = c.principal_id
      WHERE c.credential_id = ${response.id}
    `;
    if (credential?.status !== "active") throw APIError.unauthenticated("Unknown passkey");
    const config = webauthnConfig();
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.credential_id,
        publicKey: Buffer.from(credential.public_key_base64, "base64"),
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransportFuture[],
      },
    });
    if (!verification.verified) throw APIError.unauthenticated("Passkey authentication failed");
    await identityDB.exec`
      UPDATE passkey_credential SET counter = ${verification.authenticationInfo.newCounter}
      WHERE credential_id = ${credential.credential_id}
    `;
    await consumeChallenge(challengeId);
    await audit("session.created", credential.principal_id, credential.principal_id, {});
    return issueSession(credential.principal_id, credential.role);
  },
);

export const authorize = api(
  { method: "POST", path: "/internal/identity/authorize" },
  async (request: AuthorizationRequestView): Promise<AuthorizationDecisionView> => {
    const principal = await principalForToken(request.sessionToken);
    if (!principal) return { allowed: false, reason: "Session is missing, expired, or revoked" };
    const grants: ScopeGrantView[] = [];
    for await (const row of identityDB.query<{
      home_id: string;
      area_id: string | null;
      device_id: string | null;
      capability: string | null;
      risk_ceiling: RiskClassView;
      expires_at: Date | null;
    }>`
      SELECT home_id, area_id, device_id, capability, risk_ceiling, expires_at
      FROM scope_grant WHERE principal_id = ${principal.principalId}
    `)
      grants.push({
        homeId: row.home_id,
        ...(row.area_id ? { areaId: row.area_id } : {}),
        ...(row.device_id ? { deviceId: row.device_id } : {}),
        ...(row.capability ? { capability: row.capability } : {}),
        riskCeiling: row.risk_ceiling,
        ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
      });
    return evaluateAuthorization({
      principalId: principal.principalId,
      role: principal.role,
      request,
      grants,
    });
  },
);

export const sessionIdentity = api(
  { method: "POST", path: "/internal/identity/session" },
  async ({
    sessionToken,
  }: {
    sessionToken: string;
  }): Promise<{
    authenticated: boolean;
    principalId?: string;
    role?: IdentityRoleView;
  }> => {
    const principal = await principalForToken(sessionToken);
    return principal
      ? { authenticated: true, principalId: principal.principalId, role: principal.role }
      : { authenticated: false };
  },
);

export const createRecoveryCodes = api(
  { method: "POST", path: "/internal/identity/recovery/codes" },
  async ({ sessionToken }: { sessionToken: string }): Promise<{ recoveryCodes: string[] }> => {
    const actor = await principalForToken(sessionToken);
    if (actor?.role !== "Owner") throw APIError.permissionDenied("Owner session required");
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(12).toString("base64url"));
    const transaction = await identityDB.begin();
    try {
      await transaction.exec`DELETE FROM recovery_code WHERE principal_id = ${actor.principalId}`;
      for (const code of recoveryCodes) {
        await transaction.exec`
          INSERT INTO recovery_code (code_id, principal_id, code_hash)
          VALUES (${id("recovery")}, ${actor.principalId}, ${hash(code)})
        `;
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    await audit("recovery.codes.rotated", actor.principalId, actor.principalId, { count: 8 });
    return { recoveryCodes };
  },
);

export const recoverOwner = api(
  { method: "POST", path: "/internal/identity/recovery/verify" },
  async ({
    principalId,
    recoveryCode,
  }: {
    principalId: string;
    recoveryCode: string;
  }): Promise<SessionView> => {
    const row = await identityDB.queryRow<{ code_id: string; role: IdentityRoleView }>`
      SELECT r.code_id, p.role
      FROM recovery_code r JOIN principal p ON p.principal_id = r.principal_id
      WHERE r.principal_id = ${principalId} AND r.code_hash = ${hash(recoveryCode)}
        AND r.used_at IS NULL AND p.status = 'active'
    `;
    if (row?.role !== "Owner") throw APIError.unauthenticated("Recovery code is invalid");
    await identityDB.exec`UPDATE recovery_code SET used_at = now() WHERE code_id = ${row.code_id}`;
    await identityDB.exec`
      UPDATE identity_session SET revoked_at = now()
      WHERE principal_id = ${principalId} AND revoked_at IS NULL
    `;
    await audit("owner.recovered", principalId, principalId, {});
    return issueSession(principalId, "Owner");
  },
);

async function issueSession(principalId: string, role: IdentityRoleView): Promise<SessionView> {
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1_000);
  await identityDB.exec`
    INSERT INTO identity_session (session_id, principal_id, token_hash, expires_at)
    VALUES (${id("sess")}, ${principalId}, ${hash(sessionToken)}, ${expiresAt})
  `;
  return { sessionToken, principalId, role, expiresAt: expiresAt.toISOString() };
}

async function principalForToken(
  token: string,
): Promise<{ principalId: string; role: IdentityRoleView } | undefined> {
  const row = await identityDB.queryRow<{ principal_id: string; role: IdentityRoleView }>`
    SELECT p.principal_id, p.role
    FROM identity_session s JOIN principal p ON p.principal_id = s.principal_id
    WHERE s.token_hash = ${hash(token)} AND s.revoked_at IS NULL
      AND s.expires_at > now() AND p.status = 'active'
      AND (p.expires_at IS NULL OR p.expires_at > now())
  `;
  return row ? { principalId: row.principal_id, role: row.role } : undefined;
}

async function saveChallenge(
  challengeId: string,
  purpose: string,
  principalId: string | undefined,
  challenge: string,
): Promise<void> {
  await identityDB.exec`
    INSERT INTO webauthn_challenge (challenge_id, purpose, principal_id, challenge, expires_at)
    VALUES (${challengeId}, ${purpose}, ${principalId ?? null}, ${challenge}, ${new Date(Date.now() + 5 * 60 * 1_000)})
  `;
}

async function requireChallenge(
  challengeId: string,
  purpose: string,
  principalId?: string,
): Promise<string> {
  const row = await identityDB.queryRow<{ challenge: string }>`
    SELECT challenge FROM webauthn_challenge
    WHERE challenge_id = ${challengeId} AND purpose = ${purpose}
      AND consumed_at IS NULL AND expires_at > now()
      AND (${principalId ?? null}::text IS NULL OR principal_id = ${principalId ?? null})
  `;
  if (!row) throw APIError.unauthenticated("WebAuthn challenge is invalid or expired");
  return row.challenge;
}

async function consumeChallenge(challengeId: string): Promise<void> {
  await identityDB.exec`UPDATE webauthn_challenge SET consumed_at = now() WHERE challenge_id = ${challengeId}`;
}

async function audit(
  eventType: string,
  principalId: string,
  actorId: string,
  details: Record<string, unknown>,
) {
  await identityDB.exec`
    INSERT INTO identity_audit_event (event_type, principal_id, actor_id, details)
    VALUES (${eventType}, ${principalId}, ${actorId}, ${details})
  `;
}

function parseJson<T>(input: string): T {
  try {
    return JSON.parse(input) as T;
  } catch (error) {
    throw APIError.invalidArgument("WebAuthn response JSON is invalid", error as Error);
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function id(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
