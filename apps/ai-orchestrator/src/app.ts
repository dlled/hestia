import {
  AgentClarificationSchema,
  type IntentInterpretation,
  IntentInterpretationJsonSchema,
  IntentInterpretationSchema,
  IntentPlanPreviewResponseSchema,
  type ReadinessCheck,
  ResidentIntentRequestSchema,
} from "@hestia/contracts";
import type { ModelGateway } from "@hestia/model-client";
import { createServiceApp, HttpError } from "@hestia/service-runtime";
import type { Express } from "express";
import type { AgentAutomationGateway } from "./automation.js";
import { intentProfile, intentSystemPrompt } from "./prompt.js";
import type { AgentTemporalGateway } from "./temporal.js";

export function createAiOrchestratorApp(options: {
  model?: ModelGateway;
  automation?: AgentAutomationGateway;
  temporal?: AgentTemporalGateway;
}): Express {
  return createServiceApp({
    service: "ai-orchestrator",
    readiness: async (): Promise<ReadinessCheck[]> => [
      {
        name: "model-gateway",
        status: options.model ? "ok" : "down",
        detail: options.model ? "structured intent profile configured" : "provider not configured",
      },
      {
        name: "temporal",
        status: options.temporal ? "ok" : "down",
        detail: options.temporal ? "durable intent workflows configured" : "gateway unavailable",
      },
      {
        name: "automation-service",
        status: options.automation ? "ok" : "down",
        detail: options.automation ? "sleep preview gateway configured" : "gateway unavailable",
      },
    ],
    register(app) {
      app.post("/api/v1/intents/interpret", async (request, response) => {
        const parsed = ResidentIntentRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, "Invalid resident intent");
        response.json(await interpret(options.model, parsed.data.utterance));
      });

      app.post("/api/v1/intents/preview", async (request, response) => {
        if (!options.model || !options.automation) {
          throw new HttpError(503, "Agentic planning is not configured");
        }
        const parsed = ResidentIntentRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, "Invalid resident intent");

        const interpretation = await interpret(options.model, parsed.data.utterance);
        if (interpretation.kind === "unsupported") {
          response.json(
            IntentPlanPreviewResponseSchema.parse({
              interpretation,
              modelProfile: intentProfile,
            }),
          );
          return;
        }
        const sleep = interpretation.sleep;
        if (!sleep) throw new HttpError(502, "Model omitted sleep parameters");
        const preview = await options.automation.previewSleepPlan({
          ...sleep,
          requestedBy: parsed.data.requestedBy,
          dryRun: false,
        });
        response.json(
          IntentPlanPreviewResponseSchema.parse({
            interpretation,
            preview,
            modelProfile: intentProfile,
          }),
        );
      });

      app.post("/api/v1/intents/runs", async (request, response) => {
        if (!options.temporal) throw new HttpError(503, "Agent workflow is not configured");
        const parsed = ResidentIntentRequestSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, "Invalid resident intent");
        response.status(202).json(await options.temporal.start(parsed.data));
      });

      app.get("/api/v1/intents/runs/:workflowId", async (request, response) => {
        if (!options.temporal) throw new HttpError(503, "Agent workflow is not configured");
        response.json(await options.temporal.state(request.params.workflowId));
      });

      app.post("/api/v1/intents/runs/:workflowId/clarification", async (request, response) => {
        if (!options.temporal) throw new HttpError(503, "Agent workflow is not configured");
        const parsed = AgentClarificationSchema.safeParse(request.body);
        if (!parsed.success) throw new HttpError(400, "Invalid clarification");
        await options.temporal.clarify(request.params.workflowId, parsed.data);
        response.status(202).json({ accepted: true });
      });
    },
  });
}

async function interpret(
  model: ModelGateway | undefined,
  utterance: string,
): Promise<IntentInterpretation> {
  if (!model) throw new HttpError(503, "Model gateway is not configured");
  const raw = await model.completeStructured({
    profile: intentProfile,
    schemaName: "hestia_intent_interpretation",
    jsonSchema: IntentInterpretationJsonSchema,
    system: intentSystemPrompt,
    input: { utterance },
  });
  const interpretation = IntentInterpretationSchema.safeParse(raw);
  if (!interpretation.success) {
    throw new HttpError(502, "Model output failed the intent contract");
  }
  return interpretation.data;
}
