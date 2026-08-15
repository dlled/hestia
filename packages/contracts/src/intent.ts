import { z } from "zod";
import { SleepPlanPreviewSchema } from "./automation.js";

export const ResidentIntentRequestSchema = z
  .object({
    utterance: z.string().trim().min(1).max(1_000),
    requestedBy: z.string().trim().min(1).default("resident"),
  })
  .strict();

export const IntentInterpretationSchema = z
  .object({
    kind: z.enum(["sleep", "unsupported"]),
    confidence: z.number().min(0).max(1),
    summary: z.string().trim().min(1).max(240),
    sleep: z
      .object({
        climateTargetC: z.number().min(5).max(35),
        closeCovers: z.boolean(),
        armAlarm: z.boolean(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((interpretation, context) => {
    if (interpretation.kind === "sleep" && interpretation.sleep === null) {
      context.addIssue({
        code: "custom",
        path: ["sleep"],
        message: "Sleep intent requires sleep parameters",
      });
    }
    if (interpretation.kind === "unsupported" && interpretation.sleep !== null) {
      context.addIssue({
        code: "custom",
        path: ["sleep"],
        message: "Unsupported intent cannot include sleep parameters",
      });
    }
  });

export const IntentPlanPreviewResponseSchema = z.object({
  interpretation: IntentInterpretationSchema,
  preview: SleepPlanPreviewSchema.optional(),
  modelProfile: z.string().min(1),
});

export const AgentIntentStatusSchema = z.enum([
  "interpreting",
  "awaiting_clarification",
  "planning",
  "completed",
  "failed",
]);

export const AgentClarificationSchema = z
  .object({
    text: z.string().trim().min(1).max(1_000),
    providedBy: z.string().trim().min(1),
  })
  .strict();

export const AgentIntentStateSchema = z.object({
  status: AgentIntentStatusSchema,
  request: ResidentIntentRequestSchema,
  attempt: z.number().int().positive(),
  interpretation: IntentInterpretationSchema.optional(),
  preview: SleepPlanPreviewSchema.optional(),
  error: z.string().min(1).optional(),
});

export const IntentInterpretationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["sleep", "unsupported"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    summary: { type: "string", minLength: 1, maxLength: 240 },
    sleep: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            climateTargetC: { type: "number", minimum: 5, maximum: 35 },
            closeCovers: { type: "boolean" },
            armAlarm: { type: "boolean" },
          },
          required: ["climateTargetC", "closeCovers", "armAlarm"],
        },
        { type: "null" },
      ],
    },
  },
  required: ["kind", "confidence", "summary", "sleep"],
} as const;

export type ResidentIntentRequest = z.infer<typeof ResidentIntentRequestSchema>;
export type IntentInterpretation = z.infer<typeof IntentInterpretationSchema>;
export type IntentPlanPreviewResponse = z.infer<typeof IntentPlanPreviewResponseSchema>;
export type AgentIntentStatus = z.infer<typeof AgentIntentStatusSchema>;
export type AgentClarification = z.infer<typeof AgentClarificationSchema>;
export type AgentIntentState = z.infer<typeof AgentIntentStateSchema>;
