# ADR 0004 — Models produce typed plans, never device calls

- Status: accepted
- Date: 2026-08-14

## Context

An LLM with a raw `call_service` tool will eventually do something irreversible.

## Decision

A model may only emit a schema-validated `ActionPlan` / `ProposedAction`. The policy broker is deterministic and sits in front of every physical effect. Temporal activities perform I/O. Observed state, not HTTP 200, completes a command.

## Consequences

There is no generic shell, SQL, or Home Assistant tool on the model allow-list. Eval fixtures must include prompt-injection cases that attempt to escalate.
