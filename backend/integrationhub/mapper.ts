import { createHash } from "node:crypto";
import {
  type CapabilityId,
  createId,
  type EntityStateChangedEvent,
  EntityStateChangedEventSchema,
  type HomeTopology,
  type HomeTopologyDiscoveredEvent,
  HomeTopologyDiscoveredEventSchema,
  HomeTopologySchema,
  type TwinEntity,
  TwinEntitySchema,
} from "@hestia/contracts";
import type {
  HomeAssistantRegistrySnapshot,
  HomeAssistantState,
  HomeAssistantStateChangedEvent,
} from "@hestia/ha-client";

export interface HomeAssistantMappingContext {
  homeId: string;
  instanceId: string;
  correlationId?: string;
  registry?: HomeAssistantRegistrySnapshot;
}

export function mapHomeAssistantState(
  state: HomeAssistantState,
  context: HomeAssistantMappingContext,
): TwinEntity {
  const [domain] = state.entity_id.split(".");
  if (!domain) throw new Error(`invalid Home Assistant entity id: ${state.entity_id}`);
  const unit = stringAttribute(state.attributes, "unit_of_measurement");
  const deviceClass = stringAttribute(state.attributes, "device_class");
  const registryEntity = context.registry?.entities.find(
    (entity) => entity.entity_id === state.entity_id,
  );
  const registryDevice = context.registry?.devices.find(
    (device) => device.id === registryEntity?.device_id,
  );
  const externalAreaId = registryEntity?.area_id ?? registryDevice?.area_id;
  return TwinEntitySchema.parse({
    id: stableEntityId(context.homeId, context.instanceId, state.entity_id),
    homeId: context.homeId,
    ...(registryEntity?.device_id
      ? { deviceId: stableDeviceId(context.homeId, context.instanceId, registryEntity.device_id) }
      : {}),
    ...(externalAreaId
      ? { areaId: stableAreaId(context.homeId, context.instanceId, externalAreaId) }
      : {}),
    name: stringAttribute(state.attributes, "friendly_name") ?? state.entity_id,
    domain,
    ...(deviceClass ? { deviceClass } : {}),
    capabilities: capabilitiesFor(domain, state.attributes),
    externalRef: {
      system: "home_assistant",
      instanceId: context.instanceId,
      entityId: state.entity_id,
    },
    observedState: {
      value: state.state,
      ...(unit ? { unit } : {}),
      timestamp: state.last_updated,
      source: `home_assistant:${context.instanceId}`,
      quality: state.state === "unavailable" || state.state === "unknown" ? "unavailable" : "good",
      staleAfterSec: staleAfterSecFor(domain),
    },
  });
}

export function mapHomeAssistantTopology(
  registry: HomeAssistantRegistrySnapshot,
  context: HomeAssistantMappingContext,
): HomeTopology {
  return HomeTopologySchema.parse({
    homeId: context.homeId,
    areas: registry.areas.map((area) => ({
      id: stableAreaId(context.homeId, context.instanceId, area.area_id),
      homeId: context.homeId,
      name: area.name,
      kind: "room",
      externalRef: {
        system: "home_assistant",
        instanceId: context.instanceId,
        areaId: area.area_id,
      },
    })),
    devices: registry.devices.map((device) => ({
      id: stableDeviceId(context.homeId, context.instanceId, device.id),
      homeId: context.homeId,
      ...(device.area_id
        ? { areaId: stableAreaId(context.homeId, context.instanceId, device.area_id) }
        : {}),
      name: device.name_by_user ?? device.name ?? device.id,
      ...(device.manufacturer ? { manufacturer: device.manufacturer } : {}),
      ...(device.model ? { model: device.model } : {}),
      integration: device.primary_config_entry ?? device.config_entries?.[0] ?? "home_assistant",
      externalRef: {
        system: "home_assistant",
        instanceId: context.instanceId,
        deviceId: device.id,
      },
    })),
  });
}

export function topologyDiscoveredEvent(
  registry: HomeAssistantRegistrySnapshot,
  context: HomeAssistantMappingContext,
): HomeTopologyDiscoveredEvent {
  return HomeTopologyDiscoveredEventSchema.parse({
    eventId: createId("evt"),
    eventType: "home.topology.discovered",
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    homeId: context.homeId,
    correlationId: context.correlationId ?? createId("corr"),
    source: { type: "home_assistant", instanceId: context.instanceId },
    subject: { homeId: context.homeId },
    data: mapHomeAssistantTopology(registry, context),
  });
}

export function entityStateEvent(
  state: HomeAssistantState,
  context: HomeAssistantMappingContext,
): EntityStateChangedEvent {
  const entity = mapHomeAssistantState(state, context);
  return EntityStateChangedEventSchema.parse({
    eventId: createId("evt"),
    eventType: "home.entity.state.changed",
    schemaVersion: 1,
    occurredAt: state.last_updated,
    homeId: context.homeId,
    correlationId: context.correlationId ?? createId("corr"),
    source: { type: "home_assistant", instanceId: context.instanceId },
    subject: { entityId: entity.id },
    data: { entity },
  });
}

export function stateChangedEvent(
  event: HomeAssistantStateChangedEvent,
  context: HomeAssistantMappingContext,
): EntityStateChangedEvent | undefined {
  if (event.data.new_state) return entityStateEvent(event.data.new_state, context);
  if (!event.data.old_state) return undefined;
  return entityStateEvent(
    {
      ...event.data.old_state,
      state: "unavailable",
      last_changed: event.time_fired,
      last_updated: event.time_fired,
    },
    context,
  );
}

export function stableEntityId(homeId: string, instanceId: string, entityId: string): string {
  return stableId("ent", homeId, instanceId, entityId);
}

export function stableAreaId(homeId: string, instanceId: string, areaId: string): string {
  return stableId("area", homeId, instanceId, areaId);
}

export function stableDeviceId(homeId: string, instanceId: string, deviceId: string): string {
  return stableId("dev", homeId, instanceId, deviceId);
}

export function staleAfterSecFor(domain: string): number {
  if (["binary_sensor", "device_tracker", "person", "sensor"].includes(domain)) return 300;
  if (["sun", "weather"].includes(domain)) return 1_800;
  return 900;
}

function stableId(prefix: string, homeId: string, instanceId: string, externalId: string): string {
  const digest = createHash("sha256")
    .update(`${homeId}\0${instanceId}\0${externalId}`)
    .digest("hex")
    .slice(0, 24);
  return `${prefix}_${digest}`;
}

function capabilitiesFor(domain: string, _attributes: Record<string, unknown>): CapabilityId[] {
  const capabilities = new Set<CapabilityId>();
  if (["light", "switch", "fan", "media_player", "climate"].includes(domain)) {
    capabilities.add("power.onOff");
  }
  if (["light", "fan", "media_player", "cover"].includes(domain)) {
    capabilities.add("level.set");
  }
  if (domain === "climate") {
    capabilities.add("climate.setTarget");
    capabilities.add("climate.setMode");
  }
  if (domain === "cover") capabilities.add("cover.setPosition");
  if (domain === "valve") capabilities.add("valve.setOpen");
  if (domain === "lock") {
    capabilities.add("lock.lock");
    capabilities.add("lock.unlock");
  }
  if (domain === "alarm_control_panel") {
    capabilities.add("security.arm");
    capabilities.add("security.disarm");
  }
  if (domain === "media_player") {
    capabilities.add("media.play");
    capabilities.add("media.pause");
    capabilities.add("media.source");
  }
  if (domain === "vacuum") {
    capabilities.add("vacuum.start");
    capabilities.add("vacuum.dock");
  }
  if (capabilities.size === 0) capabilities.add("sensor.read");
  return [...capabilities].sort();
}

function stringAttribute(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = attributes[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
