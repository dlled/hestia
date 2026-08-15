# Agent evals

`intent-routing.v0.json` is the versioned Phase 3 corpus for bilingual routing, sleep-option extraction, policy/tool injection resistance, and privacy-shaped requests. It deliberately contains no real resident, entity, room, device, or credential data.

The normal test suite validates the corpus structure and safety invariants without calling a provider:

```bash
pnpm test:infra
```

Provider-backed evaluation is explicit and opt-in. It uses the same strict JSON Schema, system prompt, model profile, timeout, and OpenRouter ZDR routing as `ai-orchestrator`:

```bash
OPENROUTER_API_KEY=... \
OPENROUTER_MODEL_FAST=... \
pnpm test:evals:intent
```

The runner prints case identifiers and contract mismatches. It never prints the API key, provider response body, or a real home-state snapshot.
