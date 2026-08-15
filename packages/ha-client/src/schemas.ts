import { z } from "zod";

export const HomeAssistantContextSchema = z.object({
  id: z.string().min(1),
  parent_id: z.string().nullable(),
  user_id: z.string().nullable(),
});

export const HomeAssistantStateSchema = z.object({
  entity_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/u),
  state: z.string(),
  attributes: z.record(z.string(), z.unknown()),
  last_changed: z.iso.datetime(),
  last_updated: z.iso.datetime(),
  last_reported: z.iso.datetime().optional(),
  context: HomeAssistantContextSchema,
});

export const HomeAssistantStatesSchema = z.array(HomeAssistantStateSchema);

export const HomeAssistantAreaRegistryEntrySchema = z
  .object({
    area_id: z.string().min(1),
    name: z.string().min(1),
    floor_id: z.string().nullable().optional(),
  })
  .passthrough();

export const HomeAssistantDeviceRegistryEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable().optional(),
    name_by_user: z.string().nullable().optional(),
    area_id: z.string().nullable().optional(),
    manufacturer: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    primary_config_entry: z.string().nullable().optional(),
    config_entries: z.array(z.string()).optional(),
    parent_device_id: z.string().nullable().optional(),
  })
  .passthrough();

export const HomeAssistantEntityRegistryEntrySchema = z
  .object({
    entity_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/u),
    name: z.string().nullable().optional(),
    platform: z.string().min(1),
    device_id: z.string().nullable().optional(),
    area_id: z.string().nullable().optional(),
    disabled_by: z.string().nullable().optional(),
  })
  .passthrough();

export const HomeAssistantRegistrySnapshotSchema = z.object({
  areas: z.array(HomeAssistantAreaRegistryEntrySchema),
  devices: z.array(HomeAssistantDeviceRegistryEntrySchema),
  entities: z.array(HomeAssistantEntityRegistryEntrySchema),
});

export const HomeAssistantStateChangedEventSchema = z.object({
  event_type: z.literal("state_changed"),
  data: z.object({
    entity_id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]+$/u),
    old_state: HomeAssistantStateSchema.nullable(),
    new_state: HomeAssistantStateSchema.nullable(),
  }),
  origin: z.string(),
  time_fired: z.iso.datetime(),
  context: HomeAssistantContextSchema,
});

export const HomeAssistantWebSocketEventSchema = z.object({
  id: z.number().int().positive(),
  type: z.literal("event"),
  event: HomeAssistantStateChangedEventSchema,
});

export type HomeAssistantState = z.infer<typeof HomeAssistantStateSchema>;
export type HomeAssistantStateChangedEvent = z.infer<typeof HomeAssistantStateChangedEventSchema>;
export type HomeAssistantAreaRegistryEntry = z.infer<typeof HomeAssistantAreaRegistryEntrySchema>;
export type HomeAssistantDeviceRegistryEntry = z.infer<
  typeof HomeAssistantDeviceRegistryEntrySchema
>;
export type HomeAssistantEntityRegistryEntry = z.infer<
  typeof HomeAssistantEntityRegistryEntrySchema
>;
export type HomeAssistantRegistrySnapshot = z.infer<typeof HomeAssistantRegistrySnapshotSchema>;
