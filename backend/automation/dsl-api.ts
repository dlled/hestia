import { APIError, api } from "encore.dev/api";
import type {
  AutomationDefinitionView,
  AutomationSimulationView,
  JsonScalarView,
} from "../shared/contracts";
import { automationDB } from "./db";
import { simulateDefinition, validateDefinition } from "./dsl";

export const saveAutomationDraft = api(
  { method: "POST", path: "/internal/automations/drafts" },
  async (input: AutomationDefinitionView): Promise<AutomationDefinitionView> => {
    const draft = validateDefinition({ ...input, status: "draft" });
    await automationDB.exec`
      INSERT INTO automation_definition (automation_id, version, status, mode, payload, created_at)
      VALUES (
        ${draft.automationId}, ${draft.version}, 'draft', ${draft.mode},
        ${draft as unknown as Record<string, unknown>}, ${new Date(draft.createdAt)}
      )
      ON CONFLICT (automation_id, version) DO UPDATE SET
        status = 'draft', mode = EXCLUDED.mode, payload = EXCLUDED.payload
      WHERE automation_definition.status = 'draft'
    `;
    return draft;
  },
);

export const publishAutomation = api(
  { method: "POST", path: "/internal/automations/:automationId/versions/:version/publish" },
  async ({
    automationId,
    version,
  }: {
    automationId: string;
    version: number;
  }): Promise<AutomationDefinitionView> => {
    const draft = await requireDefinition(automationId, version);
    const published = validateDefinition({ ...draft, status: "published" });
    const transaction = await automationDB.begin();
    try {
      await transaction.exec`
        UPDATE automation_definition SET status = 'retired', payload = jsonb_set(payload, '{status}', '"retired"')
        WHERE automation_id = ${automationId} AND status = 'published'
      `;
      await transaction.exec`
        UPDATE automation_definition SET status = 'published', payload = ${published as unknown as Record<string, unknown>},
          published_at = now()
        WHERE automation_id = ${automationId} AND version = ${version} AND status = 'draft'
      `;
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return published;
  },
);

export const getAutomationDefinition = api(
  { method: "GET", path: "/internal/automations/:automationId/versions/:version" },
  async ({
    automationId,
    version,
  }: {
    automationId: string;
    version: number;
  }): Promise<AutomationDefinitionView> => requireDefinition(automationId, version),
);

export const simulateAutomation = api(
  { method: "POST", path: "/internal/automations/:automationId/versions/:version/simulate" },
  async ({
    automationId,
    version,
    snapshotJson,
    replayedAt,
  }: {
    automationId: string;
    version: number;
    snapshotJson: string;
    replayedAt: string;
  }): Promise<AutomationSimulationView> => {
    const definition = await requireDefinition(automationId, version);
    let snapshot: Record<string, JsonScalarView>;
    try {
      snapshot = JSON.parse(snapshotJson) as Record<string, JsonScalarView>;
    } catch (error) {
      throw APIError.invalidArgument("Simulation snapshot is invalid", error as Error);
    }
    const timestamp = new Date(replayedAt);
    if (Number.isNaN(timestamp.getTime()))
      throw APIError.invalidArgument("Replay timestamp is invalid");
    return simulateDefinition(definition, snapshot, timestamp);
  },
);

async function requireDefinition(
  automationId: string,
  version: number,
): Promise<AutomationDefinitionView> {
  const row = await automationDB.queryRow<{ payload: AutomationDefinitionView }>`
    SELECT payload FROM automation_definition WHERE automation_id = ${automationId} AND version = ${version}
  `;
  if (!row) throw APIError.notFound("Automation definition not found");
  return row.payload;
}
