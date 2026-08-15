# Phase 2 — Durable automation

## Objective

Turn a visible, typed action plan into policy-controlled physical effects that survive process loss and finish only after Home Assistant reports the expected observed state.

## Implemented vertical

- Versioned `ActionPlan`, `ProposedAction`, expected-observation, approval, execution, and run-state contracts.
- Cross-home, duplicate-action, duplicate-idempotency-key, and observation-target validation at the contract boundary.
- Temporal workflow with progress queries, approval and cancellation signals, a 24-hour approval timeout, and deterministic policy evaluation before every effect.
- Separate retry semantics for idempotent and at-most-once capabilities.
- Reverse-order compensation for completed actions when a later action fails or times out.
- A dedicated device-I/O Temporal task queue and worker; automation workers no longer execute Home Assistant activities.
- Typed capability-to-Home-Assistant service mapping. Raw HA service names are never accepted from a model or public API.
- Post-command polling and heartbeat-based verification against Home Assistant observed state.
- Versioned plan and run metadata persistence in the `automation_service` PostgreSQL schema.
- A sleep-plan generator that turns the current read model into a visible plan for lights, climate, covers, media, and the alarm while excluding stale or unavailable observations.
- An append-only PostgreSQL audit ledger for run start, state transitions, approvals, and cancellation requests. Active-run monitoring resumes after an automation-service restart.
- Internal automation API for publishing plans, starting direct or published runs, querying progress, approving, and cancelling.
- Public edge routes for the same operations; the frontend remains isolated from service and Home Assistant APIs.
- Resident-facing web controls for configuring and previewing the sleep routine, inspecting risk, approving R3 actions, cancelling, following progress, and reading its audit trail.
- Service-local `.env.example` additions for the automation gateway and device worker. The shared non-root Node image continues to package every backend service and worker.

## HTTP surface

Public endpoints are rooted at `/api/v1/automations` on `edge-api`:

- `POST /plans`
- `POST /plans/sleep/preview`
- `POST /plans/:planId/versions/:version/runs`
- `POST /runs`
- `GET /runs/:workflowId`
- `GET /runs/:workflowId/audit`
- `POST /runs/:workflowId/approval`
- `POST /runs/:workflowId/cancel`

## Verification

| Level | Evidence |
| --- | --- |
| Unit | Action-plan invariants, sleep-plan generation and exclusions, policy mapping, Home Assistant service mapping, and run monitoring |
| Integration | Automation HTTP persistence and audit boundaries, Edge forwarding/validation, React preview/approval flow, Temporal queries/signals, approval, and reverse compensation |
| Black box | Sleep preview → Edge → automation-service → selective R3 approval → Temporal → dedicated device worker → simulated HA REST/WS → observed twin, including device-worker loss and automation-service restart with audit restoration |

Run the black-box proof with:

```bash
pnpm test:blackbox:phase2
```

## Exit status

Phase 2 exit criteria are met for the MVP vertical. Capability mappings outside the sleep domains remain an ecosystem extension rather than a blocker for Phase 3.
