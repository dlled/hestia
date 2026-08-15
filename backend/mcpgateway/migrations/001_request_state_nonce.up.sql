CREATE TABLE mcp_request_state_nonce (
  nonce TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX mcp_request_state_nonce_consumed_at_idx
  ON mcp_request_state_nonce (consumed_at);
