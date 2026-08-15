# HESTIA agent notes

## Encore migration baseline

The repository root is the native Encore.ts application. New backend services live under `backend/` and use Encore `Service`, `api`, `SQLDatabase`, `secret`, and generated `~encore/clients` primitives. The existing `apps/` backend processes remain migration references until their corresponding Encore vertical is verified, then they may be removed in the final baseline cleanup. The React application remains under `apps/web`.

Temporal, NATS JetStream, MinIO, Home Assistant, and external model providers remain explicit external integrations. Temporal workers stay under `workers/` as separately runnable processes. Do not replace Temporal or JetStream with Encore primitives unless a new ADR proves equivalent durable and replay semantics.

Encore service rules:

- The browser calls only `backend/edge`; service APIs are private by default and use `~encore/clients`.
- Each stateful domain owns one named Encore PostgreSQL database. Temporal databases remain exclusive to Temporal.
- Reuse strict contracts and deterministic domain logic from `packages/`; do not duplicate them inside services.
- External/process inputs are validated with Zod even when Encore validates the HTTP transport.
- MCP remains a raw endpoint implementing `2026-07-28`, bearer authentication, Host/Origin checks and signed request-state integrity.
- Never place `.secrets.local.cue`, `.env`, credentials, prompts, or raw model output in portable images or commits.
- Preserve `apps/` behavior until the equivalent Encore unit, integration and black-box tests pass.

## Product

HESTIA is a self-hosted, AI-native home OS. Home Assistant is the southbound device layer. Temporal is the durable execution layer. OpenRouter is reached only through the model gateway. The frontend talks only to `edge-api`.

Read `docs/product/` and `docs/adr/` before changing service boundaries.

## Commands

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm dev
pnpm encore:check
pnpm encore:test
pnpm encore:build:selfhost
```

Do not claim a change is done unless the relevant command is green.

## Frozen rules

- TypeScript strict. Zod at every process boundary.
- No service reads another service's SQL schema.
- High-volume telemetry stays on NATS. Temporal is for business processes, not sensor ticks.
- Workflows are deterministic. Network, clocks, randomness, devices, and models live in Activities.
- Risk comes from the capability registry + policy, never from the model.
- R3 requires approval or a preauthorized playbook. R4 is playbook-only.
- Prompts and raw model output are not logged by default. Store hashes and metadata.
- `packages/model-client` is the only package allowed to hold OpenRouter credentials.
- `packages/ha-client` is the only package allowed to talk to Home Assistant.
- New autonomous features start in shadow mode.

## Out of scope until asked

- Native mobile apps, public SaaS multi-tenant, cloud video, replacing Home Assistant drivers
- Matter / Zigbee / Z-Wave adapters (they arrive through Home Assistant first)
- Adding Anthropic/OpenAI SDKs next to OpenRouter

## Phase map

0 Foundation (this tree)
1 Connected home (HA + twin + realtime UI)
2 Durable automation
3 Agentic control
4 Simulation and proactivity
5 Ecosystem (MCP, connector SDK)

## Language

Always write code in English. That includes identifiers, comments, log messages, error strings, test names, UI copy in `apps/web`, and repo docs (`README.md`, `AGENTS.md`, ADRs, runbooks).

Conversation with the owner may be Spanish. Do not put Spanish into source files.
