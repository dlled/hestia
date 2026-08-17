import { type BrowserContext, type CDPSession, expect, type Page, test } from "@playwright/test";

const sessionStorageKey = "hestia.identity.session.v1";

test("owner and guest complete passkey, recovery, scope, and revocation flows", async ({
  browser,
  baseURL,
}) => {
  const bootstrapCode = process.env.IDENTITY_BOOTSTRAP_CODE;
  if (!bootstrapCode)
    throw new Error("IDENTITY_BOOTSTRAP_CODE is required for the identity black-box");
  if (!baseURL) throw new Error("Playwright baseURL is required");

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const ownerAuthenticator = await installVirtualAuthenticator(ownerContext, ownerPage);
  let guestContext: BrowserContext | undefined;
  let guestAuthenticator: VirtualAuthenticator | undefined;

  try {
    await ownerPage.goto(baseURL);
    await ownerPage.getByRole("button", { name: "First owner" }).click();
    await ownerPage.getByLabel("Display name").fill("Black-box owner");
    await ownerPage.getByLabel("Local bootstrap code").fill(bootstrapCode);
    await ownerPage.getByRole("button", { name: "Create local owner" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Black-box owner" })).toBeVisible();

    const ownerSession = await storedSession(ownerPage);
    expect(ownerSession.role).toBe("Owner");

    await ownerPage.getByRole("button", { name: "Rotate recovery codes" }).click();
    const recoveryCodeItems = ownerPage.locator(".recovery-codes code");
    await expect(recoveryCodeItems).toHaveCount(8);
    const recoveryCodes = await recoveryCodeItems.allTextContents();

    await ownerPage.getByRole("button", { name: "Sign out" }).click();
    await ownerPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await ownerPage.getByRole("button", { name: "Sign in with passkey" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Black-box owner" })).toBeVisible();

    await ownerPage.getByLabel("Guest name").fill("Weekend guest");
    await ownerPage.getByLabel("Capability").fill("power.onOff");
    await ownerPage.getByLabel("Risk ceiling").selectOption("R1");
    await ownerPage.getByRole("button", { name: "Create one-time invitation" }).click();
    const invitationUrl = await ownerPage.getByLabel("Invitation URL (shown once)").inputValue();
    expect(invitationUrl).toContain("#invite=");

    guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    guestAuthenticator = await installVirtualAuthenticator(guestContext, guestPage);
    await guestPage.goto(invitationUrl);
    await guestPage.getByRole("button", { name: "Create guest passkey" }).click();
    await expect(guestPage.getByRole("heading", { name: "Weekend guest" })).toBeVisible();

    const guestSession = await storedSession(guestPage);
    expect(guestSession.role).toBe("Guest");
    expect(
      await authenticatedStatus(guestPage, "/api/v1/identity/admin", guestSession.sessionToken),
    ).toBe(403);
    expect(
      await authorize(guestPage, guestSession.sessionToken, {
        homeId: "home_primary",
        capability: "power.onOff",
        risk: "R1",
      }),
    ).toMatchObject({ allowed: true, role: "Guest" });
    expect(
      await authorize(guestPage, guestSession.sessionToken, {
        homeId: "home_primary",
        capability: "security.disarm",
        risk: "R4",
      }),
    ).toMatchObject({ allowed: false, role: "Guest" });

    await ownerPage.reload();
    await expect(ownerPage.getByRole("heading", { name: "Black-box owner" })).toBeVisible();
    const guestPersonRow = ownerPage
      .getByRole("heading", { name: "People" })
      .locator("..")
      .locator(".identity-row")
      .filter({ hasText: "Weekend guest" });
    await guestPersonRow.getByRole("button", { name: "Revoke person" }).click();
    await expect(guestPersonRow).toContainText("revoked");
    expect(
      await authenticatedStatus(guestPage, "/api/v1/identity/me", guestSession.sessionToken),
    ).toBe(401);

    const ownerPrincipalId = (await storedSession(ownerPage)).principalId;
    await ownerPage.getByRole("button", { name: "Sign out" }).click();
    await ownerPage.getByRole("button", { name: "Recover" }).click();
    await ownerPage.getByLabel("Owner principal ID").fill(ownerPrincipalId);
    await ownerPage.getByLabel("One-time recovery code").fill(recoveryCodes[0] ?? "");
    await ownerPage.getByRole("button", { name: "Recover local owner" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Black-box owner" })).toBeVisible();
  } finally {
    if (guestAuthenticator) await guestAuthenticator.remove().catch(() => undefined);
    await guestContext?.close();
    await ownerAuthenticator.remove().catch(() => undefined);
    await ownerContext.close();
  }
});

interface StoredSession {
  sessionToken: string;
  principalId: string;
  role: string;
}

interface VirtualAuthenticator {
  remove(): Promise<void>;
}

async function installVirtualAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<VirtualAuthenticator> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      ctap2Version: "ctap2_1",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return {
    async remove() {
      await removeVirtualAuthenticator(cdp, authenticatorId);
    },
  };
}

async function removeVirtualAuthenticator(cdp: CDPSession, authenticatorId: string): Promise<void> {
  await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  await cdp.send("WebAuthn.disable");
}

async function storedSession(page: Page): Promise<StoredSession> {
  return page.evaluate((key) => {
    const value = sessionStorage.getItem(key);
    if (!value) throw new Error("HESTIA identity session is missing");
    return JSON.parse(value) as StoredSession;
  }, sessionStorageKey);
}

async function authenticatedStatus(
  page: Page,
  path: string,
  sessionToken: string,
): Promise<number> {
  return page.evaluate(
    async ({ path, sessionToken }) => {
      const response = await fetch(path, {
        headers: { authorization: `Bearer ${sessionToken}` },
      });
      return response.status;
    },
    { path, sessionToken },
  );
}

async function authorize(
  page: Page,
  sessionToken: string,
  request: { homeId: string; capability: string; risk: string },
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ sessionToken, request }) => {
      const response = await fetch("/api/v1/identity/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`authorize failed (${response.status})`);
      return (await response.json()) as Record<string, unknown>;
    },
    { sessionToken, request },
  );
}
