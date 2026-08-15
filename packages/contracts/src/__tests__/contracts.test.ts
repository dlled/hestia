import { describe, expect, it } from "vitest";
import { ActionPlanSchema } from "../automation.js";
import { CapabilityIdSchema } from "../capability.js";
import { TypedCommandSchema } from "../command.js";
import { EntityStateChangedEventSchema } from "../entity-state.js";
import { EventEnvelopeSchema } from "../events.js";
import { createId } from "../ids.js";
import { riskAtLeast } from "../risk.js";

describe("createId", () => {
  it("prefixes a unique identifier", () => {
    const id = createId("cmd");
    expect(id.startsWith("cmd_")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
    expect(createId("cmd")).not.toBe(id);
  });
});

describe("riskAtLeast", () => {
  it("ranks physical risk above convenience", () => {
    expect(riskAtLeast("R3", "R2")).toBe(true);
    expect(riskAtLeast("R1", "R3")).toBe(false);
  });
});

describe("event envelope", () => {
  it("accepts a versioned home event", () => {
    const parsed = EventEnvelopeSchema.parse({
      eventId: createId("evt"),
      eventType: "home.entity.state.changed",
      schemaVersion: 1,
      occurredAt: "2026-08-13T20:01:22.112Z",
      homeId: createId("home"),
      correlationId: createId("corr"),
      causationId: createId("cmd"),
      source: { type: "home_assistant", instanceId: "ha_main" },
      subject: { entityId: createId("ent") },
      data: { observedState: { value: 21.4, unit: "C" } },
    });
    expect(parsed.schemaVersion).toBe(1);
  });
});

describe("entity state event", () => {
  it("requires a stable HESTIA id and a typed Home Assistant reference", () => {
    const homeId = "home_primary";
    const entityId = "ent_0123456789abcdef";
    const parsed = EntityStateChangedEventSchema.parse({
      eventId: "evt_0123456789abcdef",
      eventType: "home.entity.state.changed",
      schemaVersion: 1,
      occurredAt: "2026-08-14T20:00:00.000Z",
      homeId,
      correlationId: "corr_0123456789abcdef",
      source: { type: "home_assistant", instanceId: "ha_main" },
      subject: { entityId },
      data: {
        entity: {
          id: entityId,
          homeId,
          name: "Bedroom lamp",
          domain: "light",
          capabilities: ["power.onOff", "level.set"],
          externalRef: {
            system: "home_assistant",
            instanceId: "ha_main",
            entityId: "light.bedroom",
          },
          observedState: {
            value: "on",
            timestamp: "2026-08-14T20:00:00.000Z",
            source: "home_assistant:ha_main",
            quality: "good",
          },
        },
      },
    });

    expect(parsed.data.entity.externalRef.entityId).toBe("light.bedroom");
  });

  it("rejects an invalid Home Assistant entity id", () => {
    const result = EntityStateChangedEventSchema.safeParse({
      eventId: "evt_0123456789abcdef",
      eventType: "home.entity.state.changed",
      schemaVersion: 1,
      occurredAt: "2026-08-14T20:00:00.000Z",
      homeId: "home_primary",
      correlationId: "corr_0123456789abcdef",
      source: { type: "home_assistant", instanceId: "ha_main" },
      subject: { entityId: "ent_0123456789abcdef" },
      data: {
        entity: {
          id: "ent_0123456789abcdef",
          homeId: "home_primary",
          name: "Bad",
          domain: "light",
          capabilities: [],
          externalRef: {
            system: "home_assistant",
            instanceId: "ha_main",
            entityId: "not-an-entity-id",
          },
          observedState: {
            value: "on",
            timestamp: "2026-08-14T20:00:00.000Z",
            source: "home_assistant:ha_main",
            quality: "good",
          },
        },
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("typed command", () => {
  it("rejects an unknown capability", () => {
    expect(() =>
      TypedCommandSchema.parse({
        commandId: createId("cmd"),
        idempotencyKey: "idem-key-1",
        capability: "shell.exec",
        target: { homeId: createId("home") },
        risk: "R1",
      }),
    ).toThrow();
  });

  it("accepts a capability from the registry", () => {
    expect(CapabilityIdSchema.parse("level.set")).toBe("level.set");
  });
});

describe("action plan", () => {
  it("accepts a typed sleep plan with an observable completion condition", () => {
    const parsed = ActionPlanSchema.parse(planFixture());
    expect(parsed.actions[0]?.expectedObservation.equals).toBe("off");
  });

  it("rejects cross-home and mismatched observation targets", () => {
    const plan = planFixture();
    const action = plan.actions[0];
    if (!action) throw new Error("fixture requires an action");
    action.command.target.homeId = "home_other";
    action.expectedObservation.entityId = "ent_other0123456789";
    expect(ActionPlanSchema.safeParse(plan).success).toBe(false);
  });
});

function planFixture() {
  return {
    planId: "plan_sleep0123456789",
    version: 1,
    homeId: "home_primary",
    title: "Go to sleep",
    requestedBy: "operator",
    createdAt: "2026-08-14T22:00:00.000Z",
    actions: [
      {
        actionId: "action_light012345",
        command: {
          commandId: "cmd_light0123456789",
          idempotencyKey: "sleep-light-off-1",
          capability: "power.onOff",
          target: { homeId: "home_primary", entityId: "ent_light0123456789" },
          input: { on: false },
          risk: "R1",
        },
        expectedObservation: {
          entityId: "ent_light0123456789",
          equals: "off",
        },
      },
    ],
  };
}
