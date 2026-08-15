ALTER TABLE home_core.entities ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE home_core.entities ADD COLUMN IF NOT EXISTS area_id TEXT;

CREATE TABLE IF NOT EXISTS home_core.areas (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_ref JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS areas_home_id_idx ON home_core.areas (home_id);

CREATE TABLE IF NOT EXISTS home_core.devices (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  area_id TEXT,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  integration TEXT NOT NULL,
  external_ref JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS devices_home_id_idx ON home_core.devices (home_id);

INSERT INTO ops.schema_migrations (id)
VALUES ('0003_home_core_topology')
ON CONFLICT (id) DO NOTHING;
