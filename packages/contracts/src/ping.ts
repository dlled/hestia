import { z } from "zod";

export const PingWorkflowInputSchema = z.object({
  requestedBy: z.string().min(1),
  holdMs: z.number().int().positive().max(60_000).default(2000),
});

export type PingWorkflowInput = z.infer<typeof PingWorkflowInputSchema>;

export const PingMarkSchema = z.object({
  at: z.iso.datetime(),
  workerId: z.string().min(1),
  requestedBy: z.string().min(1),
});

export const PingWorkflowResultSchema = z.object({
  started: PingMarkSchema,
  finished: PingMarkSchema,
  holdMs: z.number().int().nonnegative(),
});

export type PingWorkflowResult = z.infer<typeof PingWorkflowResultSchema>;
export type PingMark = z.infer<typeof PingMarkSchema>;

export const PingWorkflowStatusSchema = z.object({
  workflowId: z.string().min(1),
  runId: z.string().min(1),
  status: z.enum(["running", "completed", "failed", "cancelled", "terminated", "timed_out"]),
  result: PingWorkflowResultSchema.optional(),
});

export type PingWorkflowStatus = z.infer<typeof PingWorkflowStatusSchema>;

export interface PingActivities {
  markAlive(input: { requestedBy: string }): Promise<PingMark>;
}
