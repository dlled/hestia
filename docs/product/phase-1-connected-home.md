# Phase 1 — Connected home

## Objective

Connect Home Assistant as the first southbound system and materialize observed entity state in HESTIA without exposing raw device APIs to the model or frontend.

## Implemented vertical

- Home Assistant REST authentication and validated `/api/states` discovery.
- Home Assistant WebSocket authentication, `state_changed` subscription, reconnect, and clean shutdown.
- Optional Home Assistant area, device, and entity registry discovery over the authenticated WebSocket API.
- Stable HESTIA entity identity derived from home, integration instance, and external entity id.
- Stable area and device identities, including inherited device-area associations for entities.
- Versioned `home.entity.state.changed` events persisted in NATS JetStream with message-id deduplication.
- Versioned `home.topology.discovered` snapshots delivered through an independent durable consumer.
- Durable `home-core` consumer with explicit acknowledgement and delayed negative acknowledgement.
- PostgreSQL read model owned exclusively by the `home_core` schema.
- Stale observations cannot overwrite newer observed state.
- Per-domain freshness thresholds mark old observations stale at read time without changing their value.
- Discovery checkpoints persist integration health, lane availability, failure details, timestamps, and discovered counts in the integration-owned PostgreSQL schema.
- A read-only sleep context groups lights, climate, covers, media, and alarm state and degrades when relevant observations are stale or unavailable.
- `edge-api` is the only frontend gateway for discovery and entity reads.
- The web shell renders the live observed-state read model.

## Verification

| Level | Evidence |
| --- | --- |
| Unit | Home Assistant schemas, stable identity, capability mapping, freshness and stale-event ordering |
| Integration | REST/WebSocket state and registry fixtures, ingestion-to-event flow, topology read model, edge gateway |
| Black box | Simulated Home Assistant REST/WS → JetStream → PostgreSQL → edge API, including entity/topology persistence across a `home-core` restart |

Run the black-box proof with:

```bash
pnpm test:blackbox:phase1
```

## Remaining Phase 1 work

- Persist explicit stale transitions for audit/event consumers; reads already calculate freshness deterministically.
- Turn the sleep context into a typed plan only after command validation, policy, approval, and observed-state verification are implemented.
