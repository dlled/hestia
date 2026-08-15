import { type IntegrationCheckpoint, IntegrationCheckpointSchema } from "@hestia/contracts";
import type { IntegrationCheckpointView } from "../shared/contracts";
import { integrationHubDB } from "./db";

export async function saveCheckpoint(input: IntegrationCheckpoint): Promise<void> {
  const checkpoint = IntegrationCheckpointSchema.parse(input);
  await integrationHubDB.exec`
    INSERT INTO integration_checkpoint (instance_id, checkpoint, updated_at)
    VALUES (${checkpoint.instanceId}, ${checkpoint as Record<string, unknown>}, now())
    ON CONFLICT (instance_id) DO UPDATE SET
      checkpoint = EXCLUDED.checkpoint,
      updated_at = now()
  `;
}

export async function getCheckpoint(
  instanceId: string,
): Promise<IntegrationCheckpointView | undefined> {
  const row = await integrationHubDB.queryRow<{ checkpoint: unknown }>`
    SELECT checkpoint FROM integration_checkpoint WHERE instance_id = ${instanceId}
  `;
  if (!row) return undefined;
  return IntegrationCheckpointSchema.parse(row.checkpoint) as IntegrationCheckpointView;
}
