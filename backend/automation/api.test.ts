import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyEvent } from "../homecore/api";
import { getPlan, previewSleep } from "./api";

describe("automation Encore persistence", () => {
  it("builds a plan from Home Core and stores its immutable version", async () => {
    const suffix = randomUUID().replaceAll("-", "");
    const homeId = `home_${suffix}`;
    const entityId = `ent_${suffix}`;
    const timestamp = new Date().toISOString();
    await applyEvent({
      eventJson: JSON.stringify({
        eventId: `evt_${suffix}`,
        eventType: "home.entity.state.changed",
        schemaVersion: 1,
        occurredAt: timestamp,
        homeId,
        correlationId: `corr_${suffix}`,
        source: { type: "home_assistant", instanceId: "ha_main" },
        subject: { entityId },
        data: {
          entity: {
            id: entityId,
            homeId,
            name: "Bedroom lamp",
            domain: "light",
            capabilities: ["level.set", "power.onOff"],
            externalRef: {
              system: "home_assistant",
              instanceId: "ha_main",
              entityId: "light.bedroom",
            },
            observedState: {
              value: "on",
              timestamp,
              source: "home_assistant:ha_main",
              quality: "good",
              staleAfterSec: 900,
            },
          },
        },
      }),
    });

    const preview = await previewSleep({
      homeId,
      requestedBy: "resident",
      closeCovers: false,
      armAlarm: false,
      dryRun: true,
    });

    expect(preview.plan).toMatchObject({
      homeId,
      requestedBy: "resident",
      dryRun: true,
      actions: [{ command: { capability: "power.onOff", dryRun: true } }],
    });
    await expect(getPlan({ planId: preview.plan.planId, version: 1 })).resolves.toEqual(
      preview.plan,
    );
  });
});
