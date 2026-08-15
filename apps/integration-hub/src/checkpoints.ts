import { type IntegrationCheckpoint, IntegrationCheckpointSchema } from "@hestia/contracts";
import pg from "pg";

const { Pool } = pg;

export interface IntegrationCheckpointRepository {
  ensureSchema(): Promise<void>;
  save(checkpoint: IntegrationCheckpoint): Promise<void>;
  get(instanceId: string): Promise<IntegrationCheckpoint | undefined>;
  close(): Promise<void>;
}

export function createMemoryCheckpointRepository(): IntegrationCheckpointRepository {
  const checkpoints = new Map<string, IntegrationCheckpoint>();
  return {
    async ensureSchema() {},
    async save(input) {
      const checkpoint = IntegrationCheckpointSchema.parse(input);
      checkpoints.set(checkpoint.instanceId, checkpoint);
    },
    async get(instanceId) {
      return checkpoints.get(instanceId);
    },
    async close() {
      checkpoints.clear();
    },
  };
}

export function createPostgresCheckpointRepository(
  databaseUrl: string,
): IntegrationCheckpointRepository {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  return {
    async ensureSchema() {
      await pool.query(`
        CREATE SCHEMA IF NOT EXISTS integration_hub;
        CREATE TABLE IF NOT EXISTS integration_hub.checkpoints (
          instance_id TEXT PRIMARY KEY,
          checkpoint JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
    },
    async save(input) {
      const checkpoint = IntegrationCheckpointSchema.parse(input);
      await pool.query(
        `INSERT INTO integration_hub.checkpoints (instance_id, checkpoint, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (instance_id) DO UPDATE SET
           checkpoint = EXCLUDED.checkpoint,
           updated_at = now()`,
        [checkpoint.instanceId, JSON.stringify(checkpoint)],
      );
    },
    async get(instanceId) {
      const result = await pool.query<{ checkpoint: unknown }>(
        "SELECT checkpoint FROM integration_hub.checkpoints WHERE instance_id = $1",
        [instanceId],
      );
      const checkpoint = result.rows[0]?.checkpoint;
      return checkpoint ? IntegrationCheckpointSchema.parse(checkpoint) : undefined;
    },
    async close() {
      await pool.end();
    },
  };
}
