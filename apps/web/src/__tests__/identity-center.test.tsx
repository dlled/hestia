import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityCenter } from "../identity-center";

const webauthn = vi.hoisted(() => ({
  startRegistration: vi.fn(async () => ({ id: "credential_fixture", type: "public-key" })),
  startAuthentication: vi.fn(async () => ({ id: "credential_fixture", type: "public-key" })),
}));

vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startRegistration: webauthn.startRegistration,
  startAuthentication: webauthn.startAuthentication,
}));

describe("IdentityCenter", () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/");
    webauthn.startRegistration.mockClear();
    webauthn.startAuthentication.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("bootstraps the local owner with a browser passkey and authenticates API calls", async () => {
    const authorizationHeaders: Array<string | null> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/passkeys/owner/registration/options")) {
          return json({ principalId: "usr_owner", challengeId: "chal_owner", optionsJson: "{}" });
        }
        if (url.endsWith("/passkeys/owner/registration/verify")) {
          return json(ownerSession());
        }
        if (url.endsWith("/identity/me")) {
          authorizationHeaders.push(new Headers(init?.headers).get("authorization"));
          return json({
            principalId: "usr_owner",
            displayName: "Home owner",
            role: "Owner",
            status: "active",
            sessionId: "sess_owner",
            sessionExpiresAt: ownerSession().expiresAt,
          });
        }
        if (url.endsWith("/identity/admin")) return json(emptyAdmin());
        return json({ message: "not found" }, 404);
      }),
    );

    render(<IdentityCenter />);
    fireEvent.click(screen.getByRole("button", { name: "First owner" }));
    fireEvent.change(screen.getByLabelText("Local bootstrap code"), {
      target: { value: "bootstrap-fixture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create local owner" }));

    expect(await screen.findByRole("heading", { name: "Home owner" })).toBeInTheDocument();
    expect(webauthn.startRegistration).toHaveBeenCalledOnce();
    expect(authorizationHeaders).toContain("Bearer owner-session-token");
    expect(sessionStorage.getItem("hestia.identity.session.v1")).toContain("owner-session-token");
  });

  it("accepts a one-time guest invitation from the URL fragment", async () => {
    history.replaceState(null, "", "/#invite=guest-invite-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.endsWith("/guests/invitations/registration/options")) {
          return json({ principalId: "usr_guest", challengeId: "chal_guest", optionsJson: "{}" });
        }
        if (url.endsWith("/guests/invitations/registration/verify")) {
          return json({
            sessionId: "sess_guest",
            sessionToken: "guest-session-token",
            principalId: "usr_guest",
            role: "Guest",
            expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          });
        }
        if (url.endsWith("/identity/me")) {
          return json({
            principalId: "usr_guest",
            displayName: "Weekend guest",
            role: "Guest",
            status: "active",
            sessionId: "sess_guest",
            sessionExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
          });
        }
        return json({ message: "not found" }, 404);
      }),
    );

    render(<IdentityCenter />);
    expect(screen.getByRole("heading", { name: "Accept guest invitation" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create guest passkey" }));

    expect(await screen.findByRole("heading", { name: "Weekend guest" })).toBeInTheDocument();
    expect(webauthn.startRegistration).toHaveBeenCalledOnce();
    expect(location.hash).toBe("");
  });
});

function ownerSession() {
  return {
    sessionId: "sess_owner",
    sessionToken: "owner-session-token",
    principalId: "usr_owner",
    role: "Owner",
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  };
}

function emptyAdmin() {
  return { principals: [], passkeys: [], sessions: [], grants: [], audit: [] };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
