import { describe, expect, it } from "vitest";
import type { EntityView } from "../shared/contracts";
import { createSleepContext } from "./sleep-context";

describe("sleep context", () => {
  it("groups relevant entities and reports unsafe observations", () => {
    const context = createSleepContext(
      "home_primary",
      [entity("light", "good"), entity("climate", "unavailable"), entity("sensor", "stale")],
      new Date("2026-08-14T20:00:01.000Z"),
    );

    expect(context).toMatchObject({
      generatedAt: "2026-08-14T20:00:01.000Z",
      readiness: "degraded",
      summary: { relevant: 2, stale: 0, unavailable: 1 },
      categories: {
        lights: [{ attention: "ready" }],
        climate: [{ attention: "unavailable" }],
      },
    });
  });
});

function entity(domain: string, quality: EntityView["observedState"]["quality"]): EntityView {
  return {
    id: `ent_${domain}`,
    homeId: "home_primary",
    name: domain,
    domain,
    capabilities: ["sensor.read"],
    externalRef: { system: "home_assistant", instanceId: "ha_main", entityId: `${domain}.test` },
    observedState: {
      value: "on",
      timestamp: "2026-08-14T20:00:00.000Z",
      source: "home_assistant:ha_main",
      quality,
    },
  };
}
