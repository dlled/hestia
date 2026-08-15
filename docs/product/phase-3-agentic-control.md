# Phase 3 — Agentic control

## Objective

Turn an untrusted natural-language resident intent into a schema-validated, visible plan without giving a model access to policy, Temporal, Home Assistant, or generic tools.

## Implemented vertical

- Strict resident-intent, interpretation, and preview response contracts.
- A single supported intent (`sleep`) with an explicit `unsupported` outcome for every other request.
- OpenRouter structured-output gateway isolated in the deployable `model-gateway` and `packages/model-client`; requests use JSON Schema strict mode, deterministic temperature, a bounded timeout, and Zero Data Retention routing.
- `ai-orchestrator` treats the utterance as untrusted data and validates all model output before calling another service.
- The model extracts only sleep options. `automation-service` still builds entity-level commands, expected observations, risk classes, and compensations deterministically from the observed twin.
- `AgentIntentWorkflow` runs on the dedicated `hestia-ai` Temporal queue. It exposes durable state queries, survives worker loss, and waits on a clarification signal when the interpretation is unsupported or below the confidence threshold.
- Neither the agent worker nor `ai-orchestrator` owns a provider credential. Their bounded calls terminate at the internal `model-gateway`, the sole OpenRouter credential boundary.
- Edge exposes the durable agent-run API. The web UI accepts natural language, follows workflow state, resumes clarification, shows interpretation confidence and the complete plan, and never executes it until the resident explicitly selects **Execute visible plan**.
- `intent-routing.v0.json` supplies a privacy-preserving bilingual corpus for routing, extraction, prompt-injection resistance, and privacy requests. Structural validation is mandatory; provider-backed scoring is opt-in.

## HTTP surface

- Internal deterministic helpers: `POST /api/v1/intents/interpret` and `POST /api/v1/intents/preview` on `ai-orchestrator`
- Durable start: `POST /api/v1/intents/runs`
- Durable query: `GET /api/v1/intents/runs/:workflowId`
- Resumable clarification: `POST /api/v1/intents/runs/:workflowId/clarification`

The three durable routes are available through both `ai-orchestrator` and the public Edge API.

## Secrets and deployment

- `OPENROUTER_API_KEY` is empty in every example and is injected only into `model-gateway` in the production Compose topology.
- `OPENROUTER_MODEL_FAST` selects the provider model without hard-coding a moving model identifier.
- `OPENROUTER_BASE_URL` is configurable for tests and provider-compatible deployments.
- `MODEL_GATEWAY_INTERNAL_TOKEN` authenticates the private `ai-orchestrator` to `model-gateway` hop and is empty in every example.

## Verification

| Level | Evidence |
| --- | --- |
| Unit | Strict intent invariants, OpenRouter request/response behavior, and agent workflow signal/query behavior |
| Integration | Model output validation, injection-shaped payload rejection, deterministic automation preview, durable Edge forwarding, clarification, and UI intent-to-visible-plan flow |
| Corpus | 12 versioned bilingual routing, extraction, safety, and privacy cases; real-provider execution is opt-in |
| Black box | Natural language → simulated strict/ZDR model provider → durable agent workflow → deterministic preview → approval → Temporal → simulated HA, with worker loss, service restart, and audit restoration |

Run the black-box proof with:

```bash
pnpm test:blackbox:phase3
```

Run the opt-in provider corpus with:

```bash
OPENROUTER_API_KEY=... OPENROUTER_MODEL_FAST=... pnpm test:evals:intent
```

## Remaining Phase 3 work

- Select and baseline concrete fast-intent models against the opt-in corpus; pin acceptance thresholds before production use.
- Add more deterministic intent adapters after each corresponding domain routine exists.
- Persist intent/interpretation provenance without storing provider credentials or unnecessary sensitive prompt content.
