import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { useEffect, useMemo, useState } from "react";
import {
  clearIdentitySession,
  getJson,
  type IdentityAdminSnapshot,
  type IdentityProfile,
  type IdentitySession,
  postJson,
  readIdentitySession,
  storeIdentitySession,
} from "./lib/api";

type AuthMode = "signin" | "bootstrap" | "recovery";

export function IdentityCenter({
  onSessionChange,
}: {
  onSessionChange?: (session: IdentitySession | null) => void;
}): React.JSX.Element {
  const [session, setSession] = useState<IdentitySession | null>(() => readIdentitySession());
  const [profile, setProfile] = useState<IdentityProfile | null>(null);
  const [admin, setAdmin] = useState<IdentityAdminSnapshot | null>(null);
  const [mode, setMode] = useState<AuthMode>("signin");
  const [displayName, setDisplayName] = useState("Home owner");
  const [bootstrapCode, setBootstrapCode] = useState("");
  const [principalId, setPrincipalId] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [passkeyLabel, setPasskeyLabel] = useState("This device");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [inviteToken, setInviteToken] = useState(() => inviteTokenFromLocation());
  const [guestName, setGuestName] = useState("Weekend guest");
  const [guestArea, setGuestArea] = useState("");
  const [guestCapability, setGuestCapability] = useState("power.onOff");
  const [guestRisk, setGuestRisk] = useState<"R0" | "R1" | "R2" | "R3" | "R4">("R1");
  const [guestExpiry, setGuestExpiry] = useState(() => defaultGuestExpiry());
  const [invitationUrl, setInvitationUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canAdminister = profile?.role === "Owner" || profile?.role === "Admin";
  const webAuthnReady = useMemo(() => browserSupportsWebAuthn(), []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setAdmin(null);
      return;
    }
    void (async () => {
      try {
        const nextProfile = await getJson<IdentityProfile>("/api/v1/identity/me");
        setProfile(nextProfile);
        if (nextProfile.role === "Owner" || nextProfile.role === "Admin") {
          setAdmin(await getJson<IdentityAdminSnapshot>("/api/v1/identity/admin"));
        } else {
          setAdmin(null);
        }
      } catch (reason) {
        clearIdentitySession();
        setSession(null);
        onSessionChange?.(null);
        setError(message(reason, "The stored session is no longer valid"));
      }
    })();
  }, [session, onSessionChange]);

  async function refreshIdentity(currentSession = session): Promise<void> {
    if (!currentSession) return;
    try {
      const nextProfile = await getJson<IdentityProfile>("/api/v1/identity/me");
      setProfile(nextProfile);
      if (nextProfile.role === "Owner" || nextProfile.role === "Admin") {
        setAdmin(await getJson<IdentityAdminSnapshot>("/api/v1/identity/admin"));
      } else {
        setAdmin(null);
      }
    } catch (reason) {
      clearIdentitySession();
      setSession(null);
      onSessionChange?.(null);
      setError(message(reason, "The stored session is no longer valid"));
    }
  }

  function acceptSession(nextSession: IdentitySession): void {
    storeIdentitySession(nextSession);
    setSession(nextSession);
    setPrincipalId(nextSession.principalId);
    setError(null);
    setNotice(`Signed in as ${nextSession.role}`);
    onSessionChange?.(nextSession);
  }

  async function bootstrapOwner(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      requireWebAuthn(webAuthnReady);
      const pending = await postJson<RegistrationStart>(
        "/api/v1/identity/passkeys/owner/registration/options",
        { displayName, bootstrapCode },
      );
      const credential = await startRegistration({ optionsJSON: registrationOptions(pending) });
      acceptSession(
        await postJson<IdentitySession>("/api/v1/identity/passkeys/owner/registration/verify", {
          principalId: pending.principalId,
          challengeId: pending.challengeId,
          responseJson: JSON.stringify(credential),
        }),
      );
      setBootstrapCode("");
    });
  }

  async function signIn(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      requireWebAuthn(webAuthnReady);
      const pending = await postJson<AuthenticationStart>(
        "/api/v1/identity/passkeys/authentication/options",
        principalId.trim() ? { principalId: principalId.trim() } : {},
      );
      const credential = await startAuthentication({ optionsJSON: authenticationOptions(pending) });
      acceptSession(
        await postJson<IdentitySession>("/api/v1/identity/passkeys/authentication/verify", {
          challengeId: pending.challengeId,
          responseJson: JSON.stringify(credential),
        }),
      );
    });
  }

  async function recover(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      acceptSession(
        await postJson<IdentitySession>("/api/v1/identity/recovery/verify", {
          principalId: principalId.trim(),
          recoveryCode: recoveryCode.trim(),
        }),
      );
      setRecoveryCode("");
    });
  }

  async function enrollInvitedGuest(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      requireWebAuthn(webAuthnReady);
      const pending = await postJson<RegistrationStart>(
        "/api/v1/identity/guests/invitations/registration/options",
        { inviteToken: inviteToken.trim() },
      );
      const credential = await startRegistration({ optionsJSON: registrationOptions(pending) });
      acceptSession(
        await postJson<IdentitySession>("/api/v1/identity/guests/invitations/registration/verify", {
          principalId: pending.principalId,
          challengeId: pending.challengeId,
          responseJson: JSON.stringify(credential),
          label: "Guest passkey",
        }),
      );
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      setInviteToken("");
    });
  }

  async function addPasskey(): Promise<void> {
    await run(async () => {
      requireWebAuthn(webAuthnReady);
      const pending = await postJson<RegistrationStart>(
        "/api/v1/identity/passkeys/registration/options",
        {},
      );
      const credential = await startRegistration({ optionsJSON: registrationOptions(pending) });
      acceptSession(
        await postJson<IdentitySession>("/api/v1/identity/passkeys/registration/verify", {
          challengeId: pending.challengeId,
          responseJson: JSON.stringify(credential),
          label: passkeyLabel,
        }),
      );
      await refreshIdentity();
    });
  }

  async function generateRecoveryCodes(): Promise<void> {
    await run(async () => {
      const result = await postJson<{ recoveryCodes: string[] }>(
        "/api/v1/identity/recovery/codes",
        {},
      );
      setRecoveryCodes(result.recoveryCodes);
      setNotice("New recovery codes generated. Older codes no longer work.");
      await refreshIdentity();
    });
  }

  async function createInvitation(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    await run(async () => {
      const result = await postJson<{
        inviteToken: string;
        inviteExpiresAt: string;
      }>("/api/v1/identity/guests/invitations", {
        displayName: guestName,
        homeId: "home_primary",
        ...(guestArea.trim() ? { areaId: guestArea.trim() } : {}),
        ...(guestCapability.trim() ? { capability: guestCapability.trim() } : {}),
        riskCeiling: guestRisk,
        expiresAt: new Date(guestExpiry).toISOString(),
      });
      setInvitationUrl(
        `${location.origin}${location.pathname}${location.search}#invite=${encodeURIComponent(result.inviteToken)}`,
      );
      setNotice(
        `Invitation created; hand it to the guest before ${formatDate(result.inviteExpiresAt)}.`,
      );
      await refreshIdentity();
    });
  }

  async function revoke(kind: "sessions" | "passkeys" | "grants" | "principals", id: string) {
    await run(async () => {
      await postJson(`/api/v1/identity/admin/${kind}/${encodeURIComponent(id)}/revoke`, {});
      if (kind === "sessions" && id === session?.sessionId) {
        clearIdentitySession();
        setSession(null);
        onSessionChange?.(null);
        return;
      }
      await refreshIdentity();
    });
  }

  async function logout(): Promise<void> {
    await run(async () => {
      await postJson("/api/v1/identity/logout", {});
      clearIdentitySession();
      setSession(null);
      setProfile(null);
      setAdmin(null);
      setRecoveryCodes([]);
      onSessionChange?.(null);
    });
  }

  async function run(operation: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch (reason) {
      setError(message(reason, "Identity operation failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!session) {
    return (
      <section className="identity-card" aria-labelledby="identity-title">
        <div className="section-head identity-heading">
          <div>
            <p className="eyebrow">Local identity</p>
            <h2 id="identity-title">Passkey access</h2>
          </div>
          <span className={webAuthnReady ? "pill ok" : "pill warn"}>
            {webAuthnReady ? "WebAuthn ready" : "WebAuthn unavailable"}
          </span>
        </div>

        {inviteToken ? (
          <form className="identity-form" onSubmit={(event) => void enrollInvitedGuest(event)}>
            <h3>Accept guest invitation</h3>
            <p>Create a passkey on this device. The invitation token is never stored by HESTIA.</p>
            <label>
              Invitation token
              <input
                value={inviteToken}
                onChange={(event) => setInviteToken(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <button type="submit" disabled={busy || !webAuthnReady}>
              {busy ? "Creating guest passkey…" : "Create guest passkey"}
            </button>
          </form>
        ) : (
          <>
            <div className="identity-tabs" role="tablist" aria-label="Identity access modes">
              <button
                type="button"
                onClick={() => setMode("signin")}
                aria-pressed={mode === "signin"}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("bootstrap")}
                aria-pressed={mode === "bootstrap"}
              >
                First owner
              </button>
              <button
                type="button"
                onClick={() => setMode("recovery")}
                aria-pressed={mode === "recovery"}
              >
                Recover
              </button>
            </div>

            {mode === "signin" ? (
              <form className="identity-form" onSubmit={(event) => void signIn(event)}>
                <label>
                  Principal ID (optional)
                  <input
                    value={principalId}
                    onChange={(event) => setPrincipalId(event.target.value)}
                    autoComplete="username webauthn"
                    placeholder="Use passkey picker"
                  />
                </label>
                <button type="submit" disabled={busy || !webAuthnReady}>
                  {busy ? "Waiting for passkey…" : "Sign in with passkey"}
                </button>
              </form>
            ) : null}

            {mode === "bootstrap" ? (
              <form className="identity-form" onSubmit={(event) => void bootstrapOwner(event)}>
                <label>
                  Display name
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    required
                  />
                </label>
                <label>
                  Local bootstrap code
                  <input
                    type="password"
                    value={bootstrapCode}
                    onChange={(event) => setBootstrapCode(event.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </label>
                <button type="submit" disabled={busy || !webAuthnReady}>
                  {busy ? "Creating owner…" : "Create local owner"}
                </button>
              </form>
            ) : null}

            {mode === "recovery" ? (
              <form className="identity-form" onSubmit={(event) => void recover(event)}>
                <label>
                  Owner principal ID
                  <input
                    value={principalId}
                    onChange={(event) => setPrincipalId(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </label>
                <label>
                  One-time recovery code
                  <input
                    type="password"
                    value={recoveryCode}
                    onChange={(event) => setRecoveryCode(event.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </label>
                <button type="submit" disabled={busy}>
                  {busy ? "Recovering…" : "Recover local owner"}
                </button>
              </form>
            ) : null}
          </>
        )}
        <IdentityFeedback error={error} notice={notice} />
      </section>
    );
  }

  return (
    <section className="identity-card" aria-labelledby="identity-title">
      <div className="section-head identity-heading">
        <div>
          <p className="eyebrow">Authenticated locally</p>
          <h2 id="identity-title">{profile?.displayName ?? session.principalId}</h2>
          <p className="identity-meta">
            {profile?.role ?? session.role} · session expires {formatDate(session.expiresAt)}
          </p>
        </div>
        <button type="button" className="secondary" onClick={() => void logout()} disabled={busy}>
          Sign out
        </button>
      </div>

      <div className="identity-grid">
        <div className="identity-form">
          <h3>Passkeys and recovery</h3>
          <label>
            New passkey label
            <input value={passkeyLabel} onChange={(event) => setPasskeyLabel(event.target.value)} />
          </label>
          <button type="button" onClick={() => void addPasskey()} disabled={busy || !webAuthnReady}>
            Add passkey
          </button>
          {profile?.role === "Owner" ? (
            <button
              type="button"
              className="secondary"
              onClick={() => void generateRecoveryCodes()}
              disabled={busy}
            >
              Rotate recovery codes
            </button>
          ) : null}
          {recoveryCodes.length > 0 ? (
            <fieldset className="recovery-codes">
              <legend>Save once, offline</legend>
              {recoveryCodes.map((code) => (
                <code key={code}>{code}</code>
              ))}
            </fieldset>
          ) : null}
        </div>

        {canAdminister ? (
          <form className="identity-form" onSubmit={(event) => void createInvitation(event)}>
            <h3>Invite a scoped guest</h3>
            <label>
              Guest name
              <input
                value={guestName}
                onChange={(event) => setGuestName(event.target.value)}
                required
              />
            </label>
            <label>
              Area ID (optional)
              <input value={guestArea} onChange={(event) => setGuestArea(event.target.value)} />
            </label>
            <label>
              Capability
              <input
                value={guestCapability}
                onChange={(event) => setGuestCapability(event.target.value)}
                required
              />
            </label>
            <label>
              Risk ceiling
              <select
                value={guestRisk}
                onChange={(event) => setGuestRisk(event.target.value as typeof guestRisk)}
              >
                {(["R0", "R1", "R2", "R3", "R4"] as const).map((risk) => (
                  <option value={risk} key={risk}>
                    {risk}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Guest access expires
              <input
                type="datetime-local"
                value={guestExpiry}
                onChange={(event) => setGuestExpiry(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={busy}>
              Create one-time invitation
            </button>
            {invitationUrl ? (
              <label>
                Invitation URL (shown once)
                <input
                  value={invitationUrl}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
              </label>
            ) : null}
          </form>
        ) : null}
      </div>

      {admin ? (
        <AdminInventory
          snapshot={admin}
          currentPrincipalId={session.principalId}
          currentSessionId={session.sessionId}
          busy={busy}
          onRevoke={revoke}
        />
      ) : null}
      <IdentityFeedback error={error} notice={notice} />
    </section>
  );
}

function AdminInventory({
  snapshot,
  currentPrincipalId,
  currentSessionId,
  busy,
  onRevoke,
}: {
  snapshot: IdentityAdminSnapshot;
  currentPrincipalId: string;
  currentSessionId: string;
  busy: boolean;
  onRevoke: (kind: "sessions" | "passkeys" | "grants" | "principals", id: string) => Promise<void>;
}): React.JSX.Element {
  const names = new Map(
    snapshot.principals.map((principal) => [principal.principalId, principal.displayName]),
  );
  return (
    <section className="identity-admin" aria-label="Identity administration">
      <h3>Identity inventory</h3>
      <div className="identity-admin-grid">
        <div>
          <h4>People</h4>
          {snapshot.principals.map((principal) => (
            <IdentityRow
              key={principal.principalId}
              title={principal.displayName}
              detail={`${principal.role} · ${principal.status}${principal.expiresAt ? ` · until ${formatDate(principal.expiresAt)}` : ""}`}
              action={
                principal.principalId !== currentPrincipalId && principal.status !== "revoked" ? (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onRevoke("principals", principal.principalId)}
                  >
                    Revoke person
                  </button>
                ) : null
              }
            />
          ))}
        </div>
        <div>
          <h4>Active sessions</h4>
          {snapshot.sessions
            .filter((record) => !record.revokedAt && Date.parse(record.expiresAt) > Date.now())
            .map((record) => (
              <IdentityRow
                key={record.sessionId}
                title={names.get(record.principalId) ?? record.principalId}
                detail={`${record.sessionId === currentSessionId ? "Current · " : ""}expires ${formatDate(record.expiresAt)}`}
                action={
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onRevoke("sessions", record.sessionId)}
                  >
                    Revoke session
                  </button>
                }
              />
            ))}
        </div>
        <div>
          <h4>Passkeys</h4>
          {snapshot.passkeys
            .filter((credential) => !credential.revokedAt)
            .map((credential) => (
              <IdentityRow
                key={credential.credentialId}
                title={credential.label}
                detail={`${names.get(credential.principalId) ?? credential.principalId} · ${credential.deviceType}${credential.backedUp ? " · backed up" : ""}`}
                action={
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onRevoke("passkeys", credential.credentialId)}
                  >
                    Revoke passkey
                  </button>
                }
              />
            ))}
        </div>
        <div>
          <h4>Active grants</h4>
          {snapshot.grants
            .filter(
              (grant) =>
                !grant.revokedAt && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now()),
            )
            .map((grant) => (
              <IdentityRow
                key={grant.grantId}
                title={names.get(grant.principalId) ?? grant.principalId}
                detail={`${grant.homeId}${grant.areaId ? ` · ${grant.areaId}` : ""}${grant.capability ? ` · ${grant.capability}` : ""} · max ${grant.riskCeiling}`}
                action={
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void onRevoke("grants", grant.grantId)}
                  >
                    Revoke grant
                  </button>
                }
              />
            ))}
        </div>
      </div>
      <details>
        <summary>Latest identity audit ({snapshot.audit.length})</summary>
        <ol className="audit-list">
          {snapshot.audit.map((event) => (
            <li key={event.sequence}>
              <code>{event.eventType}</code> · {formatDate(event.occurredAt)}
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function IdentityRow({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="identity-row">
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
      {action}
    </div>
  );
}

function IdentityFeedback({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error ? <p className="identity-feedback error">{error}</p> : null}
      {notice ? <p className="identity-feedback notice">{notice}</p> : null}
    </>
  );
}

interface RegistrationStart {
  principalId: string;
  challengeId: string;
  optionsJson: string;
}

interface AuthenticationStart {
  challengeId: string;
  optionsJson: string;
}

function registrationOptions(
  pending: RegistrationStart,
): Parameters<typeof startRegistration>[0]["optionsJSON"] {
  return JSON.parse(pending.optionsJson) as Parameters<typeof startRegistration>[0]["optionsJSON"];
}

function authenticationOptions(
  pending: AuthenticationStart,
): Parameters<typeof startAuthentication>[0]["optionsJSON"] {
  return JSON.parse(pending.optionsJson) as Parameters<
    typeof startAuthentication
  >[0]["optionsJSON"];
}

function requireWebAuthn(supported: boolean): void {
  if (!supported) throw new Error("This browser does not support WebAuthn passkeys");
}

function inviteTokenFromLocation(): string {
  if (typeof location === "undefined") return "";
  const match = location.hash.match(/^#invite=(.+)$/u);
  return match ? decodeURIComponent(match[1] ?? "") : "";
}

function defaultGuestExpiry(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
