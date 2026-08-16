import { z } from "zod";
import { DeviceCommandResultSchema, ProposedActionSchema } from "./automation.js";
import { EntityIdSchema, EventIdSchema, HomeIdSchema } from "./ids.js";

export const IncidentSeveritySchema = z.enum(["info", "warning", "critical"]);

export const IncidentLifecycleStatusSchema = z.enum([
  "open",
  "acknowledged",
  "mitigated",
  "monitoring",
  "resolved",
  "false_positive",
]);

export const IncidentResolutionStatusSchema = z.enum(["resolved", "false_positive"]);

export const LeakPlaybookModeSchema = z.enum(["active", "test"]);

export const LeakPlaybookSchema = z
  .object({
    playbookId: z.string().min(8),
    version: z.number().int().positive(),
    homeId: HomeIdSchema,
    name: z.string().min(1),
    status: z.literal("published"),
    triggerDeviceClass: z.literal("moisture"),
    preauthorized: z.literal(true),
    mode: LeakPlaybookModeSchema,
    acknowledgementTimeoutMs: z.number().int().min(1_000).max(86_400_000),
    actions: z.array(ProposedActionSchema).max(20),
    publishedAt: z.iso.datetime(),
  })
  .superRefine((playbook, context) => {
    playbook.actions.forEach((action, index) => {
      if (action.command.target.homeId !== playbook.homeId) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "target", "homeId"],
          message: "Playbook commands must target the configured home",
        });
      }
      if (!action.command.target.entityId) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "target", "entityId"],
          message: "Incident playbook commands require an explicit entity",
        });
      }
      if (!["valve.setOpen", "power.onOff"].includes(action.command.capability)) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "capability"],
          message: "Leak playbook v1 only permits valve closure or power isolation",
        });
      }
      if (playbook.mode === "test" && !action.command.dryRun) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "dryRun"],
          message: "Test-mode playbooks may only contain dry-run commands",
        });
      }
      if (action.command.capability === "valve.setOpen" && action.command.input.open !== false) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "input", "open"],
          message: "Leak playbooks may only close valves",
        });
      }
      if (action.command.capability === "power.onOff" && action.command.input.on !== false) {
        context.addIssue({
          code: "custom",
          path: ["actions", index, "command", "input", "on"],
          message: "Leak playbooks may only isolate power",
        });
      }
      if (action.compensation) {
        if (
          action.compensation.command.target.homeId !== playbook.homeId ||
          !action.compensation.command.target.entityId
        ) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "compensation", "command", "target"],
            message: "Compensation must target an explicit entity in the configured home",
          });
        }
        const validValveCompensation =
          action.compensation.command.capability === "valve.setOpen" &&
          action.compensation.command.input.open === true;
        const validPowerCompensation =
          action.compensation.command.capability === "power.onOff" &&
          action.compensation.command.input.on === true;
        if (!validValveCompensation && !validPowerCompensation) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "compensation", "command"],
            message: "Leak playbook compensation may only restore the isolated resource",
          });
        }
        if (action.compensation.command.capability !== action.command.capability) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "compensation", "command", "capability"],
            message: "Compensation capability must match its mitigation action",
          });
        }
        if (playbook.mode === "test" && !action.compensation.command.dryRun) {
          context.addIssue({
            code: "custom",
            path: ["actions", index, "compensation", "command", "dryRun"],
            message: "Test-mode compensation must be dry-run",
          });
        }
      }
    });
  });

export const LeakIncidentEvidenceSchema = z.object({
  eventId: EventIdSchema,
  homeId: HomeIdSchema,
  correlationId: z.string().min(8),
  occurredAt: z.iso.datetime(),
  sensor: z.object({
    entityId: EntityIdSchema,
    name: z.string().min(1),
    deviceClass: z.literal("moisture"),
    observedValue: z.string().min(1),
    areaId: z.string().min(8).optional(),
    source: z.string().min(1),
  }),
});

export const LeakIncidentInputSchema = z.object({
  evidence: LeakIncidentEvidenceSchema,
  playbook: LeakPlaybookSchema,
});

export const IncidentAcknowledgementSchema = z.object({
  principalId: z.string().min(8),
  acknowledgedAt: z.iso.datetime(),
});

export const IncidentResolutionSchema = z.object({
  status: IncidentResolutionStatusSchema,
  principalId: z.string().min(8),
  resolvedAt: z.iso.datetime(),
  note: z.string().min(1).max(2_000),
});

export const IncidentActionStateSchema = z.object({
  actionId: z.string().min(8),
  status: z.enum(["pending", "confirmed", "failed", "compensated", "skipped"]),
  result: DeviceCommandResultSchema.optional(),
  error: z.string().min(1).optional(),
});

export const IncidentWorkflowPhaseSchema = z.enum([
  "validating",
  "mitigating",
  "notifying",
  "awaiting_acknowledgement",
  "escalated",
  "monitoring",
  "resolved",
  "false_positive",
  "failed",
]);

export const IncidentWorkflowStateSchema = z.object({
  workflowId: z.string().min(8),
  incidentId: z.string().min(8).optional(),
  homeId: HomeIdSchema,
  playbookId: z.string().min(8),
  playbookVersion: z.number().int().positive(),
  phase: IncidentWorkflowPhaseSchema,
  severity: IncidentSeveritySchema,
  evidenceEventIds: z.array(EventIdSchema),
  actions: z.array(IncidentActionStateSchema),
  escalationStep: z.number().int().nonnegative(),
  acknowledgement: IncidentAcknowledgementSchema.optional(),
  resolution: IncidentResolutionSchema.optional(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().optional(),
  error: z.string().min(1).optional(),
});

export type IncidentSeverity = z.infer<typeof IncidentSeveritySchema>;
export type IncidentLifecycleStatus = z.infer<typeof IncidentLifecycleStatusSchema>;
export type IncidentResolutionStatus = z.infer<typeof IncidentResolutionStatusSchema>;
export type LeakPlaybook = z.infer<typeof LeakPlaybookSchema>;
export type LeakIncidentEvidence = z.infer<typeof LeakIncidentEvidenceSchema>;
export type LeakIncidentInput = z.infer<typeof LeakIncidentInputSchema>;
export type IncidentAcknowledgement = z.infer<typeof IncidentAcknowledgementSchema>;
export type IncidentResolution = z.infer<typeof IncidentResolutionSchema>;
export type IncidentWorkflowState = z.infer<typeof IncidentWorkflowStateSchema>;
