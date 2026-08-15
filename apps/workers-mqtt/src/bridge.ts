import { createHmac } from "node:crypto";
import { type EntityStateChangedEvent, EntityStateChangedEventSchema } from "@hestia/contracts";

export function parseMqttEntityState(topic: string, payload: Uint8Array): EntityStateChangedEvent {
  const event = EntityStateChangedEventSchema.parse(
    JSON.parse(Buffer.from(payload).toString("utf8")),
  );
  const expectedTopic = `hestia/${event.homeId}/entity/${event.subject.entityId}/state`;
  if (topic !== expectedTopic)
    throw new Error("MQTT topic does not match the canonical event subject");
  return event;
}

export function signedWebhookHeaders(
  body: Uint8Array,
  key: string,
  now = new Date(),
): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1_000));
  const signature = createHmac("sha256", key)
    .update(timestamp)
    .update(".")
    .update(body)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-hestia-timestamp": timestamp,
    "x-hestia-signature": `v1=${signature}`,
  };
}
