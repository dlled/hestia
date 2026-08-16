ALTER TABLE incident
  ADD COLUMN workflow_id TEXT,
  ADD COLUMN playbook_id TEXT,
  ADD COLUMN playbook_version INTEGER,
  ADD COLUMN source_event_id TEXT,
  ADD COLUMN required_ack BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN ttl_expires_at TIMESTAMPTZ,
  ADD COLUMN escalation_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD COLUMN resolved_by TEXT,
  ADD COLUMN resolution_note TEXT;

CREATE UNIQUE INDEX incident_workflow_idx ON incident (workflow_id) WHERE workflow_id IS NOT NULL;

DROP INDEX incident_active_dedupe_idx;
CREATE UNIQUE INDEX incident_active_dedupe_idx ON incident (home_id, dedupe_key)
  WHERE status IN ('open', 'acknowledged', 'mitigated', 'monitoring');

ALTER TABLE notification_delivery
  ADD COLUMN severity TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN dedupe_key TEXT,
  ADD COLUMN ttl_expires_at TIMESTAMPTZ,
  ADD COLUMN required_ack BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN escalation_step INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN failure_message TEXT;

CREATE UNIQUE INDEX notification_delivery_dedupe_idx
  ON notification_delivery (incident_id, channel, recipient, dedupe_key);

CREATE TABLE incident_playbook (
  playbook_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  trigger_device_class TEXT NOT NULL DEFAULT 'moisture',
  preauthorized BOOLEAN NOT NULL DEFAULT TRUE,
  mode TEXT NOT NULL DEFAULT 'active',
  acknowledgement_timeout_ms INTEGER NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ,
  PRIMARY KEY (playbook_id, version)
);

CREATE UNIQUE INDEX incident_playbook_published_leak_idx
  ON incident_playbook (home_id, trigger_device_class)
  WHERE status = 'published';
