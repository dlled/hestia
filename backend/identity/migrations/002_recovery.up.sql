CREATE TABLE recovery_code (
  code_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES principal (principal_id),
  code_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
