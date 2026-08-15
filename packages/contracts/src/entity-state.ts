import { z } from "zod";
import { CapabilityIdSchema } from "./capability.js";
import { EventEnvelopeSchema } from "./events.js";
import { AreaIdSchema, DeviceIdSchema, EntityIdSchema, HomeIdSchema } from "./ids.js";
import { StateSnapshotSchema } from "./topology.js";

export const ExternalEntityRefSchema = z.discriminatedUnion("system", [
  z.object({
    system: z.literal("home_assistant"),
    instanceId: z.string().min(1),
    entityId: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/u),
  }),
  z.object({
    system: z.enum(["mqtt", "webhook", "virtual"]),
    instanceId: z.string().min(1),
    entityId: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z0-9_.:/-]+$/u),
  }),
]);

export const ExternalAreaRefSchema = z.object({
  system: z.enum(["home_assistant", "mqtt", "webhook", "virtual"]),
  instanceId: z.string().min(1),
  areaId: z.string().min(1),
});

export const ExternalDeviceRefSchema = z.object({
  system: z.enum(["home_assistant", "mqtt", "webhook", "virtual"]),
  instanceId: z.string().min(1),
  deviceId: z.string().min(1),
});

export const TwinAreaSchema = z.object({
  id: AreaIdSchema,
  homeId: HomeIdSchema,
  name: z.string().min(1),
  kind: z.enum(["room", "zone", "floor", "exterior", "logical"]).default("room"),
  externalRef: ExternalAreaRefSchema,
});

export const TwinDeviceSchema = z.object({
  id: DeviceIdSchema,
  homeId: HomeIdSchema,
  areaId: AreaIdSchema.optional(),
  name: z.string().min(1),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  integration: z.string().min(1),
  externalRef: ExternalDeviceRefSchema,
});

export const TwinEntitySchema = z.object({
  id: EntityIdSchema,
  homeId: HomeIdSchema,
  deviceId: DeviceIdSchema.optional(),
  areaId: AreaIdSchema.optional(),
  name: z.string().min(1),
  domain: z.string().min(1),
  capabilities: z.array(CapabilityIdSchema),
  externalRef: ExternalEntityRefSchema,
  observedState: StateSnapshotSchema,
});

export const EntityStateChangedDataSchema = z.object({
  entity: TwinEntitySchema,
});

export const EntityStateChangedEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal("home.entity.state.changed"),
  subject: z.object({ entityId: EntityIdSchema }),
  data: EntityStateChangedDataSchema,
});

export const EntityListResponseSchema = z.object({
  homeId: HomeIdSchema,
  entities: z.array(TwinEntitySchema),
});

export const HomeTopologySchema = z.object({
  homeId: HomeIdSchema,
  areas: z.array(TwinAreaSchema),
  devices: z.array(TwinDeviceSchema),
});

export const HomeTopologyDiscoveredEventSchema = EventEnvelopeSchema.extend({
  eventType: z.literal("home.topology.discovered"),
  subject: z.object({ homeId: HomeIdSchema }),
  data: HomeTopologySchema,
});

export const HomeIngestionEventSchema = z.discriminatedUnion("eventType", [
  EntityStateChangedEventSchema,
  HomeTopologyDiscoveredEventSchema,
]);

export const HomeAssistantSyncResultSchema = z.object({
  homeId: HomeIdSchema,
  source: z.literal("home_assistant"),
  discovered: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  areas: z.number().int().nonnegative().optional(),
  devices: z.number().int().nonnegative().optional(),
  topology: z.enum(["available", "degraded"]).optional(),
  syncedAt: z.iso.datetime(),
});

export type ExternalEntityRef = z.infer<typeof ExternalEntityRefSchema>;
export type ExternalAreaRef = z.infer<typeof ExternalAreaRefSchema>;
export type ExternalDeviceRef = z.infer<typeof ExternalDeviceRefSchema>;
export type TwinArea = z.infer<typeof TwinAreaSchema>;
export type TwinDevice = z.infer<typeof TwinDeviceSchema>;
export type TwinEntity = z.infer<typeof TwinEntitySchema>;
export type EntityStateChangedEvent = z.infer<typeof EntityStateChangedEventSchema>;
export type EntityListResponse = z.infer<typeof EntityListResponseSchema>;
export type HomeTopology = z.infer<typeof HomeTopologySchema>;
export type HomeTopologyDiscoveredEvent = z.infer<typeof HomeTopologyDiscoveredEventSchema>;
export type HomeIngestionEvent = z.infer<typeof HomeIngestionEventSchema>;
export type HomeAssistantSyncResult = z.infer<typeof HomeAssistantSyncResultSchema>;
