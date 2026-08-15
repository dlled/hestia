CREATE TABLE integration_checkpoint (
  instance_id TEXT PRIMARY KEY,
  checkpoint JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
