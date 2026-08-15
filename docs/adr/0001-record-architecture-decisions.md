# ADR 0001 — Record architecture decisions

- Status: accepted
- Date: 2026-08-14

## Context

HESTIA is a multi-service, safety-sensitive home system. Informal chat decisions will be lost and then re-litigated in code.

## Decision

Every change to service boundaries, security, data ownership, or protocol choice is recorded as an ADR in `docs/adr/`.

## Consequences

PRs that move a boundary must add or amend an ADR. The product docs in `docs/product/` stay the source for requirements; ADRs stay the source for *why we built it this way*.
