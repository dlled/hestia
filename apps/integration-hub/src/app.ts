import { IntegrationCheckpointSchema, type ReadinessCheck } from "@hestia/contracts";
import { createServiceApp, HttpError } from "@hestia/service-runtime";
import type { Express } from "express";
import type { HomeAssistantIngestor } from "./ingestor.js";

export function createIntegrationHubApp(
  options: { ingestor?: HomeAssistantIngestor } = {},
): Express {
  return createServiceApp({
    service: "integration-hub",
    readiness: async (): Promise<ReadinessCheck[]> => {
      const status = options.ingestor?.status();
      return [
        {
          name: "home-assistant-rest",
          status: status?.rest ? "ok" : "degraded",
          detail: options.ingestor ? "configured" : "not configured",
        },
        {
          name: "home-assistant-state-stream",
          status: status?.streaming ? "ok" : "degraded",
          detail: status?.streaming ? "subscribed to state_changed" : "not subscribed",
        },
        {
          name: "home-assistant-topology",
          status: status?.topology ? "ok" : "degraded",
          detail: status?.topology ? "registries discovered" : "registry discovery unavailable",
        },
      ];
    },
    register(app) {
      app.post("/api/v1/integrations/home-assistant/sync", async (_request, response) => {
        if (!options.ingestor) throw new HttpError(503, "Home Assistant is not configured");
        response.json(await options.ingestor.sync());
      });
      app.get("/api/v1/integrations/home-assistant/status", async (_request, response) => {
        if (!options.ingestor) throw new HttpError(503, "Home Assistant is not configured");
        response.json(IntegrationCheckpointSchema.parse(await options.ingestor.checkpoint()));
      });
    },
  });
}
