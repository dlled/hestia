import { readFileSync } from "node:fs";
import { connectAsync, type IClientOptions, type MqttClient } from "mqtt";
import { z } from "zod";
import { parseMqttEntityState, signedWebhookHeaders } from "./bridge.js";

const EnvironmentSchema = z.object({
  MQTT_URL: z.string().url(),
  MQTT_CLIENT_ID: z.string().min(1).default("hestia-mqtt-bridge"),
  MQTT_TOPIC: z.string().min(1).default("hestia/+/entity/+/state"),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  MQTT_CA_FILE: z.string().optional(),
  HESTIA_WEBHOOK_URL: z.string().url(),
  HESTIA_WEBHOOK_SIGNING_KEY: z.string().min(32),
});

const environment = EnvironmentSchema.parse(process.env);
const pending = new Set<Promise<void>>();
let client: MqttClient | undefined;

async function main(): Promise<void> {
  const options: IClientOptions = {
    protocolVersion: 5,
    clientId: environment.MQTT_CLIENT_ID,
    clean: false,
    reconnectPeriod: 1_000,
    connectTimeout: 10_000,
    ...(environment.MQTT_USERNAME ? { username: environment.MQTT_USERNAME } : {}),
    ...(environment.MQTT_PASSWORD ? { password: environment.MQTT_PASSWORD } : {}),
    ...(environment.MQTT_CA_FILE ? { ca: readFileSync(environment.MQTT_CA_FILE) } : {}),
  };
  client = await connectAsync(environment.MQTT_URL, options);
  await client.subscribeAsync(environment.MQTT_TOPIC, { qos: 1 });
  log("info", "mqtt bridge started", {
    clientId: environment.MQTT_CLIENT_ID,
    topic: environment.MQTT_TOPIC,
  });

  client.on("message", (topic, payload) => {
    const work = forward(topic, payload)
      .catch((error) => {
        log("error", "mqtt message rejected", { topic, error: safeError(error) });
      })
      .finally(() => pending.delete(work));
    pending.add(work);
  });
  client.on("reconnect", () => log("warn", "mqtt bridge reconnecting"));
  client.on("error", (error) => log("error", "mqtt client error", { error: safeError(error) }));
}

async function forward(topic: string, payload: Uint8Array): Promise<void> {
  const event = parseMqttEntityState(topic, payload);
  const body = Buffer.from(JSON.stringify(event));
  const response = await fetch(environment.HESTIA_WEBHOOK_URL, {
    method: "POST",
    headers: signedWebhookHeaders(body, environment.HESTIA_WEBHOOK_SIGNING_KEY),
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 409) {
    throw new Error(`HESTIA webhook returned HTTP ${response.status}`);
  }
  log("info", "mqtt entity state forwarded", {
    eventId: event.eventId,
    topic,
    deduplicated: response.status === 409,
  });
}

async function shutdown(signal: string): Promise<void> {
  log("info", "mqtt bridge stopping", { signal });
  await client?.endAsync(false);
  await Promise.allSettled([...pending]);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown(signal).then(
      () => process.exit(0),
      (error) => {
        log("error", "mqtt bridge shutdown failed", { error: safeError(error) });
        process.exit(1);
      },
    );
  });
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function log(
  level: "info" | "warn" | "error",
  message: string,
  fields: Record<string, unknown> = {},
): void {
  process.stdout.write(
    `${JSON.stringify({ level, service: "workers-mqtt", message, ...fields })}\n`,
  );
}

main().catch((error) => {
  log("error", "mqtt bridge failed", { error: safeError(error) });
  process.exit(1);
});
