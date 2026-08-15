import {
  type HomeTopology,
  HomeTopologySchema,
  type TwinArea,
  TwinAreaSchema,
  type TwinDevice,
  TwinDeviceSchema,
  type TwinEntity,
  TwinEntitySchema,
} from "@hestia/contracts";
import pg from "pg";

const { Pool } = pg;

export interface TwinRepository {
  ensureSchema(): Promise<void>;
  upsert(entity: TwinEntity): Promise<void>;
  replaceTopology(topology: HomeTopology): Promise<void>;
  list(homeId: string, now?: Date): Promise<TwinEntity[]>;
  topology(homeId: string): Promise<HomeTopology>;
  close(): Promise<void>;
}

export function createMemoryTwinRepository(): TwinRepository {
  const entities = new Map<string, TwinEntity>();
  const areas = new Map<string, TwinArea>();
  const devices = new Map<string, TwinDevice>();
  return {
    async ensureSchema() {},
    async upsert(input) {
      const entity = TwinEntitySchema.parse(input);
      const current = entities.get(entity.id);
      if (
        !current ||
        Date.parse(entity.observedState.timestamp) >= Date.parse(current.observedState.timestamp)
      ) {
        entities.set(entity.id, entity);
      }
    },
    async replaceTopology(input) {
      const topology = HomeTopologySchema.parse(input);
      for (const [id, area] of areas) if (area.homeId === topology.homeId) areas.delete(id);
      for (const [id, device] of devices) if (device.homeId === topology.homeId) devices.delete(id);
      for (const area of topology.areas) areas.set(area.id, area);
      for (const device of topology.devices) devices.set(device.id, device);
    },
    async list(homeId, now = new Date()) {
      return [...entities.values()]
        .filter((entity) => entity.homeId === homeId)
        .map((entity) => withFreshness(entity, now))
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async topology(homeId) {
      return HomeTopologySchema.parse({
        homeId,
        areas: [...areas.values()].filter((area) => area.homeId === homeId),
        devices: [...devices.values()].filter((device) => device.homeId === homeId),
      });
    },
    async close() {
      entities.clear();
      areas.clear();
      devices.clear();
    },
  };
}

export function createPostgresTwinRepository(databaseUrl: string): TwinRepository {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return {
    async ensureSchema() {
      await pool.query(`
        CREATE SCHEMA IF NOT EXISTS home_core;
        CREATE TABLE IF NOT EXISTS home_core.entities (
          id TEXT PRIMARY KEY,
          home_id TEXT NOT NULL,
          device_id TEXT,
          area_id TEXT,
          name TEXT NOT NULL,
          domain TEXT NOT NULL,
          capabilities JSONB NOT NULL,
          external_ref JSONB NOT NULL,
          observed_state JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE home_core.entities ADD COLUMN IF NOT EXISTS device_id TEXT;
        ALTER TABLE home_core.entities ADD COLUMN IF NOT EXISTS area_id TEXT;
        CREATE INDEX IF NOT EXISTS entities_home_id_idx ON home_core.entities (home_id);
        CREATE UNIQUE INDEX IF NOT EXISTS entities_external_ref_idx
          ON home_core.entities
          (home_id, (external_ref->>'instanceId'), (external_ref->>'entityId'));
        CREATE TABLE IF NOT EXISTS home_core.areas (
          id TEXT PRIMARY KEY,
          home_id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          external_ref JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS areas_home_id_idx ON home_core.areas (home_id);
        CREATE TABLE IF NOT EXISTS home_core.devices (
          id TEXT PRIMARY KEY,
          home_id TEXT NOT NULL,
          area_id TEXT,
          name TEXT NOT NULL,
          manufacturer TEXT,
          model TEXT,
          integration TEXT NOT NULL,
          external_ref JSONB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS devices_home_id_idx ON home_core.devices (home_id);
      `);
    },
    async upsert(input) {
      const entity = TwinEntitySchema.parse(input);
      await pool.query(
        `INSERT INTO home_core.entities
          (id, home_id, device_id, area_id, name, domain, capabilities, external_ref,
           observed_state, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
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
               (home_core.entities.observed_state->>'timestamp')::timestamptz`,
        [
          entity.id,
          entity.homeId,
          entity.deviceId ?? null,
          entity.areaId ?? null,
          entity.name,
          entity.domain,
          JSON.stringify(entity.capabilities),
          JSON.stringify(entity.externalRef),
          JSON.stringify(entity.observedState),
        ],
      );
    },
    async replaceTopology(input) {
      const topology = HomeTopologySchema.parse(input);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM home_core.devices WHERE home_id = $1", [topology.homeId]);
        await client.query("DELETE FROM home_core.areas WHERE home_id = $1", [topology.homeId]);
        for (const area of topology.areas) {
          await client.query(
            `INSERT INTO home_core.areas (id, home_id, name, kind, external_ref)
             VALUES ($1, $2, $3, $4, $5)`,
            [area.id, area.homeId, area.name, area.kind, JSON.stringify(area.externalRef)],
          );
        }
        for (const device of topology.devices) {
          await client.query(
            `INSERT INTO home_core.devices
              (id, home_id, area_id, name, manufacturer, model, integration, external_ref)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              device.id,
              device.homeId,
              device.areaId ?? null,
              device.name,
              device.manufacturer ?? null,
              device.model ?? null,
              device.integration,
              JSON.stringify(device.externalRef),
            ],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    async list(homeId, now = new Date()) {
      const result = await pool.query<{
        id: string;
        home_id: string;
        device_id: string | null;
        area_id: string | null;
        name: string;
        domain: string;
        capabilities: unknown;
        external_ref: unknown;
        observed_state: unknown;
      }>(
        `SELECT id, home_id, device_id, area_id, name, domain, capabilities, external_ref,
                observed_state
         FROM home_core.entities
         WHERE home_id = $1
         ORDER BY name ASC`,
        [homeId],
      );
      return result.rows.map((row) =>
        withFreshness(
          TwinEntitySchema.parse({
            id: row.id,
            homeId: row.home_id,
            ...(row.device_id ? { deviceId: row.device_id } : {}),
            ...(row.area_id ? { areaId: row.area_id } : {}),
            name: row.name,
            domain: row.domain,
            capabilities: row.capabilities,
            externalRef: row.external_ref,
            observedState: row.observed_state,
          }),
          now,
        ),
      );
    },
    async topology(homeId) {
      const [areaResult, deviceResult] = await Promise.all([
        pool.query<{
          id: string;
          home_id: string;
          name: string;
          kind: string;
          external_ref: unknown;
        }>(
          `SELECT id, home_id, name, kind, external_ref
           FROM home_core.areas WHERE home_id = $1 ORDER BY name ASC`,
          [homeId],
        ),
        pool.query<{
          id: string;
          home_id: string;
          area_id: string | null;
          name: string;
          manufacturer: string | null;
          model: string | null;
          integration: string;
          external_ref: unknown;
        }>(
          `SELECT id, home_id, area_id, name, manufacturer, model, integration, external_ref
           FROM home_core.devices WHERE home_id = $1 ORDER BY name ASC`,
          [homeId],
        ),
      ]);
      return HomeTopologySchema.parse({
        homeId,
        areas: areaResult.rows.map((row) =>
          TwinAreaSchema.parse({
            id: row.id,
            homeId: row.home_id,
            name: row.name,
            kind: row.kind,
            externalRef: row.external_ref,
          }),
        ),
        devices: deviceResult.rows.map((row) =>
          TwinDeviceSchema.parse({
            id: row.id,
            homeId: row.home_id,
            ...(row.area_id ? { areaId: row.area_id } : {}),
            name: row.name,
            ...(row.manufacturer ? { manufacturer: row.manufacturer } : {}),
            ...(row.model ? { model: row.model } : {}),
            integration: row.integration,
            externalRef: row.external_ref,
          }),
        ),
      });
    },
    async close() {
      await pool.end();
    },
  };
}

function withFreshness(entity: TwinEntity, now: Date): TwinEntity {
  const staleAfterSec = entity.observedState.staleAfterSec;
  if (
    entity.observedState.quality !== "good" ||
    staleAfterSec === undefined ||
    now.getTime() - Date.parse(entity.observedState.timestamp) <= staleAfterSec * 1_000
  ) {
    return entity;
  }
  return TwinEntitySchema.parse({
    ...entity,
    observedState: { ...entity.observedState, quality: "stale" },
  });
}
