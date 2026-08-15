# Proof-of-concept development plan

## Delivery rule

Each phase closes only when its contracts compile, examples contain no secrets, containers pass health checks, and the relevant unit, integration, and black-box tests are green. Physical effects remain below deterministic policy and Temporal boundaries.

## Completed foundation

### Phase 0 — Runtime foundation

Monorepo, strict contracts, deterministic policy, Temporal/NATS/PostgreSQL/MinIO, shared non-root images, local and production Compose, health/readiness, and CI-oriented verification.

### Phase 1 — Connected home

Home Assistant REST/WebSocket ingestion, topology registries, JetStream lanes, materialized PostgreSQL state, stable identity/checkpoints, Edge query surface, and restart black-box coverage.

### Phase 2 — Durable control

Typed action plans, risk classes, approval/cancellation, idempotency, retry/compensation, device worker, observed-state verification, append-only audit ledger, UI execution, and worker-loss black-box coverage.

### Phase 3A — Agentic sleep vertical and boundary skeletons

Natural-language interpretation, strict model output, durable clarification, deterministic preview, isolated `model-gateway`, identity/notification worker skeletons, MCP 2026-07-28 ingress integrity, 18 environment examples, and a 20-service production topology.

## Remaining increments

### Phase 3B — Identity and incident notification vertical

1. Implement passkey-backed local sessions, resident/guest roles, home/area/device/action scopes, expiry, and recovery.
2. Produce typed incident events and preferences.
3. Deliver, deduplicate, acknowledge, escalate, and audit at least one local notification channel.
4. Prove unauthorized and expired principals cannot preview, approve, execute, or call MCP tools.

Exit proof: unit policy/auth tests, service integration tests, and a black-box incident flow with acknowledgement, restart, and denied guest escalation.

### Phase 4 — Automation DSL, simulation, and proactivity

1. Define a versioned automation DSL for triggers, conditions, typed actions, budgets, locks, and rollback.
2. Add draft/publish lifecycle and deterministic simulation/replay against recorded twin state.
3. Add energy telemetry and a non-effectful recommendation vertical before any proactive execution.
4. Require shadow-mode evidence and explicit policy promotion for new autonomy.

Exit proof: deterministic replay fixtures, property tests for DSL invariants, and a black-box energy recommendation that cannot cause an unapproved effect.

### Phase 5 — Ecosystem and developer surface

1. Add MQTT and signed webhook adapters.
2. Extend MCP with typed read tools and policy-mediated action submission using signed request state.
3. Publish OpenAPI, generated TypeScript SDK, plugin manifest/lifecycle, isolation rules, and compatibility tests.

Exit proof: adapter contract suite, MCP conformance/integrity suite, plugin sandbox tests, and end-to-end third-party client flow.

### Operational closure

1. Add OpenTelemetry collection, dashboards, SLO checks and privacy-safe support bundles.
2. Automate encrypted backup and perform a measured restore drill.
3. Add upgrade/rollback, network-loss, dependency-loss and disk-pressure exercises.
4. Resolve every remaining row in `requirements-coverage.md` and rerun the complete validation matrix.

## Current verification commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm test:blackbox:phase1
pnpm test:blackbox:phase2
pnpm test:blackbox:phase3
```
