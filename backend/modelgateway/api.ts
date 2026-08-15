import { createOpenRouterModelGateway, type ModelGateway } from "@hestia/model-client";
import { APIError, api } from "encore.dev/api";
import type { StructuredCompletionRequestView } from "../shared/contracts";
import { OpenRouterApiKey } from "./secrets";

let modelPromise: Promise<ModelGateway> | undefined;

async function model(): Promise<ModelGateway> {
  modelPromise ??= Promise.resolve(
    createOpenRouterModelGateway({
      apiKey: OpenRouterApiKey(),
      baseUrl: process.env.OPENROUTER_BASE_URL,
      profiles: [
        {
          id: "intent-fast",
          model: process.env.OPENROUTER_MODEL_FAST ?? "openai/gpt-4.1-mini",
          purpose: "fast.intent",
          requireStructuredOutput: true,
          zeroDataRetention: true,
        },
      ],
    }),
  );
  return modelPromise;
}

export const status = api(
  { method: "GET", path: "/internal/models/status" },
  async (): Promise<{ provider: "openrouter"; profile: "intent-fast"; isolated: true }> => ({
    provider: "openrouter",
    profile: "intent-fast",
    isolated: true,
  }),
);

export const completeStructured = api(
  { method: "POST", path: "/internal/models/structured-completions" },
  async (request: StructuredCompletionRequestView): Promise<{ outputJson: string }> => {
    if (!request.profile || !request.schemaName || !request.system) {
      throw APIError.invalidArgument("Invalid structured completion request");
    }
    let jsonSchema: Record<string, unknown>;
    let input: unknown;
    try {
      jsonSchema = JSON.parse(request.jsonSchemaJson) as Record<string, unknown>;
      input = JSON.parse(request.inputJson) as unknown;
    } catch (error) {
      throw APIError.invalidArgument("Structured completion JSON is invalid", error as Error);
    }
    const output = await (await model()).completeStructured({
      profile: request.profile,
      schemaName: request.schemaName,
      jsonSchema,
      system: request.system,
      input,
    });
    return { outputJson: JSON.stringify(output) };
  },
);
