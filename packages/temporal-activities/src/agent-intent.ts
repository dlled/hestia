import { loadEnv } from "@hestia/config";
import {
  type IntentInterpretation,
  IntentInterpretationSchema,
  type ResidentIntentRequest,
  ResidentIntentRequestSchema,
  type SleepPlanPreview,
  SleepPlanPreviewRequestSchema,
  SleepPlanPreviewSchema,
} from "@hestia/contracts";

export async function interpretResidentIntent(
  input: ResidentIntentRequest,
): Promise<IntentInterpretation> {
  const env = loadEnv();
  return request(
    `${env.AI_ORCHESTRATOR_URL.replace(/\/$/u, "")}/api/v1/intents/interpret`,
    ResidentIntentRequestSchema.parse(input),
    IntentInterpretationSchema,
  );
}

export async function previewInterpretedSleepIntent(input: {
  interpretation: IntentInterpretation;
  requestedBy: string;
}): Promise<SleepPlanPreview> {
  const env = loadEnv();
  const interpretation = IntentInterpretationSchema.parse(input.interpretation);
  if (interpretation.kind !== "sleep" || !interpretation.sleep) {
    throw new Error("Only a validated sleep interpretation can be previewed");
  }
  return request(
    `${env.AUTOMATION_SERVICE_URL.replace(/\/$/u, "")}/api/v1/plans/sleep/preview`,
    SleepPlanPreviewRequestSchema.parse({
      ...interpretation.sleep,
      requestedBy: input.requestedBy,
      dryRun: false,
    }),
    SleepPlanPreviewSchema,
  );
}

async function request<T>(
  url: string,
  body: unknown,
  schema: { parse(value: unknown): T },
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Agent activity request failed (${response.status})`);
  return schema.parse(await response.json());
}
