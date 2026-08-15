# ADR 0003 — Home Assistant is the first southbound layer

- Status: accepted
- Date: 2026-08-14

## Context

Owning every radio and vendor API is not the product. Intent, policy, workflows, and explanation are.

## Decision

Home Assistant is the first integration and the initial system of record for devices. HESTIA owns automations, policies, agents, and audit. MQTT, webhooks, MCP, and direct connectors come later when they earn their keep.

## Consequences

Phase 1 builds `packages/ha-client` and `apps/integration-hub`. Entity identity inside HESTIA is stable and independent of `entity_id` / IP / hostname.
