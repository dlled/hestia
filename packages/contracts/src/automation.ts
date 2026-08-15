import { z } from "zod";
import { CommandOutcomeSchema, TypedCommandSchema } from "./command.js";
import { HomeIdSchema } from "./ids.js";
import { PolicyDecisionSchema } from "./risk.js";

export const ExpectedObservationSchema = z.object({
  entityId: z.string().min(8),
  attribute: z.string().min(1).default("state"),
  equals: z.unknown(),
  timeoutMs: z.number().int().min(1_000).max(300_000).default(30_000),
});

export const ProposedActionSchema = z.object({
  actionId: z.string().min(8),
  command: TypedCommandSchema,
  expectedObservation: ExpectedObservationSchema,
  compensation: z
    .object({
      command: TypedCommandSchema,
      expectedObservation: ExpectedObservationSchema,
    })
    .optional(),
});

export const ActionPlanSchema = z
  .object({
    planId: z.string().min(8),
    version: z.number().int().positive(),
    homeId: HomeIdSchema,
    title: z.string().min(1),
    requestedBy: z.string().min(1),
    createdAt: z.iso.datetime(),
    actions: z.array(ProposedActionSchema).min(1).max(50),
    dryRun: z.boolean().default(false),
  })
  .superRefine((plan, context) => {
    const actionIds = new Set<string>();
    const idempotencyKeys = new Set<string>();
    plan.actions.forEach((action, index) => {
      if (action.command.target.homeId !== plan.homeId) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "target", "homeId"],
          message: "Command homeId must match the plan homeId",
        });
      }
      if (action.expectedObservation.entityId !== action.command.target.entityId) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "expectedObservation", "entityId"],
          message: "Expected observation must target the command entity",
        });
      }
      if (actionIds.has(action.actionId)) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "actionId"],
          message: "Action ids must be unique within a plan",
        });
      }
      if (idempotencyKeys.has(action.command.idempotencyKey)) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "idempotencyKey"],
          message: "Command idempotency keys must be unique within a plan",
        });
      }
      actionIds.add(action.actionId);
      idempotencyKeys.add(action.command.idempotencyKey);
    });
  });

export const AutomationRunStatusSchema = z.enum([
  "proposed",
  "evaluating",
  "awaiting_approval",
  "executing",
  "verifying",
  "completed",
  "rejected",
  "failed",
  "compensating",
  "compensated",
  "cancelled",
  "timed_out",
]);

export const ActionExecutionStatusSchema = z.enum([
  "pending",
  "approved",
  "executing",
  "confirmed",
  "rejected",
  "failed",
  "compensated",
  "skipped",
]);

export const ActionExecutionSchema = z.object({
  actionId: z.string().min(8),
  commandId: z.string().min(8),
  status: ActionExecutionStatusSchema,
  policy: PolicyDecisionSchema.optional(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  observedValue: z.unknown().optional(),
  error: z.string().min(1).optional(),
});

export const ApprovalDecisionSchema = z.object({
  approvalId: z.string().min(8),
  approved: z.boolean(),
  decidedBy: z.string().min(1),
  decidedAt: z.iso.datetime(),
});

export const DeviceCommandResultSchema = z.object({
  commandId: z.string().min(8),
  outcome: CommandOutcomeSchema,
  observedValue: z.unknown().optional(),
  executedAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().optional(),
});

export const AutomationRunStateSchema = z.object({
  planId: z.string().min(8),
  status: AutomationRunStatusSchema,
  currentAction: z.number().int().nonnegative(),
  actions: z.array(ActionExecutionSchema),
  pendingApprovalId: z.string().min(8).optional(),
  approval: ApprovalDecisionSchema.optional(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  error: z.string().min(1).optional(),
});

export const SleepPlanPreviewRequestSchema = z.object({
  requestedBy: z.string().min(1).default("resident"),
  climateTargetC: z.number().min(5).max(35).default(18),
  closeCovers: z.boolean().default(true),
  armAlarm: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

export const SleepPlanSkippedEntitySchema = z.object({
  entityId: z.string().min(8),
  name: z.string().min(1),
  reason: z.string().min(1),
});

export const SleepPlanPreviewSchema = z.object({
  plan: ActionPlanSchema,
  skipped: z.array(SleepPlanSkippedEntitySchema),
});

export const AutomationAuditTypeSchema = z.enum([
  "run.started",
  "run.state.changed",
  "approval.submitted",
  "cancel.requested",
]);

export const AutomationAuditEventSchema = z.object({
  sequence: z.number().int().positive(),
  eventId: z.string().min(8),
  workflowId: z.string().min(8),
  runId: z.string().min(8),
  planId: z.string().min(8),
  eventType: AutomationAuditTypeSchema,
  occurredAt: z.iso.datetime(),
  actor: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
});

export const AutomationAuditResponseSchema = z.object({
  workflowId: z.string().min(8),
  events: z.array(AutomationAuditEventSchema),
});

export type ExpectedObservation = z.infer<typeof ExpectedObservationSchema>;
export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type ActionPlan = z.infer<typeof ActionPlanSchema>;
export type AutomationRunStatus = z.infer<typeof AutomationRunStatusSchema>;
export type ActionExecution = z.infer<typeof ActionExecutionSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type DeviceCommandResult = z.infer<typeof DeviceCommandResultSchema>;
export type AutomationRunState = z.infer<typeof AutomationRunStateSchema>;
export type SleepPlanPreviewRequest = z.infer<typeof SleepPlanPreviewRequestSchema>;
export type SleepPlanSkippedEntity = z.infer<typeof SleepPlanSkippedEntitySchema>;
export type SleepPlanPreview = z.infer<typeof SleepPlanPreviewSchema>;
export type AutomationAuditType = z.infer<typeof AutomationAuditTypeSchema>;
export type AutomationAuditEvent = z.infer<typeof AutomationAuditEventSchema>;
export type AutomationAuditResponse = z.infer<typeof AutomationAuditResponseSchema>;
