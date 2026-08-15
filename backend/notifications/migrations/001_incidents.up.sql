CREATE TABLE incident (
  incident_id TEXT PRIMARY KEY,
  home_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  escalated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX incident_active_dedupe_idx ON incident (home_id, dedupe_key)
  WHERE status IN ('open', 'escalated');

CREATE TABLE notification_delivery (
  delivery_id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incident (incident_id),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  delivered_at TIMESTAMPTZ,
  UNIQUE (incident_id, channel, recipient)
);

CREATE TABLE incident_audit_event (
  sequence BIGSERIAL PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incident (incident_id),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX incident_audit_idx ON incident_audit_event (incident_id, sequence);
