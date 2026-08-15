# Requirements coverage

This matrix is the implementation ledger for `HESTIA_Documento_Requisitos_y_Arquitectura_v0.1` and `HESTIA_Plan_Ejecutivo_v0.1`. A skeleton means the deployable boundary, environment contract, health checks, container wiring, and a basic test exist; it does not mean the full feature family is complete.

| Requirement family | Status | Current evidence | Remaining proof |
| --- | --- | --- | --- |
| IAM 001–008 | Partial | `identity` skeleton, local-first owner/recovery/role/scope manifest, production secret contract | Passkeys, sessions, multi-resident enforcement, guest expiry, recovery and privilege integration tests |
| INT 001–012 | Partial | Home Assistant REST/WebSocket adapter, topology, checkpointing, JetStream, integration worker | MQTT, webhooks, external MCP clients, virtual integrations, SDK lifecycle and isolation |
| STATE 001–009 | Partial | PostgreSQL materialized twin, stable topology IDs, deduplication/checkpoints, observed-state history | desired-state model, complete rebuild tooling, realtime subscription contract and long-retention policy |
| CTRL 001–010 | Partial | typed/idempotent commands, deterministic risk/policy, selective approval, Temporal retries/compensation, observed-state completion | generalized resource locks, budgets, manual override and shadow execution across domains |
| AUTO 001–015 | Partial | durable versioned sleep routine and restart-safe workflow state | DSL, versions/drafts, trigger families, conditions, visual builder, simulator, replay and generalized rollback |
| AI 001–017 | Partial | strict intent schema, injection corpus, durable agent workflow, isolated model gateway, ZDR request mode | model profiles/fallbacks, usage budgets, prompt registry, context provenance, memory and specialists |
| UI 001–010 | Partial | dashboard, sleep preview, approval, cancellation, workflow/audit display | full realtime UX, automation builder/simulator, identity/admin, notifications and degraded/offline states |
| NOT 001–007 | Skeleton | notification service and dedicated worker deployment boundary | channel adapters, preferences, deduplication, escalation, acknowledgement and delivery history |
| OPS 001–009 | Partial | non-root images, 20-service Compose, health/readiness, migrations and black-box recovery tests | backup/restore drill, OpenTelemetry pipeline, dashboards, support bundle, upgrade/rollback and chaos schedule |
| DEV 001–008 | Partial | versioned APIs, shared strict contracts/events, MCP 2026-07-28 gateway with request integrity | OpenAPI publication, generated SDK, plugin sandbox, compatibility matrix and conformance suite |

## Acceptance criteria

| Criterion | Status | Evidence or gap |
| --- | --- | --- |
| AC-01 one-command local deployment | Complete | production Compose config and health waits validate all 20 services |
| AC-02 live home state | Partial | HA state reaches Edge/UI; formal realtime subscription/SSE contract remains |
| AC-03 topology and resilience | Partial | areas/devices/entities and restart checkpoints covered; broader adapter failure matrix remains |
| AC-04 safe typed plan | Complete for sleep vertical | schema, deterministic policy and visible preview |
| AC-05 durable execution | Complete for sleep vertical | Temporal, worker loss, approval, compensation, observed state and audit recovery |
| AC-06 model isolation | Complete for current vertical | only `model-gateway` holds provider credentials; model emits strict typed interpretation only |
| AC-07 prompt-injection resistance | Complete for current allowlist | unsupported intents and injection-shaped corpus cases cannot produce device calls |
| AC-08 simulation/proactivity | Not started | phase 4 gate |
| AC-09 end-to-end demo | Complete for sleep vertical | phase 3 Docker black-box proof |

The next implementation item is always selected from this ledger and must add unit, integration, and black-box evidence appropriate to its risk before its status advances.
