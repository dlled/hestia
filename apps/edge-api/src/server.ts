import { loadEnv } from "@hestia/config";
import { createLogger } from "@hestia/observability";
import { listen } from "@hestia/service-runtime";
import { createHttpAgentGateway } from "./agent.js";
import { createEdgeApp, defaultEdgePort } from "./app.js";
import { createHttpAutomationGateway } from "./automation.js";
import { createHttpHomeGateway } from "./home.js";
import { connectTemporal, createTemporalGateway } from "./temporal.js";

const log = createLogger("edge-api");

async function main(): Promise<void> {
  const env = loadEnv();
  let temporal: ReturnType<typeof createTemporalGateway> | undefined;
  try {
    const client = await connectTemporal(env.TEMPORAL_ADDRESS, env.TEMPORAL_NAMESPACE);
    temporal = createTemporalGateway(client, env.TEMPORAL_TASK_QUEUE);
    log.info({ address: env.TEMPORAL_ADDRESS }, "connected to Temporal");
  } catch (error) {
    log.warn({ err: error }, "Temporal unavailable; edge-api will start degraded");
  }

  const home = createHttpHomeGateway({
    homeCoreUrl: env.HOME_CORE_URL,
    integrationHubUrl: env.INTEGRATION_HUB_URL,
    homeId: env.HOME_ID,
  });
  const automation = createHttpAutomationGateway({
    automationServiceUrl: env.AUTOMATION_SERVICE_URL,
  });
  const agent = createHttpAgentGateway({ aiOrchestratorUrl: env.AI_ORCHESTRATOR_URL });
  const app = createEdgeApp({ temporal, home, automation, agent });
  listen(app, "edge-api", defaultEdgePort());
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    log.fatal({ err: error }, "edge-api failed to start");
    process.exit(1);
  });
}
