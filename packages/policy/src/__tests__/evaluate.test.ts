import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "../evaluate.js";

describe("evaluatePolicy", () => {
  it("allows reversible convenience actions", () => {
    const decision = evaluatePolicy({ capability: "level.set" });
    expect(decision.effect).toBe("allow");
    expect(decision.risk).toBe("R1");
  });

  it("requires approval for unlock", () => {
    const decision = evaluatePolicy({ capability: "lock.unlock" });
    expect(decision.effect).toBe("require_approval");
    expect(decision.approvalId).toBeDefined();
  });

  it("denies ad hoc disarm", () => {
    const decision = evaluatePolicy({ capability: "security.disarm" });
    expect(decision.effect).toBe("deny");
  });

  it("allows R3/R4 only through a preauthorized playbook", () => {
    expect(evaluatePolicy({ capability: "lock.unlock", preauthorizedPlaybook: true }).effect).toBe(
      "allow",
    );
    expect(
      evaluatePolicy({ capability: "security.disarm", preauthorizedPlaybook: true }).effect,
    ).toBe("allow");
  });

  it("rejects a model-declared risk downgrade", () => {
    const decision = evaluatePolicy({ capability: "lock.unlock", declaredRisk: "R1" });
    expect(decision.effect).toBe("deny");
  });
});
