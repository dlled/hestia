CREATE TABLE action_plan (
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (plan_id, version)
);

CREATE TABLE automation_run (
  workflow_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  finished_at TIMESTAMPTZ,
  last_state JSONB,
  FOREIGN KEY (plan_id, version) REFERENCES action_plan (plan_id, version)
);

CREATE INDEX automation_run_plan_idx ON automation_run (plan_id, version, started_at DESC);

CREATE TABLE automation_audit_event (
  sequence BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  workflow_id TEXT NOT NULL REFERENCES automation_run (workflow_id),
  run_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  details JSONB NOT NULL
);

CREATE INDEX automation_audit_workflow_idx
  ON automation_audit_event (workflow_id, sequence);
