import { api } from "encore.dev/api";
import { identity } from "~encore/clients";
import type {
  AuthorizationDecisionView,
  AuthorizationRequestView,
  IdentityManifestView,
  SessionView,
} from "../shared/contracts";

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

export const beginGuestPasskeyRegistration = api(
  { expose: true, method: "POST", path: "/api/v1/identity/passkeys/guests/registration/options" },
  async (request: {
    sessionToken: string;
    displayName: string;
    homeId: string;
    areaId?: string;
    capability?: string;
    riskCeiling: "R0" | "R1" | "R2" | "R3" | "R4";
    expiresAt: string;
  }): Promise<{ principalId: string; challengeId: string; optionsJson: string }> =>
    identity.beginGuestRegistration(request),
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
  { expose: true, method: "POST", path: "/api/v1/identity/authorize" },
  async (request: AuthorizationRequestView): Promise<AuthorizationDecisionView> =>
    identity.authorize(request),
);

export const createRecoveryCodes = api(
  { expose: true, method: "POST", path: "/api/v1/identity/recovery/codes" },
  async ({ sessionToken }: { sessionToken: string }): Promise<{ recoveryCodes: string[] }> =>
    identity.createRecoveryCodes({ sessionToken }),
);

export const recoverOwner = api(
  { expose: true, method: "POST", path: "/api/v1/identity/recovery/verify" },
  async (request: { principalId: string; recoveryCode: string }): Promise<SessionView> =>
    identity.recoverOwner(request),
);
