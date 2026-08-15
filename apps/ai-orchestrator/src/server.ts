import { loadEnv, resolveServicePort, ServicePorts } from "@hestia/config";
import { createHttpModelGateway } from "@hestia/model-client";
import { createLogger } from "@hestia/observability";
import { listen } from "@hestia/service-runtime";
import { createAiOrchestratorApp } from "./app.js";
import { createHttpAgentAutomationGateway } from "./automation.js";
import { connectAgentTemporal } from "./temporal.js";

const log = createLogger("ai-orchestrator");
const env = loadEnv();
const model = createHttpModelGateway({
  baseUrl: env.MODEL_GATEWAY_URL,
  token: process.env.MODEL_GATEWAY_INTERNAL_TOKEN,
});
async function main(): Promise<void> {
  const automation = createHttpAgentAutomationGateway({
    automationServiceUrl: env.AUTOMATION_SERVICE_URL,
  });
  let temporal: Awaited<ReturnType<typeof connectAgentTemporal>> | undefined;
  if (process.env.HESTIA_RUNTIME_SMOKE !== "true") {
    try {
      temporal = await connectAgentTemporal(env.TEMPORAL_ADDRESS, env.TEMPORAL_NAMESPACE);
    } catch {
      // Liveness and synchronous preview remain available while Temporal is down.
    }
  }
  const shutdown = async (signal: string) => {
    log.info({ signal }, "ai-orchestrator stopping");
    await temporal?.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  listen(
    createAiOrchestratorApp({ model, automation, temporal }),
    "ai-orchestrator",
    resolveServicePort("AI_ORCHESTRATOR_PORT", ServicePorts.aiOrchestrator),
  );
}

main().catch((error) => {
  log.fatal({ err: error }, "ai-orchestrator failed to start");
  process.exit(1);
});
