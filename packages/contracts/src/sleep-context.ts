import { z } from "zod";
import { AreaIdSchema, EntityIdSchema, HomeIdSchema } from "./ids.js";
import { StateSnapshotSchema } from "./topology.js";

export const SleepContextItemSchema = z.object({
  entityId: EntityIdSchema,
  name: z.string().min(1),
  areaId: AreaIdSchema.optional(),
  domain: z.string().min(1),
  observedState: StateSnapshotSchema,
  attention: z.enum(["ready", "stale", "unavailable"]),
});

export const SleepContextSchema = z.object({
  homeId: HomeIdSchema,
  generatedAt: z.iso.datetime(),
  readiness: z.enum(["ready", "degraded"]),
  summary: z.object({
    relevant: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
    unavailable: z.number().int().nonnegative(),
  }),
  categories: z.object({
    lights: z.array(SleepContextItemSchema),
    climate: z.array(SleepContextItemSchema),
    covers: z.array(SleepContextItemSchema),
    media: z.array(SleepContextItemSchema),
    alarm: z.array(SleepContextItemSchema),
  }),
});

export type SleepContext = z.infer<typeof SleepContextSchema>;
export type SleepContextItem = z.infer<typeof SleepContextItemSchema>;
