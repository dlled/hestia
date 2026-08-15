CREATE TABLE twin_entity (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  device_id TEXT,
  area_id TEXT,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  capabilities JSONB NOT NULL,
  external_ref JSONB NOT NULL,
  observed_state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX twin_entity_home_name_idx ON twin_entity (home_id, name);
CREATE UNIQUE INDEX twin_entity_external_ref_idx
  ON twin_entity (home_id, (external_ref->>'instanceId'), (external_ref->>'entityId'));

CREATE TABLE twin_area (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  external_ref JSONB NOT NULL
);

CREATE INDEX twin_area_home_name_idx ON twin_area (home_id, name);

CREATE TABLE twin_device (
  id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  area_id TEXT,
  name TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  integration TEXT NOT NULL,
  external_ref JSONB NOT NULL
);

CREATE INDEX twin_device_home_name_idx ON twin_device (home_id, name);
