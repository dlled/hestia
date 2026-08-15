import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { createOpenRouterModelGateway } from "@hestia/model-client";
import { listen } from "@hestia/service-runtime";
import { createModelGatewayApp } from "./app.js";

const env = loadEnv();
const apiKey = process.env.OPENROUTER_API_KEY ?? "";
const modelId = process.env.OPENROUTER_MODEL_FAST ?? "";
const authToken = process.env.MODEL_GATEWAY_INTERNAL_TOKEN ?? "";

if (env.HESTIA_ENV === "home-prod" && authToken.length === 0) {
  throw new Error("MODEL_GATEWAY_INTERNAL_TOKEN is required in home-prod");
}

const model =
  apiKey && modelId
    ? createOpenRouterModelGateway({
        apiKey,
        baseUrl: process.env.OPENROUTER_BASE_URL,
        profiles: [
          {
            id: "intent-fast",
            model: modelId,
            purpose: "fast.intent",
            requireStructuredOutput: true,
            zeroDataRetention: true,
          },
        ],
      })
    : undefined;

listen(
  createModelGatewayApp({ model, authToken: authToken || undefined }),
  "model-gateway",
  resolveServicePort("MODEL_GATEWAY_PORT", ServicePorts.modelGateway),
);
