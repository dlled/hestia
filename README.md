# HESTIA

Local-first home operating system. A person states an intent; HESTIA reads context, proposes a typed plan, applies policy, executes on Temporal, and explains what actually changed.

Thesis: **probabilistic intelligence above; deterministic execution below.**

This repository is a TypeScript monorepo. Phases 0–2 and the first Phase 3 vertical are implemented: Home Assistant state is materialized through JetStream and PostgreSQL, and natural-language sleep intent becomes a durable, resumable, policy-controlled Temporal workflow with observed-state verification. The deployment skeleton now contains every service boundary from the source architecture, including identity, provider isolation, notifications, and a stateless MCP 2026-07-28 gateway.

## Stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 24+, TypeScript strict, pnpm workspaces, Turborepo |
| Web | React 19 + Vite 8 |
| HTTP | Express 5 (BFF + domain services) |
| Orchestration | Temporal TypeScript |
| Events | NATS JetStream |
| Data | PostgreSQL (one cluster, schema-per-service) + MinIO |
| Models | OpenRouter, only through `model-gateway` and `packages/model-client` |
| Devices | Home Assistant first, only through `packages/ha-client` (Phase 1) |

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm dev
```

That command:

1. Starts Postgres, NATS, MinIO, Temporal, and Temporal UI
2. Applies schema migrations when `psql` is available
3. Starts `edge-api`, the automation worker, and the web app

Then:

- Web: [http://localhost:5173](http://localhost:5173)
- API health: [http://localhost:3000/health](http://localhost:3000/health)
- Temporal UI: [http://localhost:8080](http://localhost:8080)

```bash
pnpm test
pnpm typecheck
pnpm lint
```

The normal suite validates the versioned intent-eval corpus locally. Running it against a real model is opt-in:

```bash
OPENROUTER_API_KEY=... OPENROUTER_MODEL_FAST=... pnpm test:evals:intent
```

For the full production-style container topology, see [Container deployment](docs/runbooks/containers.md).

## Phase 0 exit criteria

- [x] One command brings the system up
- [x] A test Temporal workflow survives a durable sleep (`pingWorkflow`)
- [x] Shared contracts, risk classes, and a deterministic policy broker
- [x] Compose profiles for lab and home-prod

## What the LLM may never do

The model produces a typed `ProposedAction` / `ActionPlan`. It does not call Home Assistant, MQTT, or any adapter. Policy assigns risk. Temporal executes. Observed state wins.

## Layout

```
apps/          web, edge-api, domain services, Temporal workers
packages/      contracts, domain, policy, workflows, clients
infra/         compose, migrations, scripts
docs/          ADRs, runbooks, product notes
```

## Current vertical

The **“I'm going to sleep”** vertical accepts natural language or explicit options, previews a typed plan for lights, climate, covers, media, and alarm, requests selective approval, executes through a dedicated device worker, and exposes an audit trail.

Implementation evidence is tracked in [Connected home](docs/product/phase-1-connected-home.md), [Durable automation](docs/product/phase-2-durable-automation.md), and [Agentic control](docs/product/phase-3-agentic-control.md).

The remaining proof-of-concept work and requirement status are tracked in the [development plan](docs/product/proof-of-concept-plan.md) and [requirements coverage matrix](docs/product/requirements-coverage.md).
