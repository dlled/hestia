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
  IdentityAdminSnapshotView,
  IdentityManifestView,
  IdentityProfileView,
  IdentityRoleView,
  JsonScalarView,
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
  async (request: {
    principalId: string;
    challengeId: string;
    responseJson: string;
  }): Promise<SessionView> => completeRegistration(request),
);

export const beginPasskeyRegistration = api(
  { method: "POST", path: "/internal/identity/passkeys/registration/options" },
  async ({
    sessionToken,
  }: {
    sessionToken: string;
  }): Promise<{ principalId: string; challengeId: string; optionsJson: string }> => {
    const actor = await requirePrincipal(sessionToken);
    const credentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
    for await (const row of identityDB.query<{ credential_id: string; transports: unknown }>`
      SELECT credential_id, transports
      FROM passkey_credential
      WHERE principal_id = ${actor.principalId} AND revoked_at IS NULL
    `) {
      credentials.push({
        id: row.credential_id,
        transports: row.transports as AuthenticatorTransportFuture[],
      });
    }
    const config = webauthnConfig();
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: new TextEncoder().encode(actor.principalId),
      userName: actor.principalId,
      userDisplayName: actor.displayName,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      excludeCredentials: credentials,
    });
    const challengeId = id("chal");
    await saveChallenge(challengeId, "registration", actor.principalId, options.challenge);
    return { principalId: actor.principalId, challengeId, optionsJson: JSON.stringify(options) };
  },
);

export const finishPasskeyRegistration = api(
  { method: "POST", path: "/internal/identity/passkeys/registration/verify" },
  async (request: {
    principalId: string;
    challengeId: string;
    responseJson: string;
    label?: string;
  }): Promise<SessionView> => completeRegistration(request),
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

export const createGuestInvitation = api(
  { method: "POST", path: "/internal/identity/guests/invitations" },
  async (request: {
    sessionToken: string;
    displayName: string;
    homeId: string;
    areaId?: string;
    deviceId?: string;
    capability?: string;
    riskCeiling: RiskClassView;
    expiresAt: string;
  }): Promise<{
    invitationId: string;
    principalId: string;
    inviteToken: string;
    inviteExpiresAt: string;
  }> => {
    const actor = await requirePrincipal(request.sessionToken);
    requireAdministrator(actor);
    const expiresAt = new Date(request.expiresAt);
    if (
      !request.displayName.trim() ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt <= new Date()
    ) {
      throw APIError.invalidArgument("Guest name and future expiry are required");
    }
    const principalId = id("usr");
    const grantId = id("grant");
    const invitationId = id("invite");
    const inviteToken = randomBytes(32).toString("base64url");
    const inviteExpiresAt = new Date(
      Math.min(expiresAt.getTime(), Date.now() + 24 * 60 * 60 * 1_000),
    );
    const transaction = await identityDB.begin();
    try {
      await transaction.exec`
        INSERT INTO principal (principal_id, display_name, role, status, expires_at)
        VALUES (${principalId}, ${request.displayName.trim()}, 'Guest', 'pending', ${expiresAt})
      `;
      await transaction.exec`
        INSERT INTO scope_grant
          (grant_id, principal_id, home_id, area_id, device_id, capability, risk_ceiling, expires_at)
        VALUES (
          ${grantId}, ${principalId}, ${request.homeId}, ${request.areaId ?? null},
          ${request.deviceId ?? null}, ${request.capability ?? null}, ${request.riskCeiling}, ${expiresAt}
        )
      `;
      await transaction.exec`
        INSERT INTO identity_invitation
          (invitation_id, principal_id, token_hash, created_by, expires_at)
        VALUES (
          ${invitationId}, ${principalId}, ${hash(inviteToken)}, ${actor.principalId},
          ${inviteExpiresAt}
        )
      `;
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    await audit("guest.invited", principalId, actor.principalId, {
      homeId: request.homeId,
      grantId,
      invitationId,
      guestExpiresAt: expiresAt.toISOString(),
      inviteExpiresAt: inviteExpiresAt.toISOString(),
    });
    return {
      invitationId,
      principalId,
      inviteToken,
      inviteExpiresAt: inviteExpiresAt.toISOString(),
    };
  },
);

export const beginInvitedGuestRegistration = api(
  { method: "POST", path: "/internal/identity/guests/invitations/registration/options" },
  async ({
    inviteToken,
  }: {
    inviteToken: string;
  }): Promise<{ principalId: string; challengeId: string; optionsJson: string }> => {
    const invitation = await identityDB.queryRow<{
      principal_id: string;
      display_name: string;
    }>`
      SELECT i.principal_id, p.display_name
      FROM identity_invitation i JOIN principal p ON p.principal_id = i.principal_id
      WHERE i.token_hash = ${hash(inviteToken)} AND i.used_at IS NULL
        AND i.expires_at > now() AND p.status = 'pending'
        AND (p.expires_at IS NULL OR p.expires_at > now())
    `;
    if (!invitation) throw APIError.unauthenticated("Guest invitation is invalid or expired");
    const config = webauthnConfig();
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpID,
      userID: new TextEncoder().encode(invitation.principal_id),
      userName: invitation.principal_id,
      userDisplayName: invitation.display_name,
      attestationType: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = id("chal");
    const claimed = await identityDB.queryRow<{ principal_id: string }>`
      UPDATE identity_invitation i SET used_at = now()
      WHERE i.token_hash = ${hash(inviteToken)} AND i.used_at IS NULL
        AND i.expires_at > now() AND i.principal_id = ${invitation.principal_id}
        AND EXISTS (
          SELECT 1 FROM principal p
          WHERE p.principal_id = i.principal_id AND p.status = 'pending'
            AND (p.expires_at IS NULL OR p.expires_at > now())
        )
      RETURNING i.principal_id
    `;
    if (!claimed) throw APIError.unauthenticated("Guest invitation is invalid or expired");
    await saveChallenge(challengeId, "registration", invitation.principal_id, options.challenge);
    return {
      principalId: invitation.principal_id,
      challengeId,
      optionsJson: JSON.stringify(options),
    };
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
        SELECT c.credential_id, c.transports
        FROM passkey_credential c JOIN principal p ON p.principal_id = c.principal_id
        WHERE c.principal_id = ${principalId} AND c.revoked_at IS NULL
          AND p.status = 'active' AND (p.expires_at IS NULL OR p.expires_at > now())
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
      WHERE c.credential_id = ${response.id} AND c.revoked_at IS NULL
    `;
    if (credential?.status !== "active") throw APIError.unauthenticated("Unknown passkey");
    const claimed = await claimChallenge(challengeId, "authentication");
    if (claimed.principalId && claimed.principalId !== credential.principal_id) {
      throw APIError.unauthenticated("Passkey does not match the requested principal");
    }
    const config = webauthnConfig();
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: claimed.challenge,
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
      FROM scope_grant
      WHERE principal_id = ${principal.principalId} AND revoked_at IS NULL
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
    sessionId?: string;
  }> => {
    const principal = await principalForToken(sessionToken);
    return principal
      ? {
          authenticated: true,
          principalId: principal.principalId,
          role: principal.role,
          sessionId: principal.sessionId,
        }
      : { authenticated: false };
  },
);

export const profile = api(
  { method: "POST", path: "/internal/identity/profile" },
  async ({ sessionToken }: { sessionToken: string }): Promise<IdentityProfileView> => {
    const actor = await requirePrincipal(sessionToken);
    return {
      principalId: actor.principalId,
      displayName: actor.displayName,
      role: actor.role,
      status: actor.status,
      ...(actor.expiresAt ? { expiresAt: actor.expiresAt.toISOString() } : {}),
      sessionId: actor.sessionId,
      sessionExpiresAt: actor.sessionExpiresAt.toISOString(),
    };
  },
);

export const adminSnapshot = api(
  { method: "POST", path: "/internal/identity/admin/snapshot" },
  async ({ sessionToken }: { sessionToken: string }): Promise<IdentityAdminSnapshotView> => {
    const actor = await requirePrincipal(sessionToken);
    requireAdministrator(actor);

    const principals: IdentityAdminSnapshotView["principals"] = [];
    for await (const row of identityDB.query<{
      principal_id: string;
      display_name: string;
      role: IdentityRoleView;
      status: "pending" | "active" | "revoked";
      expires_at: Date | null;
      created_at: Date;
    }>`
      SELECT principal_id, display_name, role, status, expires_at, created_at
      FROM principal ORDER BY created_at, principal_id
    `) {
      principals.push({
        principalId: row.principal_id,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
        createdAt: row.created_at.toISOString(),
      });
    }

    const passkeys: IdentityAdminSnapshotView["passkeys"] = [];
    for await (const row of identityDB.query<{
      credential_id: string;
      principal_id: string;
      label: string;
      device_type: string;
      backed_up: boolean;
      transports: unknown;
      created_at: Date;
      revoked_at: Date | null;
    }>`
      SELECT credential_id, principal_id, label, device_type, backed_up, transports,
             created_at, revoked_at
      FROM passkey_credential ORDER BY created_at, credential_id
    `) {
      passkeys.push({
        credentialId: row.credential_id,
        principalId: row.principal_id,
        label: row.label,
        deviceType: row.device_type,
        backedUp: row.backed_up,
        transports: Array.isArray(row.transports) ? (row.transports as string[]) : [],
        createdAt: row.created_at.toISOString(),
        ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
      });
    }

    const sessions: IdentityAdminSnapshotView["sessions"] = [];
    for await (const row of identityDB.query<{
      session_id: string;
      principal_id: string;
      expires_at: Date;
      created_at: Date;
      revoked_at: Date | null;
    }>`
      SELECT session_id, principal_id, expires_at, created_at, revoked_at
      FROM identity_session ORDER BY created_at DESC, session_id
    `) {
      sessions.push({
        sessionId: row.session_id,
        principalId: row.principal_id,
        expiresAt: row.expires_at.toISOString(),
        createdAt: row.created_at.toISOString(),
        ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
      });
    }

    const grants: IdentityAdminSnapshotView["grants"] = [];
    for await (const row of identityDB.query<{
      grant_id: string;
      principal_id: string;
      home_id: string;
      area_id: string | null;
      device_id: string | null;
      capability: string | null;
      risk_ceiling: RiskClassView;
      expires_at: Date | null;
      created_at: Date;
      revoked_at: Date | null;
    }>`
      SELECT grant_id, principal_id, home_id, area_id, device_id, capability,
             risk_ceiling, expires_at, created_at, revoked_at
      FROM scope_grant ORDER BY created_at, grant_id
    `) {
      grants.push({
        grantId: row.grant_id,
        principalId: row.principal_id,
        homeId: row.home_id,
        ...(row.area_id ? { areaId: row.area_id } : {}),
        ...(row.device_id ? { deviceId: row.device_id } : {}),
        ...(row.capability ? { capability: row.capability } : {}),
        riskCeiling: row.risk_ceiling,
        ...(row.expires_at ? { expiresAt: row.expires_at.toISOString() } : {}),
        createdAt: row.created_at.toISOString(),
        ...(row.revoked_at ? { revokedAt: row.revoked_at.toISOString() } : {}),
      });
    }

    const auditEvents: IdentityAdminSnapshotView["audit"] = [];
    for await (const row of identityDB.query<{
      sequence: number;
      event_type: string;
      principal_id: string | null;
      actor_id: string | null;
      occurred_at: Date;
      details: unknown;
    }>`
      SELECT sequence, event_type, principal_id, actor_id, occurred_at, details
      FROM identity_audit_event ORDER BY sequence DESC LIMIT 100
    `) {
      auditEvents.push({
        sequence: Number(row.sequence),
        eventType: row.event_type,
        ...(row.principal_id ? { principalId: row.principal_id } : {}),
        ...(row.actor_id ? { actorId: row.actor_id } : {}),
        occurredAt: row.occurred_at.toISOString(),
        details: isJsonScalarRecord(row.details) ? row.details : {},
      });
    }

    return { principals, passkeys, sessions, grants, audit: auditEvents };
  },
);

export const revokeSession = api(
  { method: "POST", path: "/internal/identity/admin/sessions/revoke" },
  async ({
    sessionToken,
    sessionId,
  }: {
    sessionToken: string;
    sessionId: string;
  }): Promise<{ revoked: true }> => {
    const actor = await requirePrincipal(sessionToken);
    const target = await identityDB.queryRow<{ principal_id: string; role: IdentityRoleView }>`
      SELECT s.principal_id, p.role
      FROM identity_session s JOIN principal p ON p.principal_id = s.principal_id
      WHERE s.session_id = ${sessionId}
    `;
    if (!target) throw APIError.notFound("Session not found");
    requireSelfOrAdministrator(actor, target.principal_id, target.role);
    await identityDB.exec`
      UPDATE identity_session SET revoked_at = COALESCE(revoked_at, now())
      WHERE session_id = ${sessionId}
    `;
    await audit("session.revoked", target.principal_id, actor.principalId, { sessionId });
    return { revoked: true };
  },
);

export const revokePasskey = api(
  { method: "POST", path: "/internal/identity/admin/passkeys/revoke" },
  async ({
    sessionToken,
    credentialId,
  }: {
    sessionToken: string;
    credentialId: string;
  }): Promise<{ revoked: true }> => {
    const actor = await requirePrincipal(sessionToken);
    const target = await identityDB.queryRow<{ principal_id: string; role: IdentityRoleView }>`
      SELECT c.principal_id, p.role
      FROM passkey_credential c JOIN principal p ON p.principal_id = c.principal_id
      WHERE c.credential_id = ${credentialId}
    `;
    if (!target) throw APIError.notFound("Passkey not found");
    requireSelfOrAdministrator(actor, target.principal_id, target.role);
    await identityDB.exec`
      UPDATE passkey_credential SET revoked_at = COALESCE(revoked_at, now())
      WHERE credential_id = ${credentialId}
    `;
    await audit("passkey.revoked", target.principal_id, actor.principalId, { credentialId });
    return { revoked: true };
  },
);

export const revokeGrant = api(
  { method: "POST", path: "/internal/identity/admin/grants/revoke" },
  async ({
    sessionToken,
    grantId,
  }: {
    sessionToken: string;
    grantId: string;
  }): Promise<{ revoked: true }> => {
    const actor = await requirePrincipal(sessionToken);
    requireAdministrator(actor);
    const target = await identityDB.queryRow<{ principal_id: string; role: IdentityRoleView }>`
      SELECT g.principal_id, p.role
      FROM scope_grant g JOIN principal p ON p.principal_id = g.principal_id
      WHERE g.grant_id = ${grantId}
    `;
    if (!target) throw APIError.notFound("Grant not found");
    requireAdministratorCanManage(actor, target.role);
    await identityDB.exec`
      UPDATE scope_grant SET revoked_at = COALESCE(revoked_at, now())
      WHERE grant_id = ${grantId}
    `;
    await audit("grant.revoked", target.principal_id, actor.principalId, { grantId });
    return { revoked: true };
  },
);

export const revokePrincipal = api(
  { method: "POST", path: "/internal/identity/admin/principals/revoke" },
  async ({
    sessionToken,
    principalId,
  }: {
    sessionToken: string;
    principalId: string;
  }): Promise<{ revoked: true }> => {
    const actor = await requirePrincipal(sessionToken);
    requireAdministrator(actor);
    if (actor.principalId === principalId) {
      throw APIError.failedPrecondition("An administrator cannot revoke their own principal");
    }
    const target = await identityDB.queryRow<{ role: IdentityRoleView }>`
      SELECT role FROM principal WHERE principal_id = ${principalId}
    `;
    if (!target) throw APIError.notFound("Principal not found");
    requireAdministratorCanManage(actor, target.role);
    const transaction = await identityDB.begin();
    try {
      await transaction.exec`
        UPDATE principal SET status = 'revoked' WHERE principal_id = ${principalId}
      `;
      await transaction.exec`
        UPDATE identity_session SET revoked_at = COALESCE(revoked_at, now())
        WHERE principal_id = ${principalId}
      `;
      await transaction.exec`
        UPDATE passkey_credential SET revoked_at = COALESCE(revoked_at, now())
        WHERE principal_id = ${principalId}
      `;
      await transaction.exec`
        UPDATE scope_grant SET revoked_at = COALESCE(revoked_at, now())
        WHERE principal_id = ${principalId}
      `;
      await transaction.exec`
        UPDATE identity_invitation SET used_at = COALESCE(used_at, now())
        WHERE principal_id = ${principalId}
      `;
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    await audit("principal.revoked", principalId, actor.principalId, {});
    return { revoked: true };
  },
);

export const createRecoveryCodes = api(
  { method: "POST", path: "/internal/identity/recovery/codes" },
  async ({ sessionToken }: { sessionToken: string }): Promise<{ recoveryCodes: string[] }> => {
    const actor = await requirePrincipal(sessionToken);
    if (actor.role !== "Owner") throw APIError.permissionDenied("Owner session required");
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
      UPDATE recovery_code r SET used_at = now()
      FROM principal p
      WHERE r.principal_id = ${principalId} AND r.code_hash = ${hash(recoveryCode)}
        AND r.used_at IS NULL AND p.principal_id = r.principal_id AND p.status = 'active'
      RETURNING r.code_id, p.role
    `;
    if (row?.role !== "Owner") throw APIError.unauthenticated("Recovery code is invalid");
    await identityDB.exec`
      UPDATE identity_session SET revoked_at = now()
      WHERE principal_id = ${principalId} AND revoked_at IS NULL
    `;
    await audit("owner.recovered", principalId, principalId, {});
    return issueSession(principalId, "Owner");
  },
);

async function completeRegistration(request: {
  principalId: string;
  challengeId: string;
  responseJson: string;
  label?: string;
}): Promise<SessionView> {
  const claimed = await claimChallenge(request.challengeId, "registration", request.principalId);
  const response = parseJson<RegistrationResponseJSON>(request.responseJson);
  const principal = await identityDB.queryRow<{
    role: IdentityRoleView;
    status: "pending" | "active" | "revoked";
  }>`
    SELECT role, status FROM principal WHERE principal_id = ${request.principalId}
  `;
  if (!principal || principal.status === "revoked") {
    throw APIError.unauthenticated("Principal cannot register a passkey");
  }
  const config = webauthnConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: claimed.challenge,
    expectedOrigin: config.origin,
    expectedRPID: config.rpID,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw APIError.unauthenticated("Passkey registration could not be verified");
  }
  const info = verification.registrationInfo;
  const label = request.label?.trim().slice(0, 80) || "Passkey";
  await identityDB.exec`
    INSERT INTO passkey_credential
      (credential_id, principal_id, public_key_base64, counter, transports,
       device_type, backed_up, label)
    VALUES (
      ${info.credential.id}, ${request.principalId},
      ${Buffer.from(info.credential.publicKey).toString("base64")},
      ${info.credential.counter}, ${info.credential.transports ?? []},
      ${info.credentialDeviceType}, ${info.credentialBackedUp}, ${label}
    )
  `;
  await identityDB.exec`
    UPDATE principal SET status = 'active' WHERE principal_id = ${request.principalId}
  `;
  await audit(
    principal.role === "Owner" && principal.status === "pending"
      ? "owner.bootstrapped"
      : "passkey.registered",
    request.principalId,
    request.principalId,
    { credentialId: info.credential.id, label },
  );
  return issueSession(request.principalId, principal.role);
}

async function issueSession(principalId: string, role: IdentityRoleView): Promise<SessionView> {
  const sessionId = id("sess");
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1_000);
  await identityDB.exec`
    INSERT INTO identity_session (session_id, principal_id, token_hash, expires_at)
    VALUES (${sessionId}, ${principalId}, ${hash(sessionToken)}, ${expiresAt})
  `;
  return { sessionId, sessionToken, principalId, role, expiresAt: expiresAt.toISOString() };
}

interface AuthenticatedPrincipal {
  principalId: string;
  displayName: string;
  role: IdentityRoleView;
  status: "pending" | "active" | "revoked";
  expiresAt?: Date;
  sessionId: string;
  sessionExpiresAt: Date;
}

async function principalForToken(token: string): Promise<AuthenticatedPrincipal | undefined> {
  const row = await identityDB.queryRow<{
    principal_id: string;
    display_name: string;
    role: IdentityRoleView;
    status: "pending" | "active" | "revoked";
    principal_expires_at: Date | null;
    session_id: string;
    session_expires_at: Date;
  }>`
    SELECT p.principal_id, p.display_name, p.role, p.status,
           p.expires_at AS principal_expires_at,
           s.session_id, s.expires_at AS session_expires_at
    FROM identity_session s JOIN principal p ON p.principal_id = s.principal_id
    WHERE s.token_hash = ${hash(token)} AND s.revoked_at IS NULL
      AND s.expires_at > now() AND p.status = 'active'
      AND (p.expires_at IS NULL OR p.expires_at > now())
  `;
  return row
    ? {
        principalId: row.principal_id,
        displayName: row.display_name,
        role: row.role,
        status: row.status,
        ...(row.principal_expires_at ? { expiresAt: row.principal_expires_at } : {}),
        sessionId: row.session_id,
        sessionExpiresAt: row.session_expires_at,
      }
    : undefined;
}

async function requirePrincipal(token: string): Promise<AuthenticatedPrincipal> {
  const principal = await principalForToken(token);
  if (!principal) throw APIError.unauthenticated("Session is missing, expired, or revoked");
  return principal;
}

function requireAdministrator(actor: AuthenticatedPrincipal): void {
  if (!["Owner", "Admin"].includes(actor.role)) {
    throw APIError.permissionDenied("Owner or admin session required");
  }
}

function requireAdministratorCanManage(
  actor: AuthenticatedPrincipal,
  targetRole: IdentityRoleView,
): void {
  requireAdministrator(actor);
  if (actor.role === "Admin" && targetRole === "Owner") {
    throw APIError.permissionDenied("An admin cannot manage the owner");
  }
}

function requireSelfOrAdministrator(
  actor: AuthenticatedPrincipal,
  targetPrincipalId: string,
  targetRole: IdentityRoleView,
): void {
  if (actor.principalId === targetPrincipalId) return;
  requireAdministratorCanManage(actor, targetRole);
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

async function claimChallenge(
  challengeId: string,
  purpose: string,
  principalId?: string,
): Promise<{ challenge: string; principalId?: string }> {
  const row = await identityDB.queryRow<{ challenge: string; principal_id: string | null }>`
    UPDATE webauthn_challenge SET consumed_at = now()
    WHERE challenge_id = ${challengeId} AND purpose = ${purpose}
      AND consumed_at IS NULL AND expires_at > now()
      AND (${principalId ?? null}::text IS NULL OR principal_id = ${principalId ?? null})
    RETURNING challenge, principal_id
  `;
  if (!row) throw APIError.unauthenticated("WebAuthn challenge is invalid or expired");
  return {
    challenge: row.challenge,
    ...(row.principal_id ? { principalId: row.principal_id } : {}),
  };
}

async function audit(
  eventType: string,
  principalId: string,
  actorId: string,
  details: Record<string, JsonScalarView>,
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

function isJsonScalarRecord(value: unknown): value is Record<string, JsonScalarView> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean",
  );
}
