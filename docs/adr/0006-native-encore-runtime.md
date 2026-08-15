# ADR 0006: Native Encore.ts application runtime

- Status: accepted
- Date: 2026-08-15

## Context

HESTIA needs a self-hosted development path with less repeated HTTP, validation, database and observability plumbing, without weakening durable workflow and event semantics.

## Decision

Implement the application backend as native Encore.ts domain services under `backend/`. Use Encore APIs, generated service clients, secrets and one named PostgreSQL database per stateful domain.

Keep these systems external:

- Temporal for durable workflows, retries, signals and compensation.
- NATS JetStream for high-volume observations and replayable state events.
- MinIO for object storage until an Encore object-storage migration is evaluated.
- Home Assistant and MQTT for southbound integrations.
- OpenRouter through the isolated model gateway.

Temporal and connector workers remain separate processes because request serving and durable activity execution have different failure and scaling boundaries.

MCP remains an Encore raw endpoint implementing protocol revision `2026-07-28`, Host and Origin checks, scoped bearer credentials, and integrity-protected request state. Effectful tools require explicit multi-round-trip confirmation and are then submitted to the same policy-mediated Temporal path as other clients.

## Consequences

- Internal calls use compile-time checked Encore clients.
- Cross-domain SQL remains forbidden.
- Self-hosting uses one portable Encore image plus adjacent PostgreSQL, Temporal, NATS JetStream, MinIO, MQTT and worker containers.
- External database migrations are applied by an explicit one-shot Compose service before the Encore process starts.
