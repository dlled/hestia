import { z } from "zod";
import { AreaIdSchema, DeviceIdSchema, EntityIdSchema, HomeIdSchema } from "./ids.js";
import { RiskClassSchema } from "./risk.js";

export const StateQualitySchema = z.enum(["good", "uncertain", "stale", "unavailable"]);

export const StateSnapshotSchema = z.object({
  value: z.unknown(),
  unit: z.string().optional(),
  timestamp: z.iso.datetime(),
  source: z.string().min(1),
  quality: StateQualitySchema,
  staleAfterSec: z.number().int().positive().optional(),
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

export const RelationshipTypeSchema = z.enum([
  "located_in",
  "controls",
  "measures",
  "powered_by",
  "depends_on",
  "conflicts_with",
]);

export const AreaSchema = z.object({
  id: AreaIdSchema,
  homeId: HomeIdSchema,
  name: z.string().min(1),
  kind: z.enum(["room", "zone", "floor", "exterior", "logical"]).default("room"),
});

export const DeviceSchema = z.object({
  id: DeviceIdSchema,
  homeId: HomeIdSchema,
  areaId: AreaIdSchema.optional(),
  name: z.string().min(1),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  integration: z.string().min(1),
});

export const EntitySchema = z.object({
  id: EntityIdSchema,
  homeId: HomeIdSchema,
  deviceId: DeviceIdSchema.optional(),
  areaId: AreaIdSchema.optional(),
  name: z.string().min(1),
  capabilities: z.array(z.string().min(1)),
  observedState: StateSnapshotSchema.optional(),
  desiredState: StateSnapshotSchema.optional(),
  externalRef: z.string().optional(),
});

export const HomeSchema = z.object({
  id: HomeIdSchema,
  name: z.string().min(1),
  timezone: z.string().min(1),
});

export type Home = z.infer<typeof HomeSchema>;
export type Area = z.infer<typeof AreaSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type Entity = z.infer<typeof EntitySchema>;

export const TopologySchema = z.object({
  home: HomeSchema,
  areas: z.array(AreaSchema),
  devices: z.array(DeviceSchema),
  entities: z.array(EntitySchema),
});

export type Topology = z.infer<typeof TopologySchema>;

export const RiskCeilingNote = RiskClassSchema;
