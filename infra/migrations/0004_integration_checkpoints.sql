CREATE SCHEMA IF NOT EXISTS integration_hub;

CREATE TABLE IF NOT EXISTS integration_hub.checkpoints (
  instance_id TEXT PRIMARY KEY,
  checkpoint JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO ops.schema_migrations (id)
VALUES ('0004_integration_checkpoints')
ON CONFLICT (id) DO NOTHING;
