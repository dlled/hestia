import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  adminSnapshot,
  authorize,
  beginInvitedGuestRegistration,
  createGuestInvitation,
  profile,
  revokeGrant,
  revokePasskey,
  revokePrincipal,
  revokeSession,
  sessionIdentity,
} from "./api";
import { identityDB } from "./db";

describe("identity administration", () => {
  it("revokes guest grants, passkeys, sessions, and principals immediately with audit", async () => {
    const fixture = await seedIdentityFixture();

    await expect(profile({ sessionToken: fixture.ownerToken })).resolves.toMatchObject({
      principalId: fixture.ownerId,
      displayName: "Local owner",
      role: "Owner",
      sessionId: fixture.ownerSessionId,
    });
    await expect(
      authorize({
        sessionToken: fixture.guestToken,
        homeId: fixture.homeId,
        areaId: fixture.areaId,
        capability: "power.onOff",
        risk: "R1",
      }),
    ).resolves.toMatchObject({ allowed: true, role: "Guest" });

    const before = await adminSnapshot({ sessionToken: fixture.ownerToken });
    expect(before.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalId: fixture.ownerId, status: "active" }),
        expect.objectContaining({ principalId: fixture.guestId, status: "active" }),
      ]),
    );
    expect(before.passkeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ credentialId: fixture.guestCredentialId }),
      ]),
    );

    await revokeGrant({ sessionToken: fixture.ownerToken, grantId: fixture.grantId });
    await expect(
      authorize({
        sessionToken: fixture.guestToken,
        homeId: fixture.homeId,
        areaId: fixture.areaId,
        capability: "power.onOff",
        risk: "R1",
      }),
    ).resolves.toMatchObject({ allowed: false });

    await revokePasskey({
      sessionToken: fixture.ownerToken,
      credentialId: fixture.guestCredentialId,
    });
    await revokeSession({
      sessionToken: fixture.ownerToken,
      sessionId: fixture.guestSessionId,
    });
    await expect(sessionIdentity({ sessionToken: fixture.guestToken })).resolves.toEqual({
      authenticated: false,
    });
    await revokePrincipal({
      sessionToken: fixture.ownerToken,
      principalId: fixture.guestId,
    });

    const after = await adminSnapshot({ sessionToken: fixture.ownerToken });
    expect(after.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ principalId: fixture.guestId, status: "revoked" }),
      ]),
    );
    expect(after.passkeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          credentialId: fixture.guestCredentialId,
          revokedAt: expect.any(String),
        }),
      ]),
    );
    expect(after.grants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ grantId: fixture.grantId, revokedAt: expect.any(String) }),
      ]),
    );
    expect(after.audit.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "grant.revoked",
        "passkey.revoked",
        "session.revoked",
        "principal.revoked",
      ]),
    );
  });

  it("does not let an admin revoke the owner", async () => {
    const fixture = await seedIdentityFixture();
    const adminId = `usr_admin_${fixture.suffix}`;
    const adminSessionId = `sess_admin_${fixture.suffix}`;
    const adminToken = `admin-token-${fixture.suffix}`;
    await identityDB.exec`
      INSERT INTO principal (principal_id, display_name, role, status)
      VALUES (${adminId}, 'House admin', 'Admin', 'active')
    `;
    await identityDB.exec`
      INSERT INTO identity_session (session_id, principal_id, token_hash, expires_at)
      VALUES (${adminSessionId}, ${adminId}, ${hash(adminToken)}, ${futureDate()})
    `;

    await expect(
      revokePrincipal({ sessionToken: adminToken, principalId: fixture.ownerId }),
    ).rejects.toThrow("An admin cannot manage the owner");
  });

  it("issues a one-time guest invitation without persisting the raw token", async () => {
    const fixture = await seedIdentityFixture();
    const invitation = await createGuestInvitation({
      sessionToken: fixture.ownerToken,
      displayName: "Delivery guest",
      homeId: fixture.homeId,
      areaId: fixture.areaId,
      capability: "lock.lock",
      riskCeiling: "R2",
      expiresAt: futureDate().toISOString(),
    });

    expect(invitation.inviteToken).toHaveLength(43);
    await expect(
      beginInvitedGuestRegistration({ inviteToken: "invalid-invitation" }),
    ).rejects.toThrow("Guest invitation is invalid or expired");
    await expect(
      beginInvitedGuestRegistration({ inviteToken: invitation.inviteToken }),
    ).resolves.toMatchObject({ principalId: invitation.principalId });
    await expect(
      beginInvitedGuestRegistration({ inviteToken: invitation.inviteToken }),
    ).rejects.toThrow("Guest invitation is invalid or expired");

    const snapshot = await adminSnapshot({ sessionToken: fixture.ownerToken });
    expect(JSON.stringify(snapshot)).not.toContain(invitation.inviteToken);
    expect(snapshot.principals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principalId: invitation.principalId,
          role: "Guest",
          status: "pending",
        }),
      ]),
    );

    await revokePrincipal({
      sessionToken: fixture.ownerToken,
      principalId: invitation.principalId,
    });
    await expect(
      beginInvitedGuestRegistration({ inviteToken: invitation.inviteToken }),
    ).rejects.toThrow("Guest invitation is invalid or expired");
  });
});

async function seedIdentityFixture() {
  const suffix = randomUUID().replaceAll("-", "");
  const ownerId = `usr_owner_${suffix}`;
  const guestId = `usr_guest_${suffix}`;
  const ownerSessionId = `sess_owner_${suffix}`;
  const guestSessionId = `sess_guest_${suffix}`;
  const ownerToken = `owner-token-${suffix}`;
  const guestToken = `guest-token-${suffix}`;
  const homeId = `home_${suffix}`;
  const areaId = `area_${suffix}`;
  const grantId = `grant_${suffix}`;
  const guestCredentialId = `credential_${suffix}`;

  await identityDB.exec`
    INSERT INTO principal (principal_id, display_name, role, status)
    VALUES
      (${ownerId}, 'Local owner', 'Owner', 'active'),
      (${guestId}, 'Weekend guest', 'Guest', 'active')
  `;
  await identityDB.exec`
    INSERT INTO identity_session (session_id, principal_id, token_hash, expires_at)
    VALUES
      (${ownerSessionId}, ${ownerId}, ${hash(ownerToken)}, ${futureDate()}),
      (${guestSessionId}, ${guestId}, ${hash(guestToken)}, ${futureDate()})
  `;
  await identityDB.exec`
    INSERT INTO passkey_credential
      (credential_id, principal_id, public_key_base64, counter, transports,
       device_type, backed_up, label)
    VALUES (
      ${guestCredentialId}, ${guestId}, ${Buffer.from("fixture-key").toString("base64")},
      0, ${["internal"]}, 'singleDevice', false, 'Guest phone'
    )
  `;
  await identityDB.exec`
    INSERT INTO scope_grant
      (grant_id, principal_id, home_id, area_id, capability, risk_ceiling, expires_at)
    VALUES (
      ${grantId}, ${guestId}, ${homeId}, ${areaId}, 'power.onOff', 'R1', ${futureDate()}
    )
  `;

  return {
    suffix,
    ownerId,
    guestId,
    ownerSessionId,
    guestSessionId,
    ownerToken,
    guestToken,
    homeId,
    areaId,
    grantId,
    guestCredentialId,
  };
}

function futureDate(): Date {
  return new Date(Date.now() + 60 * 60 * 1_000);
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
