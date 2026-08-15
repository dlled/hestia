import { z } from "zod";

export const HealthStatusSchema = z.enum(["ok", "degraded", "down"]);

export const HealthResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string().min(1),
  version: z.string().min(1),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadinessCheckSchema = z.object({
  name: z.string().min(1),
  status: HealthStatusSchema,
  detail: z.string().optional(),
});

export const ReadinessResponseSchema = z.object({
  status: HealthStatusSchema,
  service: z.string().min(1),
  checks: z.array(ReadinessCheckSchema),
  timestamp: z.iso.datetime(),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;
