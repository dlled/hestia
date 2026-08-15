import type { SleepContext } from "@hestia/contracts";
import { describe, expect, it } from "vitest";
import { buildSleepPlan, NoSleepActionsError } from "../sleep-plan.js";

describe("sleep plan builder", () => {
  it("creates a visible multi-domain plan and marks alarm arming for approval", () => {
    const preview = buildSleepPlan(contextFixture(), {
      requestedBy: "resident",
      climateTargetC: 18,
      closeCovers: true,
      armAlarm: true,
      dryRun: false,
    });

    expect(preview.plan.actions.map((item) => item.command.capability)).toEqual([
      "power.onOff",
      "climate.setTarget",
      "cover.setPosition",
      "media.pause",
      "security.arm",
    ]);
    expect(preview.plan.actions.at(-1)?.command.risk).toBe("R3");
    expect(preview.plan.actions[0]?.compensation?.command.capability).toBe("power.onOff");
  });

  it("skips stale observations instead of producing physical effects", () => {
    const context = contextFixture();
    const light = context.categories.lights[0];
    if (!light) throw new Error("fixture requires a light");
    light.attention = "stale";
    light.observedState.quality = "stale";
    const preview = buildSleepPlan(context, {
      requestedBy: "resident",
      climateTargetC: 18,
      closeCovers: false,
      armAlarm: false,
      dryRun: false,
    });

    expect(preview.plan.actions.some((item) => item.command.capability === "power.onOff")).toBe(
      false,
    );
    expect(preview.skipped).toMatchObject([{ name: "Bedroom lamp" }]);
  });

  it("does not create an empty run when the home is already ready", () => {
    const context = contextFixture();
    const light = context.categories.lights[0];
    if (!light) throw new Error("fixture requires a light");
    light.observedState.value = "off";
    context.categories.climate = [];
    context.categories.covers = [];
    context.categories.media = [];

    expect(() =>
      buildSleepPlan(context, {
        requestedBy: "resident",
        climateTargetC: 18,
        closeCovers: false,
        armAlarm: false,
        dryRun: false,
      }),
    ).toThrow(NoSleepActionsError);
  });
});

function contextFixture(): SleepContext {
  const observedState = {
    value: "on" as unknown,
    timestamp: "2026-08-14T22:00:00.000Z",
    source: "home_assistant:ha_main",
    quality: "good" as const,
  };
  const item = (entityId: string, name: string, domain: string, value: unknown) => ({
    entityId,
    name,
    domain,
    observedState: { ...observedState, value },
    attention: "ready" as const,
  });
  return {
    homeId: "home_primary",
    generatedAt: "2026-08-14T22:00:00.000Z",
    readiness: "ready",
    summary: { relevant: 5, stale: 0, unavailable: 0 },
    categories: {
      lights: [item("ent_light0123456789", "Bedroom lamp", "light", "on")],
      climate: [item("ent_climate01234567", "Bedroom climate", "climate", "heat")],
      covers: [item("ent_cover0123456789", "Bedroom blind", "cover", "open")],
      media: [item("ent_media0123456789", "Bedroom speaker", "media_player", "playing")],
      alarm: [item("ent_alarm0123456789", "Home alarm", "alarm_control_panel", "disarmed")],
    },
  };
}
