# ADR 0005 — Isolate provider credentials and MCP ingress

- Status: accepted
- Date: 2026-08-15

## Context

The source architecture requires provider credentials to remain outside orchestration workers and external tool access to cross a policy-controlled boundary. MCP 2026-07-28 also replaces connection-scoped initialization with self-describing requests and defines signed request state for multi-request flows.

## Decision

`model-gateway` is the only deployable allowed to receive OpenRouter credentials. `ai-orchestrator` calls its strict internal structured-completion endpoint using a separate internal token.

`mcp-gateway` is a distinct, stateless ingress using MCP 2026-07-28. It rejects legacy negotiation, validates protocol/method/name headers against the JSON-RPC body, authenticates bearer tokens, restricts Host and Origin, and verifies expiring HMAC-SHA256 request state bound to method and principal. MCP tools remain read-only or submit typed requests to deterministic policy boundaries; they never receive raw device, shell, SQL, or provider access.

## Consequences

Provider compromise is confined to one service. MCP transport integrity and authorization are testable independently. Future state-bearing MCP interactions must use the configured request-state codec and add originating parameter bindings when those parameters influence authorization.
