import { describe, expect, it } from "vitest";
import { evaluateAuthorization } from "./authorization";

describe("identity authorization", () => {
  it("gives the local owner full authority", () => {
    expect(
      evaluateAuthorization({
        principalId: "usr_owner",
        role: "Owner",
        request: { homeId: "home_primary", capability: "security.disarm", risk: "R4" },
        grants: [],
      }),
    ).toMatchObject({ allowed: true, role: "Owner" });
  });

  it("enforces guest home, area, capability, risk, and expiry scopes", () => {
    const grant = {
      homeId: "home_primary",
      areaId: "area_guest",
      capability: "power.onOff",
      riskCeiling: "R1" as const,
      expiresAt: "2026-08-16T12:00:00.000Z",
    };
    const base = {
      principalId: "usr_guest",
      role: "Guest" as const,
      grants: [grant],
      now: new Date("2026-08-15T12:00:00.000Z"),
    };

    expect(
      evaluateAuthorization({
        ...base,
        request: {
          homeId: "home_primary",
          areaId: "area_guest",
          capability: "power.onOff",
          risk: "R1",
        },
      }).allowed,
    ).toBe(true);
    expect(
      evaluateAuthorization({
        ...base,
        request: {
          homeId: "home_primary",
          areaId: "area_guest",
          capability: "security.arm",
          risk: "R3",
        },
      }).allowed,
    ).toBe(false);
    expect(
      evaluateAuthorization({
        ...base,
        now: new Date("2026-08-17T12:00:00.000Z"),
        request: {
          homeId: "home_primary",
          areaId: "area_guest",
          capability: "power.onOff",
          risk: "R1",
        },
      }).allowed,
    ).toBe(false);
  });
});
