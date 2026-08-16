import { loadEnv } from "@hestia/config";
import {
  type DeviceCommandResult,
  DeviceCommandResultSchema,
  EntityListResponseSchema,
  type ExpectedObservation,
  ExpectedObservationSchema,
  type TypedCommand,
  TypedCommandSchema,
} from "@hestia/contracts";
import { createHomeAssistantClient } from "@hestia/ha-client";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";

export async function executeHomeAssistantCommand(
  commandInput: TypedCommand,
  expectedInput: ExpectedObservation,
): Promise<DeviceCommandResult> {
  const command = TypedCommandSchema.parse(commandInput);
  const expected = ExpectedObservationSchema.parse(expectedInput);
  const executedAt = new Date().toISOString();
  if (command.dryRun) {
    return DeviceCommandResultSchema.parse({
      commandId: command.commandId,
      outcome: "accepted",
      executedAt,
    });
  }

  const env = loadEnv();
  if (!env.HA_BASE_URL || !env.HA_ACCESS_TOKEN) {
    throw ApplicationFailure.nonRetryable(
      "Home Assistant is not configured",
      "IntegrationNotConfigured",
    );
  }
  const entity = await resolveEntity(env.HOME_CORE_URL, command);
  const service = mapHomeAssistantService(entity.domain, command);
  const client = createHomeAssistantClient({
    baseUrl: env.HA_BASE_URL,
    accessToken: env.HA_ACCESS_TOKEN,
  });
  try {
    await client.callService(service.domain, service.service, {
      entity_id: entity.externalRef.entityId,
      ...service.data,
    });
    const deadline = Date.now() + expected.timeoutMs;
    while (Date.now() <= deadline) {
      Context.current().heartbeat({ commandId: command.commandId, phase: "verifying" });
      const states = await client.getStates();
      const state = states.find((candidate) => candidate.entity_id === entity.externalRef.entityId);
      const observedValue =
        expected.attribute === "state" ? state?.state : state?.attributes[expected.attribute];
      if (sameValue(observedValue, expected.equals)) {
        return DeviceCommandResultSchema.parse({
          commandId: command.commandId,
          outcome: "confirmed",
          observedValue,
          executedAt,
          confirmedAt: new Date().toISOString(),
        });
      }
      await Context.current().sleep(500);
    }
    return DeviceCommandResultSchema.parse({
      commandId: command.commandId,
      outcome: "timed_out",
      executedAt,
    });
  } finally {
    await client.disconnect();
  }
}

async function resolveEntity(homeCoreUrl: string, command: TypedCommand) {
  const entityId = command.target.entityId;
  if (!entityId) {
    throw ApplicationFailure.nonRetryable(
      "Phase 2 commands require an explicit entity target",
      "InvalidCommandTarget",
    );
  }
  const response = await fetch(
    `${homeCoreUrl.replace(/\/$/u, "")}/api/v1/homes/${encodeURIComponent(command.target.homeId)}/entities`,
  );
  if (!response.ok) throw new Error(`home-core entity lookup failed (${response.status})`);
  const entities = EntityListResponseSchema.parse(await response.json()).entities;
  const entity = entities.find((candidate) => candidate.id === entityId);
  if (!entity) {
    throw ApplicationFailure.nonRetryable(`Unknown entity ${entityId}`, "UnknownEntity");
  }
  return entity;
}

export function mapHomeAssistantService(
  domain: string,
  command: TypedCommand,
): { domain: string; service: string; data: Record<string, unknown> } {
  switch (command.capability) {
    case "power.onOff":
      return { domain, service: booleanInput(command, "on") ? "turn_on" : "turn_off", data: {} };
    case "level.set": {
      const level = numberInput(command, "level", 0, 100);
      if (domain === "light")
        return { domain, service: "turn_on", data: { brightness_pct: level } };
      if (domain === "fan")
        return { domain, service: "set_percentage", data: { percentage: level } };
      if (domain === "media_player") {
        return { domain, service: "volume_set", data: { volume_level: level / 100 } };
      }
      if (domain === "cover") {
        return { domain, service: "set_cover_position", data: { position: level } };
      }
      break;
    }
    case "climate.setTarget":
      return {
        domain: "climate",
        service: "set_temperature",
        data: { temperature: numberInput(command, "temperature", 5, 35) },
      };
    case "climate.setMode":
      return {
        domain: "climate",
        service: "set_hvac_mode",
        data: { hvac_mode: stringInput(command, "mode") },
      };
    case "cover.setPosition":
      return {
        domain: "cover",
        service: "set_cover_position",
        data: { position: numberInput(command, "position", 0, 100) },
      };
    case "valve.setOpen":
      return {
        domain: "valve",
        service: booleanInput(command, "open") ? "open_valve" : "close_valve",
        data: {},
      };
    case "lock.lock":
      return { domain: "lock", service: "lock", data: {} };
    case "lock.unlock":
      return { domain: "lock", service: "unlock", data: {} };
    case "security.arm":
      return { domain: "alarm_control_panel", service: "alarm_arm_away", data: {} };
    case "security.disarm":
      return { domain: "alarm_control_panel", service: "alarm_disarm", data: {} };
    case "media.play":
      return { domain: "media_player", service: "media_play", data: {} };
    case "media.pause":
      return { domain: "media_player", service: "media_pause", data: {} };
    case "media.source":
      return {
        domain: "media_player",
        service: "select_source",
        data: { source: stringInput(command, "source") },
      };
    case "vacuum.start":
      return { domain: "vacuum", service: "start", data: {} };
    case "vacuum.dock":
      return { domain: "vacuum", service: "return_to_base", data: {} };
  }
  throw ApplicationFailure.nonRetryable(
    `Capability ${command.capability} is not mapped for ${domain}`,
    "UnsupportedCapability",
  );
}

function booleanInput(command: TypedCommand, key: string): boolean {
  const value = command.input[key];
  if (typeof value !== "boolean") invalidInput(command, key);
  return value;
}

function numberInput(command: TypedCommand, key: string, minimum: number, maximum: number): number {
  const value = command.input[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalidInput(command, key);
  }
  return value;
}

function stringInput(command: TypedCommand, key: string): string {
  const value = command.input[key];
  if (typeof value !== "string" || value.length === 0) invalidInput(command, key);
  return value;
}

function invalidInput(command: TypedCommand, key: string): never {
  throw ApplicationFailure.nonRetryable(
    `Invalid ${key} input for ${command.capability}`,
    "InvalidCommandInput",
  );
}

function sameValue(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}
