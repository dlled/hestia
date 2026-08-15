import { IntentInterpretationSchema } from "@hestia/contracts";
import type { IntentInterpretationView } from "../shared/contracts";

export function parseIntentOutput(outputJson: string): IntentInterpretationView {
  const parsed = IntentInterpretationSchema.parse(JSON.parse(outputJson));
  return {
    kind: parsed.kind,
    confidence: parsed.confidence,
    summary: parsed.summary,
    ...(parsed.sleep ? { sleep: parsed.sleep } : {}),
  };
}
