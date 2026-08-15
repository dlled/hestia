import { z } from "zod";

export const IdPrefixes = {
  home: "home",
  area: "area",
  device: "dev",
  entity: "ent",
  capability: "cap",
  command: "cmd",
  event: "evt",
  run: "run",
  approval: "appr",
  incident: "inc",
  workflow: "wf",
  correlation: "corr",
} as const;

export type IdPrefix = (typeof IdPrefixes)[keyof typeof IdPrefixes];

export const IdSchema = z.string().min(8);

export function createId(prefix: IdPrefix): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

export const HomeIdSchema = IdSchema;
export const AreaIdSchema = IdSchema;
export const DeviceIdSchema = IdSchema;
export const EntityIdSchema = IdSchema;
export const CommandIdSchema = IdSchema;
export const EventIdSchema = IdSchema;
export const CorrelationIdSchema = IdSchema;
