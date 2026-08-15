import { buffer } from "node:stream/consumers";
import { EntityStateChangedEventSchema } from "@hestia/contracts";
import { api } from "encore.dev/api";
import { publishAndApply } from "./api";
import { integrationHubDB } from "./db";
import { verifyWebhook } from "./webhook-integrity";
import { IntegrationWebhookSigningKey } from "./webhook-secrets";

export const ingestSignedEntityState = api.raw(
  { expose: true, method: "POST", path: "/integrations/webhooks/entity-state", sensitive: true },
  async (request, response) => {
    const body = await buffer(request);
    const timestamp = firstHeader(request.headers["x-hestia-timestamp"]);
    const signature = firstHeader(request.headers["x-hestia-signature"]);
    if (!verifyWebhook({ body, timestamp, signature, key: IntegrationWebhookSigningKey() })) {
      respond(response, 401, { error: "invalid_signature" });
      return;
    }

    let event: ReturnType<typeof EntityStateChangedEventSchema.parse>;
    try {
      event = EntityStateChangedEventSchema.parse(JSON.parse(body.toString("utf8")));
    } catch {
      respond(response, 400, { error: "invalid_entity_state_event" });
      return;
    }

    const claimed = await claimReceipt(event.eventId, event.source.type);
    if (!claimed) {
      respond(response, 409, { error: "event_already_received", eventId: event.eventId });
      return;
    }
    try {
      await publishAndApply(event);
      await integrationHubDB.exec`
        UPDATE integration_webhook_receipt SET status = 'completed', completed_at = now(), failure_message = NULL
        WHERE event_id = ${event.eventId}
      `;
      respond(response, 202, { accepted: true, eventId: event.eventId });
    } catch (error) {
      await integrationHubDB.exec`
        UPDATE integration_webhook_receipt SET status = 'failed', failure_message = ${safeError(error)}
        WHERE event_id = ${event.eventId}
      `;
      throw error;
    }
  },
);

async function claimReceipt(eventId: string, source: string): Promise<boolean> {
  const row = await integrationHubDB.queryRow<{ event_id: string }>`
    INSERT INTO integration_webhook_receipt (event_id, source, status)
    VALUES (${eventId}, ${source}, 'processing')
    ON CONFLICT (event_id) DO UPDATE
      SET status = 'processing', received_at = now(), failure_message = NULL
      WHERE integration_webhook_receipt.status = 'failed'
    RETURNING event_id
  `;
  return row !== null;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function respond(
  response: import("node:http").ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : "integration ingestion failed").slice(0, 500);
}
