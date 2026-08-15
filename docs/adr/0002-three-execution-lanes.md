# ADR 0002 — Three execution lanes

- Status: accepted
- Date: 2026-08-14

## Context

A home produces high-frequency telemetry and long-running human processes. One bus cannot do both well.

## Decision

- HTTP / SSE: human interaction, command acceptance, administration
- NATS JetStream: state events, commands, health, short replay
- Temporal: automations, incidents, agents, approvals, timers, compensation

Temporal never receives every sensor tick. NATS is never the saga engine.

## Consequences

Workers and services must be explicit about which lane they use. New features that wait, retry, or approve go on Temporal.
