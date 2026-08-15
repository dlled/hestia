export interface ModelProfile {
  id: string;
  model: string;
  purpose:
    | "fast.intent"
    | "planner.default"
    | "planner.high-risk"
    | "summarizer"
    | "vision.sensitive";
  requireStructuredOutput: boolean;
  zeroDataRetention: boolean;
}

export interface StructuredCompletionInput {
  profile: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  input: unknown;
}

export interface ModelGateway {
  completeStructured(input: StructuredCompletionInput): Promise<unknown>;
}

export interface OpenRouterGatewayOptions {
  apiKey: string;
  profiles: ModelProfile[];
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface HttpModelGatewayOptions {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Internal client for the deployable model-gateway boundary. */
export function createHttpModelGateway(options: HttpModelGatewayOptions): ModelGateway {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl.replace(/\/$/u, "");
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async completeStructured(input) {
      const response = await fetchImpl(`${baseUrl}/internal/v1/structured-completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Model gateway request failed (${response.status})`);
      }
      const payload = (await response.json()) as { output?: unknown };
      if (!("output" in payload)) {
        throw new Error("Model gateway returned no output");
      }
      return payload.output;
    },
  };
}

/** The only outbound model-provider client in HESTIA. */
export function createOpenRouterModelGateway(options: OpenRouterGatewayOptions): ModelGateway {
  if (options.apiKey.length === 0) throw new Error("OpenRouter API key is required");
  const profiles = new Map(options.profiles.map((profile) => [profile.id, profile]));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = (options.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/u, "");
  const timeoutMs = options.timeoutMs ?? 15_000;

  return {
    async completeStructured(input) {
      const profile = profiles.get(input.profile);
      if (!profile) throw new Error(`Unknown model profile: ${input.profile}`);
      if (!profile.requireStructuredOutput) {
        throw new Error(`Model profile ${profile.id} does not require structured output`);
      }
      const response = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: profile.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: JSON.stringify(input.input) },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: input.schemaName,
              strict: true,
              schema: input.jsonSchema,
            },
          },
          provider: { zdr: profile.zeroDataRetention },
          temperature: 0,
          stream: false,
        }),
      });
      if (!response.ok) throw new Error(`OpenRouter completion failed (${response.status})`);
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        throw new Error("OpenRouter returned no structured content");
      }
      try {
        return JSON.parse(content) as unknown;
      } catch {
        throw new Error("OpenRouter returned invalid JSON content");
      }
    },
  };
}

export function createUnimplementedModelGateway(): ModelGateway {
  return {
    async completeStructured() {
      throw new Error("Model gateway is not configured");
    },
  };
}
