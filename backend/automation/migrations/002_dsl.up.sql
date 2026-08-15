CREATE TABLE automation_definition (
  automation_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  published_at TIMESTAMPTZ,
  PRIMARY KEY (automation_id, version)
);

CREATE UNIQUE INDEX automation_one_published_version_idx
  ON automation_definition (automation_id) WHERE status = 'published';
