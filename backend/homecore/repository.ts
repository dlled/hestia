import {
  HomeIngestionEventSchema,
  HomeTopologySchema,
  type TwinEntity,
  TwinEntitySchema,
} from "@hestia/contracts";
import type { AreaView, DeviceView, EntityView, TopologyView } from "../shared/contracts";
import { homeCoreDB } from "./db";

export async function applyHomeEvent(eventJson: string): Promise<"entity" | "topology"> {
  const event = HomeIngestionEventSchema.parse(JSON.parse(eventJson));
  if (event.eventType === "home.entity.state.changed") {
    await upsertEntity(event.data.entity);
    return "entity";
  }
  await replaceTopology(event.data);
  return "topology";
}

export async function upsertEntity(entity: TwinEntity): Promise<void> {
  const parsed = TwinEntitySchema.parse(entity);
  await homeCoreDB.exec`
    INSERT INTO twin_entity
      (id, home_id, device_id, area_id, name, domain, capabilities, external_ref, observed_state, updated_at)
    VALUES (
      ${parsed.id}, ${parsed.homeId}, ${parsed.deviceId ?? null}, ${parsed.areaId ?? null},
      ${parsed.name}, ${parsed.domain}, ${parsed.capabilities},
      ${parsed.externalRef as Record<string, unknown>},
      ${parsed.observedState as Record<string, unknown>}, now()
    )
    ON CONFLICT (id) DO UPDATE SET
      device_id = EXCLUDED.device_id,
      area_id = EXCLUDED.area_id,
      name = EXCLUDED.name,
      domain = EXCLUDED.domain,
      capabilities = EXCLUDED.capabilities,
      external_ref = EXCLUDED.external_ref,
      observed_state = EXCLUDED.observed_state,
      updated_at = now()
    WHERE (EXCLUDED.observed_state->>'timestamp')::timestamptz >=
          (twin_entity.observed_state->>'timestamp')::timestamptz
  `;
}

export async function replaceTopology(input: unknown): Promise<void> {
  const topology = HomeTopologySchema.parse(input);
  const transaction = await homeCoreDB.begin();
  try {
    await transaction.exec`DELETE FROM twin_device WHERE home_id = ${topology.homeId}`;
    await transaction.exec`DELETE FROM twin_area WHERE home_id = ${topology.homeId}`;
    for (const area of topology.areas) {
      await transaction.exec`
        INSERT INTO twin_area (id, home_id, name, kind, external_ref)
        VALUES (${area.id}, ${area.homeId}, ${area.name}, ${area.kind}, ${area.externalRef as Record<string, unknown>})
      `;
    }
    for (const device of topology.devices) {
      await transaction.exec`
        INSERT INTO twin_device (id, home_id, area_id, name, manufacturer, model, integration, external_ref)
        VALUES (
          ${device.id}, ${device.homeId}, ${device.areaId ?? null}, ${device.name},
          ${device.manufacturer ?? null}, ${device.model ?? null}, ${device.integration},
          ${device.externalRef as Record<string, unknown>}
        )
      `;
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listEntityViews(homeId: string, now = new Date()): Promise<EntityView[]> {
  const rows = homeCoreDB.query<{
    id: string;
    home_id: string;
    device_id: string | null;
    area_id: string | null;
    name: string;
    domain: string;
    capabilities: unknown;
    external_ref: unknown;
    observed_state: unknown;
  }>`
    SELECT id, home_id, device_id, area_id, name, domain, capabilities, external_ref, observed_state
    FROM twin_entity
    WHERE home_id = ${homeId}
    ORDER BY name ASC
  `;
  const entities: EntityView[] = [];
  for await (const row of rows) {
    const parsed = TwinEntitySchema.parse({
      id: row.id,
      homeId: row.home_id,
      ...(row.device_id ? { deviceId: row.device_id } : {}),
      ...(row.area_id ? { areaId: row.area_id } : {}),
      name: row.name,
      domain: row.domain,
      capabilities: row.capabilities,
      externalRef: row.external_ref,
      observedState: row.observed_state,
    });
    entities.push(toEntityView(withFreshness(parsed, now)));
  }
  return entities;
}

export async function topologyView(homeId: string): Promise<TopologyView> {
  const areas: AreaView[] = [];
  for await (const row of homeCoreDB.query<{
    id: string;
    home_id: string;
    name: string;
    kind: AreaView["kind"];
    external_ref: AreaView["externalRef"];
  }>`SELECT id, home_id, name, kind, external_ref FROM twin_area WHERE home_id = ${homeId} ORDER BY name`) {
    areas.push({
      id: row.id,
      homeId: row.home_id,
      name: row.name,
      kind: row.kind,
      externalRef: row.external_ref,
    });
  }
  const devices: DeviceView[] = [];
  for await (const row of homeCoreDB.query<{
    id: string;
    home_id: string;
    area_id: string | null;
    name: string;
    manufacturer: string | null;
    model: string | null;
    integration: string;
    external_ref: DeviceView["externalRef"];
  }>`SELECT id, home_id, area_id, name, manufacturer, model, integration, external_ref FROM twin_device WHERE home_id = ${homeId} ORDER BY name`) {
    devices.push({
      id: row.id,
      homeId: row.home_id,
      ...(row.area_id ? { areaId: row.area_id } : {}),
      name: row.name,
      ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
      ...(row.model ? { model: row.model } : {}),
      integration: row.integration,
      externalRef: row.external_ref,
    });
  }
  return { homeId, areas, devices };
}

function withFreshness(entity: TwinEntity, now: Date): TwinEntity {
  const staleAfterSec = entity.observedState.staleAfterSec;
  if (
    entity.observedState.quality !== "good" ||
    staleAfterSec === undefined ||
    now.getTime() - Date.parse(entity.observedState.timestamp) <= staleAfterSec * 1_000
  )
    return entity;
  return TwinEntitySchema.parse({
    ...entity,
    observedState: { ...entity.observedState, quality: "stale" },
  });
}

function toEntityView(entity: TwinEntity): EntityView {
  return {
    id: entity.id,
    homeId: entity.homeId,
    ...(entity.deviceId ? { deviceId: entity.deviceId } : {}),
    ...(entity.areaId ? { areaId: entity.areaId } : {}),
    name: entity.name,
    domain: entity.domain,
    capabilities: entity.capabilities,
    externalRef: entity.externalRef,
    observedState: {
      value: String(entity.observedState.value),
      ...(entity.observedState.unit ? { unit: entity.observedState.unit } : {}),
      timestamp: entity.observedState.timestamp,
      source: entity.observedState.source,
      quality: entity.observedState.quality,
      ...(entity.observedState.staleAfterSec !== undefined
        ? { staleAfterSec: entity.observedState.staleAfterSec }
        : {}),
    },
  };
}
