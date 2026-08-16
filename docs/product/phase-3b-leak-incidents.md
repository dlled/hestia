# Phase 3B — Leak incident response

## Objective

Turn a canonical moisture observation into a durable, auditable incident without allowing an event consumer or model to bypass policy. The first SC-02 playbook is versioned, published, preauthorized and constrained to water isolation: close valves and optionally isolate power, with deterministic compensation.

## Implemented vertical

- Home Assistant `device_class=moisture` survives canonical mapping and reaches the JetStream entity lane.
- `workers-notifications` uses a durable consumer, loads the active playbook through the token-authenticated Encore worker bridge, and starts one stable Temporal workflow per home and sensor.
- `IncidentWorkflow` validates evidence, evaluates every command through deterministic policy, retries activities, compensates completed reversible actions after partial failure, sends the local inbox notification, records optional signed external-webhook delivery and waits on a durable acknowledgement timer.
- Missing acknowledgement changes channel and increments the escalation step. Acknowledgement enters monitoring; only an explicit owner resolution or false-positive signal closes the workflow.
- Encore `notifications` owns incident, delivery, timeline and immutable playbook-version persistence. Active incidents deduplicate on home and sensor.
- Owners can create and publish playbook versions. Test mode rejects every effectful command. Version 1 only permits valve closure or power isolation and their inverse compensation.
- The web `Incident Center` lists active and historical incidents, exposes the unified timeline and offers authenticated acknowledgement, resolution and false-positive actions.

## Deployment contract

The self-hosted Encore topology now runs `notifications-worker` beside the portable Encore image, Temporal and NATS. Its private application calls require `WORKER_SERVICE_TOKEN`. External delivery is optional; when `INCIDENT_EXTERNAL_WEBHOOK_URL` is set, `INCIDENT_EXTERNAL_WEBHOOK_SIGNING_KEY` must contain at least 32 characters and signs `timestamp.body` with HMAC-SHA256.

## Verification

| Level | Evidence |
| --- | --- |
| Unit | moisture-event routing, stable workflow IDs, safe playbook schema, valve mapping, policy preauthorization and webhook secret contract |
| Integration | incident persistence/deduplication, deliveries, lifecycle/timeline, worker bridge authentication and React Incident Center |
| Temporal | acknowledgement before timeout, timer-driven channel escalation, explicit closure and reverse compensation after partial failure |
| Black box | signed moisture webhook → JetStream → notification worker → Temporal → Encore incident/timeline in the self-hosted topology |

The black-box test deliberately uses the built-in observe-only playbook, so it never produces a physical Home Assistant effect:

```bash
pnpm encore:build:selfhost
pnpm encore:test:blackbox
```

## Remaining notification work

- Resident notification preferences, quiet hours and per-channel routing.
- Web Push and optional email/SMS adapters.
- Hardware-passkey browser black-box coverage for owner acknowledgement/resolution and denied guest escalation.
- Restart and dependency-loss exercises while an incident is awaiting acknowledgement.
