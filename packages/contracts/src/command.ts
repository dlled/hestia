import { z } from "zod";
import { CapabilityIdSchema } from "./capability.js";
import { CommandIdSchema, EntityIdSchema, HomeIdSchema } from "./ids.js";
import { RiskClassSchema } from "./risk.js";

export const CommandTargetSchema = z.object({
  homeId: HomeIdSchema,
  entityId: EntityIdSchema.optional(),
  areaId: z.string().optional(),
  selector: z.string().optional(),
});

export const TypedCommandSchema = z.object({
  commandId: CommandIdSchema,
  idempotencyKey: z.string().min(8),
  capability: CapabilityIdSchema,
  target: CommandTargetSchema,
  input: z.record(z.string(), z.unknown()).default({}),
  risk: RiskClassSchema,
  dryRun: z.boolean().default(false),
});

export type TypedCommand = z.infer<typeof TypedCommandSchema>;

export const CommandOutcomeSchema = z.enum([
  "accepted",
  "confirmed",
  "rejected",
  "timed_out",
  "partially_applied",
  "compensated",
]);

export type CommandOutcome = z.infer<typeof CommandOutcomeSchema>;
