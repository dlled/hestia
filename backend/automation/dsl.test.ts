import { describe, expect, it } from "vitest";
import type { AutomationDefinitionView } from "../shared/contracts";
import { simulateDefinition, validateDefinition } from "./dsl";

describe("automation DSL invariants", () => {
  it("never produces an effect during deterministic replay", () => {
    for (let index = 0; index < 100; index += 1) {
      const threshold = index % 25;
      const definition = fixture(threshold);
      const simulation = simulateDefinition(
        definition,
        { "sensor.grid_power": index },
        new Date("2026-08-15T12:00:00.000Z"),
      );
      expect(simulation.effectful).toBe(false);
      expect(simulation.triggered).toBe(index >= threshold);
      expect(simulation.proposedActions.length).toBeLessThanOrEqual(
        definition.budgets.maxActionsPerRun,
      );
    }
  });

  it("requires shadow evidence and explicit policy promotion before activation", () => {
    expect(() => validateDefinition({ ...fixture(10), mode: "active" })).toThrow();
    expect(
      validateDefinition({
        ...fixture(10),
        mode: "active",
        shadowEvidenceId: "shadow_0123456789",
        policyPromotionId: "promotion_0123456789",
      }).mode,
    ).toBe("active");
  });
});

function fixture(threshold: number): AutomationDefinitionView {
  return {
    automationId: "auto_energy0123456789",
    version: 1,
    homeId: "home_primary",
    name: "Energy shadow recommendation",
    status: "draft",
    mode: "shadow",
    trigger: { kind: "energy", entityId: "sensor.grid_power", expression: "on reading" },
    conditions: [{ entityId: "sensor.grid_power", operator: "gte", value: threshold }],
    actions: [
      { capability: "energy.setLimit", entityId: "charger.ev", input: { watts: 1500 }, risk: "R2" },
    ],
    budgets: { maxActionsPerRun: 1, maxRunsPerHour: 4, maxRisk: "R2" },
    locks: ["device:charger.ev"],
    rollback: "required",
    createdAt: "2026-08-15T12:00:00.000Z",
  };
}
