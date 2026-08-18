# Phase 3B browser identity

This increment turns the Encore `identity` boundary into a usable local identity flow. The browser never receives a password or a persisted private key: WebAuthn credentials remain in the authenticator, bearer sessions live in tab-scoped `sessionStorage`, recovery codes are shown only after rotation, and guest invitation tokens travel in the URL fragment so nginx and Encore access logs do not receive them.

## Delivered vertical

- Offline first-owner bootstrap protected by the local `IDENTITY_BOOTSTRAP_CODE` secret.
- Discoverable WebAuthn passkey registration and authentication with required user verification.
- Additional passkey enrollment and one-time owner recovery codes.
- One-time, hashed guest invitations with an invitation lifetime capped at 24 hours.
- Expiring guest access constrained by home, optional area/device, capability, and maximum risk.
- Owner/Admin inventory for principals, sessions, passkeys, grants, and immutable identity audit events.
- Immediate revocation of a person and all of their sessions, passkeys, grants, and unused invitations.
- An Encore self-hosted web topology in which nginx serves React and proxies `/api`, `/health`, and `/ready` to the Encore image.

The administration API never returns session bearer tokens, invitation tokens, passkey public keys, recovery hashes, or stored token hashes. A raw invitation token is returned exactly once to its creator.

## Verification

Unit and service-integration tests exercise scoped authorization, owner protection, one-time invitation storage, cascade revocation, and audit evidence. React tests cover owner bootstrap and invited guest enrollment.

The Chrome black-box test uses two isolated browser contexts and two virtual CTAP2 authenticators against the self-hosted Encore/nginx stack. It proves:

1. first-owner passkey bootstrap;
2. recovery-code rotation;
3. discoverable passkey sign-in;
4. scoped guest invitation and passkey enrollment in a second browser context;
5. guest denial from the administration surface;
6. allowed R1 capability and denied R4 capability;
7. immediate session invalidation after owner revocation; and
8. one-time owner recovery.

Run it only against an isolated, disposable stack:

```bash
IDENTITY_BOOTSTRAP_CODE='<same test value injected into the stack>' \
HESTIA_WEB_URL=http://localhost:5173 \
pnpm encore:test:identity-browser
```

## Remaining identity product work

- service-account token creation, rotation, expiry, and revocation UX;
- time-window scope authoring and multi-home membership administration;
- preference, quiet-hours, privacy, and notification-channel screens;
- a second physical browser engine/authenticator acceptance pass;
- production enrollment and recovery guidance for hardware devices.
