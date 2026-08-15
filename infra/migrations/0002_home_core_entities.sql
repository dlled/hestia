CREATE SCHEMA IF NOT EXISTS home_core;

CREATE TABLE IF NOT EXISTS home_core.entities (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  external_ref JSONB NOT NULL,
  observed_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS entities_home_id_idx ON home_core.entities (home_id);
CREATE UNIQUE INDEX IF NOT EXISTS entities_external_ref_idx
  ON home_core.entities
  (home_id, (external_ref->>'instanceId'), (external_ref->>'entityId'));

INSERT INTO ops.schema_migrations (id)
VALUES ('0002_home_core_entities')
ON CONFLICT (id) DO NOTHING;
