CREATE TABLE principal (
  principal_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE webauthn_challenge (
  challenge_id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  principal_id TEXT REFERENCES principal (principal_id),
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE TABLE passkey_credential (
  credential_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal (principal_id),
  public_key_base64 TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports JSONB NOT NULL DEFAULT '[]'::jsonb,
  device_type TEXT NOT NULL,
  backed_up BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identity_session (
  session_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal (principal_id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scope_grant (
  grant_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal (principal_id),
  home_id TEXT NOT NULL,
  area_id TEXT,
  device_id TEXT,
  capability TEXT,
  risk_ceiling TEXT NOT NULL DEFAULT 'R2',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scope_grant_principal_idx ON scope_grant (principal_id, home_id);

CREATE TABLE identity_audit_event (
  sequence BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  principal_id TEXT,
  actor_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);
