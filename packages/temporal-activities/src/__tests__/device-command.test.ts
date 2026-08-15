import type { TypedCommand } from "@hestia/contracts";
import { describe, expect, it } from "vitest";
import { mapHomeAssistantService } from "../device-command.js";

describe("Home Assistant command mapping", () => {
  it("maps a typed power command without exposing raw service names", () => {
    expect(mapHomeAssistantService("light", command("power.onOff", { on: false }))).toEqual({
      domain: "light",
      service: "turn_off",
      data: {},
    });
  });

  it("normalizes percentage volume to Home Assistant's 0..1 range", () => {
    expect(mapHomeAssistantService("media_player", command("level.set", { level: 35 }))).toEqual({
      domain: "media_player",
      service: "volume_set",
      data: { volume_level: 0.35 },
    });
  });

  it("rejects unsupported capability/domain combinations", () => {
    expect(() => mapHomeAssistantService("sensor", command("level.set", { level: 20 }))).toThrow(
      "Capability level.set is not mapped for sensor",
    );
  });
});

function command(capability: TypedCommand["capability"], input: Record<string, unknown>) {
  return {
    commandId: "cmd_activity0123456789",
    idempotencyKey: "activity-idempotency",
    capability,
    target: { homeId: "home_primary", entityId: "ent_activity0123456789" },
    input,
    risk: "R1",
    dryRun: false,
  } satisfies TypedCommand;
}
