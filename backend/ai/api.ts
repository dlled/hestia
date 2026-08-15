import {
  AgentClarificationSchema,
  IntentInterpretationJsonSchema,
  ResidentIntentRequestSchema,
} from "@hestia/contracts";
import { APIError, api } from "encore.dev/api";
import { automation, modelgateway, temporalbridge } from "~encore/clients";
import type {
  AgentClarificationView,
  AgentIntentStateView,
  IntentInterpretationView,
  IntentPlanPreviewView,
  ResidentIntentRequestView,
} from "../shared/contracts";
import { parseIntentOutput } from "./interpret";
import { intentProfile, intentSystemPrompt } from "./prompt";

export const interpretIntent = api(
  { method: "POST", path: "/internal/ai/intents/interpret" },
  async (input: ResidentIntentRequestView): Promise<IntentInterpretationView> => {
    const request = ResidentIntentRequestSchema.safeParse({
      utterance: input.utterance,
      requestedBy: input.requestedBy,
    });
    if (!request.success) throw APIError.invalidArgument("Invalid resident intent");
    const completion = await modelgateway.completeStructured({
      profile: intentProfile,
      schemaName: "hestia_intent_interpretation",
      jsonSchemaJson: JSON.stringify(IntentInterpretationJsonSchema),
      system: intentSystemPrompt,
      inputJson: JSON.stringify({ utterance: request.data.utterance }),
    });
    try {
      return parseIntentOutput(completion.outputJson);
    } catch (error) {
      throw APIError.dataLoss("Model output failed the intent contract", error as Error);
    }
  },
);

export const previewIntent = api(
  { method: "POST", path: "/internal/ai/intents/preview" },
  async (input: ResidentIntentRequestView): Promise<IntentPlanPreviewView> => {
    const interpretation = await interpretIntent(input);
    if (interpretation.kind === "unsupported" || !interpretation.sleep) {
      return { interpretation, modelProfile: intentProfile };
    }
    const preview = await automation.previewSleep({
      homeId: input.homeId ?? process.env.HOME_ID ?? "home_primary",
      ...interpretation.sleep,
      requestedBy: input.requestedBy ?? "resident",
      dryRun: false,
    });
    return { interpretation, preview, modelProfile: intentProfile };
  },
);

export const startIntentRun = api(
  { method: "POST", path: "/internal/ai/intents/runs" },
  async (input: ResidentIntentRequestView): Promise<{ workflowId: string; runId: string }> => {
    const request = ResidentIntentRequestSchema.safeParse({
      utterance: input.utterance,
      requestedBy: input.requestedBy,
    });
    if (!request.success) throw APIError.invalidArgument("Invalid resident intent");
    return temporalbridge.startAgentIntent({ requestJson: JSON.stringify(request.data) });
  },
);

export const getIntentRun = api(
  { method: "GET", path: "/internal/ai/intents/runs/:workflowId" },
  async ({ workflowId }: { workflowId: string }): Promise<AgentIntentStateView> => {
    const response = await temporalbridge.agentIntentState({ workflowId });
    return JSON.parse(response.stateJson) as AgentIntentStateView;
  },
);

export const clarifyIntentRun = api(
  { method: "POST", path: "/internal/ai/intents/runs/:workflowId/clarification" },
  async (input: AgentClarificationView): Promise<{ accepted: true }> => {
    const clarification = AgentClarificationSchema.safeParse({
      text: input.text,
      providedBy: input.providedBy,
    });
    if (!clarification.success) throw APIError.invalidArgument("Invalid clarification");
    await temporalbridge.clarifyAgentIntent({
      workflowId: input.workflowId,
      clarificationJson: JSON.stringify(clarification.data),
    });
    return { accepted: true };
  },
);

export const status = api(
  { method: "GET", path: "/internal/ai/status" },
  async (): Promise<{
    orchestration: "encore";
    workflows: "temporal";
    modelBoundary: "modelgateway";
  }> => ({
    orchestration: "encore",
    workflows: "temporal",
    modelBoundary: "modelgateway",
  }),
);
