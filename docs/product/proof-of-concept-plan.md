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

## Completed Encore increments

### Phase 3B — Identity and incident notification vertical

The native Encore identity backend and SC-02 leak-incident vertical are implemented. Moisture events now cross JetStream, a real notification worker, a constrained versioned playbook and Temporal acknowledgement/escalation/closure before appearing in the Incident Center. Browser hardware-passkey UX, notification preferences and non-webhook channels remain product increments.

Current proof: unit policy/auth tests, service integration tests, Temporal timer/compensation tests and a self-hosted black-box incident trigger. Remaining exit proof: browser acknowledgement, restart while waiting and denied guest escalation.

### Phase 4 — Automation DSL, simulation, and proactivity

Implemented in native Encore services with deterministic invariant tests and an energy recommendation vertical.

Exit proof: deterministic replay fixtures, property tests for DSL invariants, and a black-box energy recommendation that cannot cause an unapproved effect.

### Phase 5 — Ecosystem and developer surface

Implemented with an external MQTT 5 worker, replay-protected signed webhook ingress, scoped MCP tools, generated artifacts under `sdk/`, and Plugin API 1.

Exit proof: adapter contract suite, MCP conformance/integrity suite, plugin sandbox tests, and end-to-end third-party client flow.

### Operational closure

1. Add OpenTelemetry collection, dashboards, SLO checks and privacy-safe support bundles.
2. Automate encrypted backup and perform a measured restore drill.
3. Add upgrade/rollback, network-loss, dependency-loss and disk-pressure exercises.
4. Resolve every remaining row in `requirements-coverage.md` and rerun the complete validation matrix.

## Remaining operational closure

The production UI identity flow, notification preferences and additional channels, observability pipeline, backup/restore drill, chaos schedule and full legacy-runtime deletion remain follow-up feature PRs. The Encore backend baseline no longer depends on legacy HTTP services; Temporal workers use the authenticated `workerbridge` for model, plan and incident activity calls.

## Current verification commands

```bash
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm encore:check
pnpm encore:test
pnpm encore:build:selfhost
pnpm encore:test:blackbox
pnpm test:blackbox:phase1
pnpm test:blackbox:phase2
pnpm test:blackbox:phase3
```
