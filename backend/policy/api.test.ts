import { describe, expect, it } from "vitest";
import { evaluateDeterministically } from "./evaluator";

describe("deterministic policy", () => {
  it("derives R3 from the registry and requires explicit approval", () => {
    expect(
      evaluateDeterministically({ capability: "security.arm", declaredRisk: "R3" }),
    ).toMatchObject({
      effect: "require_approval",
      risk: "R3",
      approvalId: expect.stringMatching(/^appr_/u),
    });
  });

  it("rejects model attempts to downgrade risk", () => {
    expect(
      evaluateDeterministically({ capability: "security.arm", declaredRisk: "R1" }),
    ).toMatchObject({
      effect: "deny",
      risk: "R3",
    });
  });

  it("denies ad-hoc R4 and validates unknown capabilities", () => {
    expect(
      evaluateDeterministically({ capability: "security.disarm", declaredRisk: "R4" }),
    ).toMatchObject({
      effect: "deny",
      risk: "R4",
    });
    expect(() => evaluateDeterministically({ capability: "door.explode" })).toThrow();
  });
});
