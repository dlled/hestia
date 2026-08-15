import { z } from "zod";
import { HealthStatusSchema } from "./health.js";
import { HomeIdSchema } from "./ids.js";

export const IntegrationCheckpointSchema = z.object({
  homeId: HomeIdSchema,
  system: z.literal("home_assistant"),
  instanceId: z.string().min(1),
  status: HealthStatusSchema,
  rest: z.boolean(),
  streaming: z.boolean(),
  topology: z.boolean(),
  lastSyncStartedAt: z.iso.datetime().optional(),
  lastSyncCompletedAt: z.iso.datetime().optional(),
  lastSuccessfulSyncAt: z.iso.datetime().optional(),
  lastFailureAt: z.iso.datetime().optional(),
  failureMessage: z.string().min(1).optional(),
  discoveredEntities: z.number().int().nonnegative(),
  discoveredAreas: z.number().int().nonnegative(),
  discoveredDevices: z.number().int().nonnegative(),
});

export type IntegrationCheckpoint = z.infer<typeof IntegrationCheckpointSchema>;
