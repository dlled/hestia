import { z } from "zod";

export const AppEnvSchema = z.object({
  HESTIA_ENV: z.enum(["dev", "test", "home-prod"]).default("dev"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().positive().optional(),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().default("postgresql://hestia:hestia@localhost:5432/hestia"),
  NATS_URL: z.string().default("nats://localhost:4222"),
  HOME_ID: z.string().min(8).default("home_primary"),
  HOME_CORE_URL: z.url().default("http://localhost:3001"),
  INTEGRATION_HUB_URL: z.url().default("http://localhost:3002"),
  AUTOMATION_SERVICE_URL: z.url().default("http://localhost:3003"),
  AI_ORCHESTRATOR_URL: z.url().default("http://localhost:3004"),
  MODEL_GATEWAY_URL: z.url().default("http://localhost:3008"),
  HA_BASE_URL: z.union([z.literal(""), z.url()]).default(""),
  HA_ACCESS_TOKEN: z.string().default(""),
  HA_INSTANCE_ID: z.string().min(1).default("ha_main"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7233"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("hestia-automation"),
});

export type AppEnv = z.infer<typeof AppEnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return AppEnvSchema.parse(source);
}
