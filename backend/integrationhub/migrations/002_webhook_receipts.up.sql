CREATE TABLE integration_webhook_receipt (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  failure_message TEXT
);

CREATE INDEX integration_webhook_receipt_received_at_idx
  ON integration_webhook_receipt (received_at);
