ALTER TABLE passkey_credential
  ADD COLUMN label TEXT NOT NULL DEFAULT 'Passkey',
  ADD COLUMN revoked_at TIMESTAMPTZ;

ALTER TABLE scope_grant
  ADD COLUMN revoked_at TIMESTAMPTZ;

CREATE INDEX identity_session_principal_active_idx
  ON identity_session (principal_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX passkey_credential_principal_active_idx
  ON passkey_credential (principal_id, created_at)
  WHERE revoked_at IS NULL;

CREATE INDEX scope_grant_principal_active_idx
  ON scope_grant (principal_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE identity_invitation (
  invitation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal (principal_id),
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES principal (principal_id),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX identity_invitation_active_idx
  ON identity_invitation (principal_id, expires_at)
  WHERE used_at IS NULL;
