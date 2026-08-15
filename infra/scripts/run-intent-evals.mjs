#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  IntentInterpretationJsonSchema,
  IntentInterpretationSchema,
} from "../../packages/contracts/dist/index.js";
import { createOpenRouterModelGateway } from "../../packages/model-client/dist/index.js";
import {
  intentProfile,
  intentSystemPrompt,
} from "../../apps/ai-orchestrator/dist/prompt.js";
import { evaluateIntentCase, loadIntentEvalCorpus } from "./intent-eval-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const model = process.env.OPENROUTER_MODEL_FAST ?? "";
if (!apiKey || !model) {
  throw new Error(
    "Provider evals are opt-in: set OPENROUTER_API_KEY and OPENROUTER_MODEL_FAST in the process environment",
  );
}

const corpus = await loadIntentEvalCorpus(root);
const gateway = createOpenRouterModelGateway({
  apiKey,
  baseUrl: process.env.OPENROUTER_BASE_URL,
  timeoutMs: Number(process.env.OPENROUTER_TIMEOUT_MS ?? 30_000),
  profiles: [
    {
      id: intentProfile,
      model,
      purpose: "fast.intent",
      requireStructuredOutput: true,
      zeroDataRetention: true,
    },
  ],
});

const results = [];
for (const testCase of corpus.cases) {
  try {
    const raw = await gateway.completeStructured({
      profile: intentProfile,
      schemaName: "hestia_intent_interpretation",
      jsonSchema: IntentInterpretationJsonSchema,
      system: intentSystemPrompt,
      input: { utterance: testCase.utterance },
    });
    const interpretation = IntentInterpretationSchema.parse(raw);
    results.push({ id: testCase.id, failures: evaluateIntentCase(testCase, interpretation) });
  } catch (error) {
    results.push({
      id: testCase.id,
      failures: [error instanceof Error ? error.message : "unknown provider error"],
    });
  }
}

const failed = results.filter((result) => result.failures.length > 0);
for (const result of results) {
  console.log(`${result.failures.length === 0 ? "PASS" : "FAIL"} ${result.id}`);
  for (const failure of result.failures) console.log(`  ${failure}`);
}

console.log(`${results.length - failed.length}/${results.length} provider intent evals passed with ${model}`);
if (failed.length > 0) process.exitCode = 1;
