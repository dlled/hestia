import { APIError, api } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { identity } from "~encore/clients";
import type {
  AuthorizationDecisionView,
  AuthorizationInputView,
  IdentityAdminSnapshotView,
  IdentityManifestView,
  IdentityProfileView,
  SessionView,
} from "../shared/contracts";
import { requireSessionToken } from "./session";

export const identityManifest = api(
  { expose: true, method: "GET", path: "/api/v1/identity/manifest" },
  async (): Promise<IdentityManifestView> => identity.manifest(),
);

export const beginOwnerPasskeyRegistration = api(
  { expose: true, method: "POST", path: "/api/v1/identity/passkeys/owner/registration/options" },
  async (request: {
    displayName: string;
    bootstrapCode: string;
  }): Promise<{
    principalId: string;
    challengeId: string;
    optionsJson: string;
  }> => identity.beginOwnerRegistration(request),
);

export const finishOwnerPasskeyRegistration = api(
  { expose: true, method: "POST", path: "/api/v1/identity/passkeys/owner/registration/verify" },
  async (request: {
    principalId: string;
    challengeId: string;
    responseJson: string;
  }): Promise<SessionView> => identity.finishOwnerRegistration(request),
);

export const beginAuthenticatedPasskeyRegistration = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/identity/passkeys/registration/options",
  },
  async (): Promise<{ principalId: string; challengeId: string; optionsJson: string }> =>
    identity.beginPasskeyRegistration({ sessionToken: requireSessionToken() }),
);

export const finishAuthenticatedPasskeyRegistration = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/identity/passkeys/registration/verify",
  },
  async (request: {
    challengeId: string;
    responseJson: string;
    label?: string;
  }): Promise<SessionView> => {
    const auth = getAuthData();
    if (!auth) throw APIError.unauthenticated("Authentication is required");
    return identity.finishPasskeyRegistration({
      ...request,
      principalId: auth.userID,
    });
  },
);

export const createGuestInvitation = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/identity/guests/invitations" },
  async (request: {
    displayName: string;
    homeId: string;
    areaId?: string;
    deviceId?: string;
    capability?: string;
    riskCeiling: "R0" | "R1" | "R2" | "R3" | "R4";
    expiresAt: string;
  }): Promise<{
    invitationId: string;
    principalId: string;
    inviteToken: string;
    inviteExpiresAt: string;
  }> => identity.createGuestInvitation({ ...request, sessionToken: requireSessionToken() }),
);

export const beginInvitedGuestPasskeyRegistration = api(
  {
    expose: true,
    method: "POST",
    path: "/api/v1/identity/guests/invitations/registration/options",
  },
  async ({
    inviteToken,
  }: {
    inviteToken: string;
  }): Promise<{ principalId: string; challengeId: string; optionsJson: string }> =>
    identity.beginInvitedGuestRegistration({ inviteToken }),
);

export const finishInvitedGuestPasskeyRegistration = api(
  {
    expose: true,
    method: "POST",
    path: "/api/v1/identity/guests/invitations/registration/verify",
  },
  async (request: {
    principalId: string;
    challengeId: string;
    responseJson: string;
    label?: string;
  }): Promise<SessionView> => identity.finishPasskeyRegistration(request),
);

export const beginPasskeyAuthentication = api(
  { expose: true, method: "POST", path: "/api/v1/identity/passkeys/authentication/options" },
  async (request: {
    principalId?: string;
  }): Promise<{ challengeId: string; optionsJson: string }> =>
    identity.beginAuthentication(request),
);

export const finishPasskeyAuthentication = api(
  { expose: true, method: "POST", path: "/api/v1/identity/passkeys/authentication/verify" },
  async (request: { challengeId: string; responseJson: string }): Promise<SessionView> =>
    identity.finishAuthentication(request),
);

export const authorize = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/identity/authorize" },
  async (request: AuthorizationInputView): Promise<AuthorizationDecisionView> =>
    identity.authorize({ ...request, sessionToken: requireSessionToken() }),
);

export const createRecoveryCodes = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/identity/recovery/codes" },
  async (): Promise<{ recoveryCodes: string[] }> =>
    identity.createRecoveryCodes({ sessionToken: requireSessionToken() }),
);

export const recoverOwner = api(
  { expose: true, method: "POST", path: "/api/v1/identity/recovery/verify" },
  async (request: { principalId: string; recoveryCode: string }): Promise<SessionView> =>
    identity.recoverOwner(request),
);

export const identityProfile = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/identity/me" },
  async (): Promise<IdentityProfileView> =>
    identity.profile({ sessionToken: requireSessionToken() }),
);

export const identityAdminSnapshot = api(
  { expose: true, auth: true, method: "GET", path: "/api/v1/identity/admin" },
  async (): Promise<IdentityAdminSnapshotView> =>
    identity.adminSnapshot({ sessionToken: requireSessionToken() }),
);

export const revokeIdentitySession = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/identity/admin/sessions/:sessionId/revoke",
  },
  async ({ sessionId }: { sessionId: string }): Promise<{ revoked: true }> =>
    identity.revokeSession({ sessionToken: requireSessionToken(), sessionId }),
);

export const revokeIdentityPasskey = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/identity/admin/passkeys/:credentialId/revoke",
  },
  async ({ credentialId }: { credentialId: string }): Promise<{ revoked: true }> =>
    identity.revokePasskey({ sessionToken: requireSessionToken(), credentialId }),
);

export const revokeIdentityGrant = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/identity/admin/grants/:grantId/revoke",
  },
  async ({ grantId }: { grantId: string }): Promise<{ revoked: true }> =>
    identity.revokeGrant({ sessionToken: requireSessionToken(), grantId }),
);

export const revokeIdentityPrincipal = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/api/v1/identity/admin/principals/:principalId/revoke",
  },
  async ({ principalId }: { principalId: string }): Promise<{ revoked: true }> =>
    identity.revokePrincipal({ sessionToken: requireSessionToken(), principalId }),
);

export const logout = api(
  { expose: true, auth: true, method: "POST", path: "/api/v1/identity/logout" },
  async (): Promise<{ revoked: true }> => {
    const auth = getAuthData();
    return identity.revokeSession({
      sessionToken: requireSessionToken(),
      sessionId: auth?.sessionId ?? "",
    });
  },
);
