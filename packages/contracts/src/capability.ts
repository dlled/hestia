import { z } from "zod";
import { RiskClassSchema } from "./risk.js";

export const CapabilityIdSchema = z.enum([
  "sensor.read",
  "power.onOff",
  "level.set",
  "color.set",
  "climate.setTarget",
  "climate.setMode",
  "cover.setPosition",
  "valve.setOpen",
  "lock.lock",
  "lock.unlock",
  "security.arm",
  "security.disarm",
  "media.play",
  "media.pause",
  "media.source",
  "vacuum.start",
  "vacuum.dock",
  "irrigation.runZone",
  "energy.setLimit",
  "energy.charge",
  "camera.snapshot",
  "camera.analyze",
]);

export type CapabilityId = z.infer<typeof CapabilityIdSchema>;

export const IdempotencySemanticsSchema = z.enum(["idempotent", "at_most_once", "compensatable"]);

export const CapabilityDefinitionSchema = z.object({
  id: CapabilityIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  baseRisk: RiskClassSchema,
  idempotency: IdempotencySemanticsSchema,
  privacySensitive: z.boolean().default(false),
});

export type CapabilityDefinition = z.infer<typeof CapabilityDefinitionSchema>;
