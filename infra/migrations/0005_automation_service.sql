CREATE SCHEMA IF NOT EXISTS automation_service;

CREATE TABLE IF NOT EXISTS automation_service.plans (
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (plan_id, version)
);

CREATE TABLE IF NOT EXISTS automation_service.runs (
  workflow_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  finished_at TIMESTAMPTZ,
  last_state JSONB,
  FOREIGN KEY (plan_id, version)
    REFERENCES automation_service.plans (plan_id, version)
);

CREATE INDEX IF NOT EXISTS automation_runs_plan_idx
  ON automation_service.runs (plan_id, version, started_at DESC);

CREATE TABLE IF NOT EXISTS automation_service.audit_events (
  sequence BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  workflow_id TEXT NOT NULL REFERENCES automation_service.runs (workflow_id),
  run_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  actor TEXT NOT NULL,
  details JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS automation_audit_workflow_idx
  ON automation_service.audit_events (workflow_id, sequence);
